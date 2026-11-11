import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { z } from "zod";
import { JSONRPC_ERROR, JSONRPC_MESSAGES, JSONRPC_VERSION } from "./jsonrpc.config.ts";
import { JsonRpcError } from "./jsonrpc.error.ts";
import type { JsonRpcHandlers, JsonRpcId, JsonRpcResponse } from "./jsonrpc.types.ts";

const idSchema = z.union([z.string(), z.number()]);

const responseSchema = z.object({
  jsonrpc: z.literal(JSONRPC_VERSION), id: idSchema,
  result: z.unknown().optional(),
  error: z.object({ code: z.number(), message: z.string() }).optional(),
}).refine((value) => "result" in value || "error" in value);

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
  readonly #pending = new Map<JsonRpcId, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  #nextId = 0;
  #closed = false;
  readonly #output: Writable;
  readonly #handlers: JsonRpcHandlers;

  constructor(input: Readable, output: Writable, handlers: JsonRpcHandlers) {
    this.#output = output;
    this.#handlers = handlers;
    createInterface({ input, crlfDelay: Infinity }).on("line", (line) => {
      if (line.trim() !== "") void this.#receive(line);
    }).on("close", () => this.#close());
    input.on("error", () => this.#close());
    output.on("error", () => this.#close());
    output.on("close", () => this.#close());
  }

  #close(): void {
    this.#closed = true;
    for (const pending of this.#pending.values()) pending.reject(new Error(JSONRPC_MESSAGES.closed));
    this.#pending.clear();
  }

  request(method: string, params: unknown): Promise<unknown> {
    if (this.#closed) return Promise.reject(new Error(JSONRPC_MESSAGES.closed));
    const id = `agent_${++this.#nextId}`;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      try { this.#write({ jsonrpc: JSONRPC_VERSION, id, method, params }); }
      catch (error) { this.#pending.delete(id); reject(error); }
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

    const response = responseSchema.safeParse(raw);
    if (response.success) {
      const pending = this.#pending.get(response.data.id);
      this.#pending.delete(response.data.id);
      if (response.data.error) pending?.reject(new JsonRpcError(response.data.error.code, response.data.error.message));
      else pending?.resolve(response.data.result);
      return;
    }
    const parsed = incomingSchema.safeParse(raw);
    if (!parsed.success) {
      // Ignore unknown responses.
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
