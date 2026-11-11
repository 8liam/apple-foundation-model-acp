import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { ChatMessage } from "../fm/fm.types.ts";
import type { FmServer } from "../fm/fm-server.ts";
import type { ClientRequest, Tool } from "../tools/tools.types.ts";
import { TOOL_CONFIG, positiveConfig } from "../tools/tools.config.ts";
import { abortable } from "../tools/tool-registry.ts";
import { fallbackSchema, sanitizeSchema } from "../tools/tool-schema.ts";
import { AGENT_CONFIG } from "./agent.config.ts";
import type { SessionUpdateSink } from "./agent.types.ts";
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

/** The loop returns ephemeral tool observations; only the final reply is persisted. */
export const runToolLoop = async (fm: Pick<FmServer, "complete">, tools: Tool[], history: ChatMessage[],
  sessionId: string, emit: SessionUpdateSink, request: ClientRequest, signal: AbortSignal, instructions?: string): Promise<ChatMessage[]> => {
  const working = [...history];
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
    let name: string = TOOL_CONFIG.reply;
    try {
      name = z.object({ action: z.enum([TOOL_CONFIG.reply, ...available.map((tool) => tool.name)]) }).parse(
        await fm.complete(messages(TOOL_CONFIG.decide + catalogue), decideSchema, signal)).action;
      if (name === TOOL_CONFIG.reply) return messages(TOOL_CONFIG.final);
      const tool = available.find((candidate) => candidate.name === name);
      if (!tool) continue;
      const argsPrompt = TOOL_CONFIG.args + tool.name + "\n" + tool.description;
      let raw: unknown;
      try { raw = await fm.complete(messages(argsPrompt), sanitizeSchema(tool.schema), signal); }
      catch (error) {
        signal.throwIfAborted();
        raw = JSON.parse(z.object({ json: z.string() }).parse(await fm.complete(messages(argsPrompt + "\n" + TOOL_CONFIG.fallback), fallbackSchema, signal)).json) as unknown;
      }
      const args = tool.validate(raw);
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
      } catch (error) { status = "failed"; output = String(error); }
      emit(sessionId, { sessionUpdate: "tool_call_update", toolCallId, status,
        content: [{ type: "content", content: { type: "text", text: truncateResult(output) } }], rawOutput: output });
      signal.throwIfAborted();
      working.push({ role: "assistant", content: `${TOOL_CONFIG.callMarker} ${name} ${JSON.stringify(args)}` },
        { role: "user", content: `${TOOL_CONFIG.resultMarker} ${name}\n${truncateResult(output)}` });
    } catch (error) {
      signal.throwIfAborted();
      working.push({ role: "user", content: `${TOOL_CONFIG.errorMarker} ${name}\n${truncateResult(String(error))}` });
    }
  }
  return messages(TOOL_CONFIG.final + "\n" + TOOL_CONFIG.cap);
};
