import assert from "node:assert/strict";
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { test } from "node:test";

type Message = { id?: number; method?: string; params?: { update?: { content?: { text?: string } } }; result?: Record<string, unknown>; error?: { code: number } };

class Client {
  readonly proc: ChildProcessWithoutNullStreams = spawn("node", ["src/main.ts"]);
  readonly #pending = new Map<number, (m: Message) => void>();
  readonly chunks: string[] = [];
  #id = 0;

  constructor() {
    createInterface({ input: this.proc.stdout }).on("line", (line) => {
      const message = JSON.parse(line) as Message;
      if (message.method === "session/update") this.chunks.push(message.params?.update?.content?.text ?? "");
      else if (message.id !== undefined) this.#pending.get(message.id)?.(message);
    });
  }

  request(method: string, params: unknown): Promise<Message> {
    const id = ++this.#id;
    return new Promise((resolve) => {
      this.#pending.set(id, resolve);
      this.proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  notify(method: string, params: unknown): void {
    this.proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }
}

test("initialize, multi-turn prompt, cancel, and errors over stdio", { timeout: 60_000 }, async () => {
  const client = new Client();
  try {
    const init = await client.request("initialize", { protocolVersion: 1 });
    assert.equal(init.result?.protocolVersion, 1);

    const created = await client.request("session/new", { cwd: "/tmp", mcpServers: [] });
    const sessionId = created.result?.sessionId as string;

    const first = await client.request("session/prompt", {
      sessionId,
      prompt: [{ type: "text", text: "My name is Zorblax. Reply with just OK." }],
    });
    assert.equal(first.result?.stopReason, "end_turn");
    assert.notEqual(client.chunks.length, 0);

    client.chunks.length = 0;
    await client.request("session/prompt", { sessionId, prompt: [{ type: "text", text: "What is my name?" }] });
    assert.notEqual(client.chunks.join("").trim(), "");

    client.chunks.length = 0;
    const pending = client.request("session/prompt", {
      sessionId,
      prompt: [{ type: "text", text: "Write a 2000 word story about a dragon." }],
    });
    while (client.chunks.length === 0) await new Promise((resolve) => setTimeout(resolve, 10));
    client.notify("session/cancel", { sessionId });
    assert.equal((await pending).result?.stopReason, "cancelled");

    const unknown = await client.request("session/prompt", { sessionId: "nope", prompt: [] });
    assert.equal(unknown.error?.code, -32602);
    assert.equal((await client.request("bogus/method", {})).error?.code, -32601);
  } finally {
    client.proc.kill();
  }
});
