export const AGENT_CONFIG = {
  sessionIdPrefix: "sess_",
  /** The on-device model has a small context window; keep a rough character budget for history. */
  historyCharBudget: 8_000,
  instructions:
    "You are a helpful assistant running on-device via Apple Foundation Models inside a code editor. " +
    "You cannot read files, run commands, or browse; answer from the conversation alone. Be concise.",
} as const;

/** Tags clients commonly use to wrap the user's actual message inside injected scaffolding. */
export const REQUEST_TAGS = ["user_request", "user_message", "user_query", "user_prompt", "request", "query"] as const;

export const AGENT_TEXT = {
  resourceLink: (uri: string) => `[Linked resource: ${uri}]`,
  resource: (uri: string, text: string) => `[Resource: ${uri}]\n${text}`,
  unsupportedImage: "[An image was attached but images are not supported.]",
  unsupportedAudio: "[Audio was attached but audio is not supported.]",
} as const;

export const AGENT_ERRORS = {
  unknownSession: (id: string) => `Unknown session: ${id}`,
  promptInFlight: (id: string) => `Session ${id} already has a prompt in progress`,
  invalidParams: (method: string, detail: string) => `Invalid params for ${method}: ${detail}`,
} as const;
