export const MCP_CONFIG = {
  timeoutMs: 10_000, callTimeoutMs: 60_000, nameChars: 28,
  client: { name: "apple-fm-acp", version: "0.1.0" },
  failed: "MCP server skipped", nonText: "[Non-text MCP content]", invalid: "Invalid tool arguments",
} as const;
