import type { ChatMessage } from "../fm/fm.types.ts";

export type Session = {
  id: string;
  tools: import("../tools/tools.types.ts").Tool[];
  close: () => Promise<void>;
  /** User/assistant turns only; the system instructions are prepended per request. */
  history: ChatMessage[];
  /** Set while a prompt turn is running. */
  abort: AbortController | null;
};

export type StopReason = "end_turn" | "max_tokens" | "refusal" | "cancelled";

export type SessionUpdate =
  | { sessionUpdate: "agent_message_chunk"; content: { type: "text"; text: string } }
  | { sessionUpdate: "tool_call"; toolCallId: string; title: string; kind: "read" | "edit" | "execute" | "other"; status: "pending" | "in_progress"; rawInput: unknown }
  | { sessionUpdate: "tool_call_update"; toolCallId: string; status: "completed" | "failed"; content?: { type: "content"; content: { type: "text"; text: string } }[]; rawOutput?: unknown };
export type SessionUpdateSink = (sessionId: string, update: SessionUpdate) => void;
