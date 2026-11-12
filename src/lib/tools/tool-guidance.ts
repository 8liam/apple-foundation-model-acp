import { z } from "zod";
import { TOOL_ARGS_HINTS, TOOL_ACTIONS, TOOL_CONFIG, ACTION_TEXT, TOOL_ACTION_SUMMARIES } from "./tools.config.ts";
import type { Tool, ToolOutcome } from "./tools.types.ts";

export const matchesTool = (name: string, suffix: string): boolean => name === suffix || name.endsWith(`_${suffix}`);

export const toolArgsGuidance = (tool: Tool): string => [
  TOOL_CONFIG.args + tool.name,
  tool.kind === "other" ? tool.description.slice(0, TOOL_CONFIG.argsDescriptionChars) : tool.description,
  ...Object.entries(TOOL_ARGS_HINTS).filter(([suffix]) => matchesTool(tool.name, suffix)).map(([, hint]) => hint),
].join("\n");

export const isActionTool = (tool: Tool): boolean => !tool.readOnly || TOOL_ACTIONS.some((suffix) => matchesTool(tool.name, suffix));

/** Summaries never include tool output, file content, command arguments or HTML. */
export const actionSummary = (outcome: ToolOutcome): string => {
  const { name, args, succeeded } = outcome;
  const target = typeof args.path === "string" ? JSON.stringify(args.path.slice(0, TOOL_CONFIG.summaryTargetChars)) : "";
  if (!succeeded) return ACTION_TEXT.failed(name, target);
  const format = Object.entries(TOOL_ACTION_SUMMARIES).find(([suffix]) => matchesTool(name, suffix))?.[1];
  if (format) return format(target);
  return ACTION_TEXT.completed(name);
};

/** Both local and ACP terminal backends return a structured exit result. */
export const commandFailed = (name: string, output: string): boolean => {
  if (name !== TOOL_CONFIG.commandTool) return false;
  try {
    const result: unknown = JSON.parse(output);
    const parsed = z.object({ exit: z.object({ code: z.number().nullable().optional(), exitCode: z.number().optional(), signal: z.string().nullable().optional() }) }).safeParse(result);
    if (!parsed.success) return false;
    const exit = parsed.data.exit;
    return (exit.code !== undefined && exit.code !== 0) || (exit.exitCode !== undefined && exit.exitCode !== 0) || Boolean(exit.signal);
  } catch { return false; }
};
