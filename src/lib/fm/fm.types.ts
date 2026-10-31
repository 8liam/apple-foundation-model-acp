export type ChatRole = "system" | "user" | "assistant";

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

export type ChatFinishReason = "stop" | "length" | "content_filter" | (string & {});

export type ChatStreamEvent =
  | { type: "delta"; text: string }
  | { type: "finish"; reason: ChatFinishReason }
  | { type: "error"; message: string };
