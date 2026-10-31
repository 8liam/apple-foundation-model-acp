import type { ChatMessage } from "../fm/fm.types.ts";

export type Session = {
  id: string;
  /** User/assistant turns only; the system instructions are prepended per request. */
  history: ChatMessage[];
  /** Set while a prompt turn is running. */
  abort: AbortController | null;
};

export type StopReason = "end_turn" | "max_tokens" | "refusal" | "cancelled";

export type SessionUpdateSink = (sessionId: string, text: string) => void;
