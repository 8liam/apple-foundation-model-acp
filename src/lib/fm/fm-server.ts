import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { type IncomingMessage, request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { FM_CONFIG, FM_ERRORS } from "./fm.config.ts";
import { readChatStream } from "./fm-stream.ts";
import type { ChatMessage, ChatStreamEvent } from "./fm.types.ts";

/** Owns an `fm serve` child bound to a private unix socket and talks chat-completions to it. */
export class FmServer {
  readonly #dir: string;
  readonly #socket: string;
  readonly #child: ChildProcess;
  #exited = false;

  private constructor() {
    this.#dir = mkdtempSync(join(tmpdir(), FM_CONFIG.socketPrefix));
    this.#socket = join(this.#dir, `fm${FM_CONFIG.socketSuffix}`);
    this.#child = spawn(FM_CONFIG.binary, [...FM_CONFIG.serveArgs, this.#socket], {
      stdio: ["ignore", "ignore", "ignore"],
    });
    this.#child.once("exit", () => {
      this.#exited = true;
    });
  }

  static async start(): Promise<FmServer> {
    const server = new FmServer();
    try {
      await server.#waitUntilReady();
    } catch (error) {
      server.stop();
      throw error;
    }
    return server;
  }

  stop(): void {
    this.#child.kill();
    rmSync(this.#dir, { recursive: true, force: true });
  }

  async *chat(messages: ChatMessage[], signal: AbortSignal): AsyncGenerator<ChatStreamEvent> {
    const body = JSON.stringify({ model: FM_CONFIG.model, stream: true, messages });
    const response = await this.#send("POST", FM_CONFIG.chatPath, body, signal);
    if (response.statusCode !== 200) {
      throw new Error(FM_ERRORS.httpStatus(response.statusCode ?? 0, await collect(response)));
    }
    yield* readChatStream(response);
  }

  async #waitUntilReady(): Promise<void> {
    const deadline = Date.now() + FM_CONFIG.startupTimeoutMs;
    while (Date.now() < deadline) {
      if (this.#exited) throw new Error(FM_ERRORS.serverExited);
      try {
        const response = await this.#send("GET", FM_CONFIG.healthPath);
        response.resume();
        if (response.statusCode === 200) return;
      } catch {
        // socket not created yet
      }
      await sleep(FM_CONFIG.startupPollMs);
    }
    throw new Error(FM_ERRORS.startupTimeout);
  }

  #send(method: "GET" | "POST", path: string, body?: string, signal?: AbortSignal): Promise<IncomingMessage> {
    return new Promise((resolve, reject) => {
      const req = request(
        {
          socketPath: this.#socket,
          method,
          path,
          headers: {
            host: FM_CONFIG.host,
            ...(body === undefined ? {} : { "content-type": "application/json" }),
          },
          signal,
        },
        resolve,
      );
      req.once("error", reject);
      req.end(body);
    });
  }
}

const collect = async (stream: AsyncIterable<Uint8Array>): Promise<string> => {
  const decoder = new TextDecoder();
  let text = "";
  for await (const chunk of stream) text += decoder.decode(chunk, { stream: true });
  return text;
};
