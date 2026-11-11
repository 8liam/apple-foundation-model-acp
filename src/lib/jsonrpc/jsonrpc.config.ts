export const JSONRPC_VERSION = "2.0" as const;

export const JSONRPC_ERROR = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
} as const;

export const JSONRPC_MESSAGES = {
  closed: "JSON-RPC connection closed",
  parseError: "Parse error",
  invalidRequest: "Invalid request",
  methodNotFound: "Method not found",
  internalError: "Internal error",
} as const;
