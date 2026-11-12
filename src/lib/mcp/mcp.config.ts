export const MCP_CONFIG = {
  timeoutMs: 10_000, callTimeoutMs: 60_000, nameChars: 28,
  client: { name: "apple-fm-acp", version: "0.1.0" },
  failed: "MCP server skipped", nonText: "[Non-text MCP content]", invalid: "Invalid tool arguments",
} as const;

/** Comma-separated globs match remote names or full sanitized server__tool names. */
export const MCP_POLICY = {
  allowEnv: "APPLE_FM_ACP_MCP_ALLOW",
  denyEnv: "APPLE_FM_ACP_MCP_DENY",
  defaultAllow: ["html_preview", "html_render", "*__html_preview", "*__html_render"],
  defaultDeny: ["preview_*", "device_*", "t3_*", "*__preview_*", "*__device_*", "*__t3_*"],
} as const;
