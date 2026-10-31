import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { z } from "zod";
import { JSONRPC_ERROR, JSONRPC_MESSAGES, JSONRPC_VERSION } from "./jsonrpc.config.ts";
import { JsonRpcError } from "./jsonrpc.error.ts";
import type { JsonRpcHandlers, JsonRpcId, JsonRpcResponse } from "./jsonrpc.types.ts";

const idSchema = z.union([z.string(), z.number()]);

const incomingSchema = z.object({
  jsonrpc: z.literal(JSONRPC_VERSION),
  id: idSchema.optional(),
  method: z.string(),
  params: z.unknown().optional(),
});

/**
 * Newline-delimited JSON-RPC 2.0 over a pair of streams (ACP's stdio transport).
 * Each inbound request is dispatched without awaiting the previous one, so a
 * `session/cancel` can arrive while a `session/prompt` is still running.
 */
export class JsonRpcConnection {
  readonly #output: Writable;
  readonly #handlers: JsonRpcHandlers;

  constructor(input: Readable, output: Writable, handlers: JsonRpcHandlers) {
    this.#output = output;
    this.#handlers = handlers;
    createInterface({ input, crlfDelay: Infinity }).on("line", (line) => {
      if (line.trim() !== "") void this.#receive(line);
    });
  }

  notify(method: string, params: unknown): void {
    this.#write({ jsonrpc: JSONRPC_VERSION, method, params });
  }

  async #receive(line: string): Promise<void> {
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      this.#respondError(null, new JsonRpcError(JSONRPC_ERROR.parseError, JSONRPC_MESSAGES.parseError));
      return;
    }

    const parsed = incomingSchema.safeParse(raw);
    if (!parsed.success) {
      // Responses to requests we never send (agent->client) are ignored.
      if (typeof raw === "object" && raw !== null && !("method" in raw)) return;
      this.#respondError(null, new JsonRpcError(JSONRPC_ERROR.invalidRequest, JSONRPC_MESSAGES.invalidRequest));
      return;
    }

    const { id, method, params } = parsed.data;
    if (id === undefined) {
      this.#handlers.onNotification(method, params);
      return;
    }

    try {
      const result = await this.#handlers.onRequest(method, params);
      this.#respond({ jsonrpc: JSONRPC_VERSION, id, result: result ?? null });
    } catch (error) {
      this.#respondError(id, toJsonRpcError(error));
    }
  }

  #respondError(id: JsonRpcId | null, error: JsonRpcError): void {
    this.#respond({ jsonrpc: JSONRPC_VERSION, id, error: error.toBody() });
  }

  #respond(response: JsonRpcResponse): void {
    this.#write(response);
  }

  #write(message: unknown): void {
    this.#output.write(`${JSON.stringify(message)}\n`);
  }
}

const toJsonRpcError = (error: unknown): JsonRpcError =>
  error instanceof JsonRpcError
    ? error
    : new JsonRpcError(
        JSONRPC_ERROR.internalError,
        error instanceof Error ? error.message : JSONRPC_MESSAGES.internalError,
      );
