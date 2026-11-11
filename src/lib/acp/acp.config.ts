export const ACP_PROTOCOL_VERSION = 1;

export const ACP_METHODS = {
  initialize: "initialize",
  authenticate: "authenticate",
  sessionNew: "session/new",
  sessionPrompt: "session/prompt",
  sessionCancel: "session/cancel",
  sessionUpdate: "session/update",
} as const;

export const ACP_UPDATE_KINDS = {
  agentMessageChunk: "agent_message_chunk",
} as const;

export const ACP_STOP_REASONS = {
  endTurn: "end_turn",
  maxTokens: "max_tokens",
  refusal: "refusal",
  cancelled: "cancelled",
} as const;

export const ACP_CONTENT_TYPES = {
  text: "text",
  resourceLink: "resource_link",
  resource: "resource",
  image: "image",
  audio: "audio",
} as const;

export const AGENT_INFO = {
  name: "apple-fm-acp",
  title: "Apple Foundation Models",
  version: "0.1.0",
} as const;

export const AGENT_CAPABILITIES = {
  loadSession: false,
  promptCapabilities: { image: false, audio: false, embeddedContext: true },
  mcpCapabilities: { http: true, sse: true },
} as const;
