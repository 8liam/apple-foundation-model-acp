export const FM_CONFIG = {
  binary: "fm",
  serveArgs: ["serve", "--socket"],
  socketPrefix: "apple-fm-acp-",
  socketSuffix: ".sock",
  model: "system",
  healthPath: "/health",
  chatPath: "/v1/chat/completions",
  host: "fm.local",
  startupTimeoutMs: 15_000,
  startupPollMs: 100,
  streamDoneMarker: "[DONE]",
  sseDataPrefix: "data:",
  sseEventPrefix: "event:",
  sseErrorEvent: "error",
} as const;

export const FM_ERRORS = {
  startupTimeout: "Timed out waiting for `fm serve` to become ready",
  serverExited: "`fm serve` exited before becoming ready",
  httpStatus: (status: number, body: string) => `fm serve returned HTTP ${status}: ${body}`,
  noBody: "fm serve returned an empty response body",
} as const;
