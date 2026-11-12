import { normalize } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { ChatMessage } from "../fm/fm.types.ts";
import type { FmServer } from "../fm/fm-server.ts";
import type { ClientRequest, Tool, ToolOutcome } from "../tools/tools.types.ts";
import { TOOL_CONFIG, positiveConfig } from "../tools/tools.config.ts";
import { actionSummary, commandFailed, isActionTool, toolArgsGuidance } from "../tools/tool-guidance.ts";
import { abortable } from "../tools/tool-registry.ts";
import { fallbackSchema, sanitizeSchema } from "../tools/tool-schema.ts";
import { AGENT_CONFIG, LOOP_CONFIG } from "./agent.config.ts";
import type { SessionUpdateSink, ToolLoopResult } from "./agent.types.ts";
import { trimHistory } from "./history.ts";

export const truncateResult = (text: string, limit = positiveConfig(TOOL_CONFIG.resultEnv, TOOL_CONFIG.resultChars)): string =>
  text.length > limit ? text.slice(0, limit) + TOOL_CONFIG.truncated : text;

export const toolCatalogue = (tools: Tool[], budget = positiveConfig(TOOL_CONFIG.catalogueEnv, TOOL_CONFIG.catalogueChars)): string => {
  let result = "";
  for (const tool of tools) {
    const full = `${tool.name}: ${tool.description.replaceAll(/\s+/g, " ").slice(0, TOOL_CONFIG.descriptionChars)}\n`;
    const entry = result.length + full.length <= budget ? full : `${tool.name}\n`;
    if (result.length + entry.length > budget) break;
    result += entry;
  }
  return result;
};

/** Canonical JSON preserves array order and ignores object-key order. */
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
  : value !== null && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value;

const callKey = (name: string, args: Record<string, unknown>): string => {
  const normalized = { ...args };
  if (LOOP_CONFIG.pathTools.some((tool) => tool === name)) {
    for (const key of ["path", "cwd"]) if (typeof normalized[key] === "string") normalized[key] = normalize(normalized[key]);
    if (name === LOOP_CONFIG.readTool && normalized.line === 1) delete normalized.line;
  }
  return JSON.stringify([name, canonical(normalized)]);
};

