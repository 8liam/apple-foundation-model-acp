export const AGENT_CONFIG = {
  sessionIdPrefix: "sess_",
  /** The on-device model has a small context window; keep a rough character budget for history. */
  historyCharBudget: 8_000,
  instructions:
    "You are a helpful assistant running on-device via Apple Foundation Models inside a code editor. " +
    "You cannot read files, run commands, or browse; answer from the conversation alone. Be concise.",
} as const;

/** Client-injected scaffolding meant for tool-using agents; it only confuses the small on-device model. */
export const CLIENT_SCAFFOLD_TAGS = ["t3_code_instructions", "runtime_info", "pull_request_linking"] as const;
export const USER_REQUEST_TAG = "user_request";

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
