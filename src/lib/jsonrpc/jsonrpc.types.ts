import type { JSONRPC_ERROR, JSONRPC_VERSION } from "./jsonrpc.config.ts";

export type JsonRpcId = string | number;

export type JsonRpcErrorCode = (typeof JSONRPC_ERROR)[keyof typeof JSONRPC_ERROR];

export type JsonRpcErrorBody = {
  code: number;
  message: string;
  data?: unknown;
};

export type JsonRpcResponse =
  | { jsonrpc: typeof JSONRPC_VERSION; id: JsonRpcId | null; result: unknown }
  | { jsonrpc: typeof JSONRPC_VERSION; id: JsonRpcId | null; error: JsonRpcErrorBody };

export type JsonRpcHandlers = {
  /** Resolve with the `result`; throw `JsonRpcError` for a protocol error. */
  onRequest: (method: string, params: unknown) => Promise<unknown>;
  onNotification: (method: string, params: unknown) => void;
};