/** The loop returns ephemeral tool observations; only the final reply is persisted. */
export const runToolLoop = async (fm: Pick<FmServer, "complete">, tools: Tool[], history: ChatMessage[],
  sessionId: string, emit: SessionUpdateSink, request: ClientRequest, signal: AbortSignal, instructions?: string): Promise<ToolLoopResult> => {
  const working = [...history];
  const original = history.findLast((message) => message.role === "user")?.content ?? "";
  const observations: ChatMessage[] = [];
  const seen = new Set<string>();
  let succeeded = false;
  let followUps: number | undefined;
  const failed = () => { followUps ??= LOOP_CONFIG.followUpAttempts; };
  const actions: ToolOutcome[] = [];
  let hasRead = false;
  const finalMessages = (hint = ""): ToolLoopResult => ({
    ...(actions.length && !hasRead ? { reply: actions.map(actionSummary).join(" ") } : {}),
    messages: [
      { role: "system", content: [instructions, observations.length ? LOOP_CONFIG.final : LOOP_CONFIG.conversationFinal, actions.length ? LOOP_CONFIG.actionFinal + actions.map(actionSummary).join(" ") : "", hint].filter(Boolean).join("\n") },
      ...trimHistory([...history.slice(0, -1), ...observations], AGENT_CONFIG.historyCharBudget),
      { role: "user", content: original },
    ],
  });
  const catalogue = toolCatalogue(tools);
  const available = tools.filter((tool) => catalogue.split("\n").some((line) => line === tool.name || line.startsWith(`${tool.name}:`)));
  const messages = (system: string): ChatMessage[] => [
    { role: "system", content: [instructions, system].filter(Boolean).join("\n") },
    ...trimHistory(working, AGENT_CONFIG.historyCharBudget),
  ];
  const decideSchema = { type: "object", properties: { action: { type: "string", enum: [TOOL_CONFIG.reply, ...available.map((tool) => tool.name)] } }, required: ["action"] };
  const cap = positiveConfig(TOOL_CONFIG.iterationsEnv, TOOL_CONFIG.iterations);
  for (let i = 0; i < cap; i++) {
    signal.throwIfAborted();
    if (followUps === 0) return finalMessages(LOOP_CONFIG.failureBudget);
    if (followUps !== undefined) followUps--;
    let name: string = TOOL_CONFIG.reply;
    try {
      if (succeeded) {
        const answer = z.object({ answer: z.enum([LOOP_CONFIG.yes, LOOP_CONFIG.no]) }).parse(await fm.complete(
          messages(LOOP_CONFIG.gate), { type: "object", properties: { answer: { type: "string", enum: [LOOP_CONFIG.yes, LOOP_CONFIG.no] } }, required: ["answer"] }, signal));
        if (answer.answer === LOOP_CONFIG.yes) return finalMessages();
      }
      name = z.object({ action: z.enum([TOOL_CONFIG.reply, ...available.map((tool) => tool.name)]) }).parse(
        await fm.complete(messages((succeeded ? LOOP_CONFIG.afterSuccess : "") + LOOP_CONFIG.decide + catalogue), decideSchema, signal)).action;
      if (name === TOOL_CONFIG.reply) return finalMessages();
      const tool = available.find((candidate) => candidate.name === name);
      if (!tool) continue;
      const argsPrompt = LOOP_CONFIG.args + toolArgsGuidance(tool);
      let raw: unknown;
      try { raw = await fm.complete(messages(argsPrompt), sanitizeSchema(tool.schema), signal); }
      catch (error) {
        signal.throwIfAborted();
        raw = JSON.parse(z.object({ json: z.string() }).parse(await fm.complete(messages(argsPrompt + "\n" + TOOL_CONFIG.fallback), fallbackSchema, signal)).json) as unknown;
      }
      const args = tool.validate(raw);
      const key = callKey(name, args);
      if (seen.has(key)) return finalMessages(LOOP_CONFIG.duplicate);
      seen.add(key);
      const toolCallId = randomUUID();
      const toolCall = { toolCallId, title: name, kind: tool.kind, status: "pending" as const, rawInput: args };
      emit(sessionId, { sessionUpdate: "tool_call", ...toolCall });
      let output: string;
      let status: "completed" | "failed" = "completed";
      try {
        if (!tool.readOnly) {
          const response = await abortable(request(TOOL_CONFIG.permission, {
            sessionId, toolCall,
            options: [{ optionId: TOOL_CONFIG.allow, name: TOOL_CONFIG.allowName, kind: TOOL_CONFIG.allow },
              { optionId: TOOL_CONFIG.reject, name: TOOL_CONFIG.rejectName, kind: TOOL_CONFIG.reject }],
          }), signal);
          const permission = z.object({ outcome: z.union([
            z.object({ outcome: z.literal("cancelled") }),
            z.object({ outcome: z.literal("selected"), optionId: z.string() }),
          ]) }).parse(response);
          if (permission.outcome.outcome !== "selected" || permission.outcome.optionId !== TOOL_CONFIG.allow) throw new Error(TOOL_CONFIG.rejected);
        }
        signal.throwIfAborted();
        output = await tool.run(args, signal);
        if (commandFailed(name, output)) status = "failed";
      } catch (error) { status = "failed"; output = String(error); }
      emit(sessionId, { sessionUpdate: "tool_call_update", toolCallId, status,
        content: [{ type: "content", content: { type: "text", text: truncateResult(output) } }], rawOutput: output });
      signal.throwIfAborted();
      if (isActionTool(tool)) actions.push({ name, args, succeeded: status === "completed" });
      else hasRead = true;
      if (status === "failed") failed();
      else succeeded = true;
      const text = truncateResult(output);
      const fence = "`".repeat(Math.max(3, ...Array.from(text.matchAll(/`+/g), (match) => match[0].length + 1)));
      const result = name === LOOP_CONFIG.readTool && status === "completed"
        ? `${String(args.path)}\n${fence}text\n${text}\n${fence}` : text;
      observations.push({ role: "user", content: isActionTool(tool)
        ? actionSummary({ name, args, succeeded: status === "completed" })
        : `${status === "completed" ? LOOP_CONFIG.successful : LOOP_CONFIG.failed}: ${name} ${JSON.stringify(args)}\n${result}` });
      working.push({ role: "assistant", content: `${TOOL_CONFIG.callMarker} ${name} ${JSON.stringify(args)}` },
        { role: "user", content: `${TOOL_CONFIG.resultMarker} ${status === "completed" ? LOOP_CONFIG.successful : LOOP_CONFIG.failed}: ${name}\n${result}` });
    } catch (error) {
      signal.throwIfAborted();
      const attempted = available.find((tool) => tool.name === name);
      if (attempted && isActionTool(attempted)) actions.push({ name, args: {}, succeeded: false });
      else hasRead = true;
      failed();
      observations.push({ role: "user", content: `${LOOP_CONFIG.failed}: ${name}\n${truncateResult(String(error))}` });
      working.push({ role: "user", content: `${TOOL_CONFIG.errorMarker} ${name}\n${truncateResult(String(error))}` });
    }
  }
  return finalMessages(TOOL_CONFIG.cap);
};
