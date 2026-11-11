import type { z } from "zod";
import type { clientCapabilitiesSchema } from "../acp/acp.schemas.ts";
import type { SessionUpdate } from "../agent/agent.types.ts";
export type ClientRequest = (method: string, params: unknown) => Promise<unknown>;
export type Tool = {
  name: string; description: string; schema: Record<string, unknown>; readOnly: boolean;
  kind: Extract<SessionUpdate, { sessionUpdate: "tool_call" }>["kind"];
  validate: (value: unknown) => Record<string, unknown>;
  run: (args: Record<string, unknown>, signal: AbortSignal) => Promise<string>;
};
export type ClientCapabilities = z.infer<typeof clientCapabilitiesSchema>;

export type ReadOptions = { line?: number; limit?: number };
