export const AGENT_CONFIG = {
  sessionIdPrefix: "sess_",
  /** The on-device model has a small context window; keep a rough character budget for history. */
  historyCharBudget: 8_000,
  /** Optional env var: custom system instructions. Unset means the model's own defaults, like `fm chat`. */
  instructionsEnvVar: "APPLE_FM_ACP_INSTRUCTIONS",
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
