import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { test } from "node:test";
import { z } from "zod";

// Model behaviour is variable: opt in, rather than make deterministic CI depend on it.
test("real fm selects read_file and answers with the file's name", { skip: process.env.APPLE_FM_ACP_TOOL_E2E !== "1", timeout: 120_000 }, async () => {
  const child = spawn(process.execPath, ["src/main.ts"], { stdio: ["pipe", "pipe", "inherit"] });
  const pending = new Map<number, (value: Record<string, unknown>) => void>();
  const calls: unknown[] = [];
  let reply = "";
  let id = 0;
  const send = (value: unknown) => child.stdin.write(JSON.stringify(value) + "\n");
  createInterface({ input: child.stdout }).on("line", (line) => {
    const message = z.object({ id: z.union([z.number(), z.string()]).optional(), method: z.string().optional(), params: z.unknown().optional(), result: z.unknown().optional(), error: z.unknown().optional() }).parse(JSON.parse(line));
    if (message.method === "fs/read_text_file") {
      calls.push(message.params);
      send({ jsonrpc: "2.0", id: message.id, result: { content: '{"name":"apple-fm-acp"}' } });
    } else if (message.method === "session/update") {
      const params = z.object({ update: z.object({ sessionUpdate: z.string(), content: z.object({ text: z.string() }).optional() }) }).safeParse(message.params);
      if (params.success && params.data.update.sessionUpdate === "agent_message_chunk") reply += params.data.update.content?.text ?? "";
    } else if (typeof message.id === "number") pending.get(message.id)?.(message);
  });
  const request = (method: string, params: unknown) => new Promise<Record<string, unknown>>((resolve) => {
    pending.set(++id, resolve); send({ jsonrpc: "2.0", id, method, params });
  });
  try {
    await request("initialize", { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: true } } });
    const created = await request("session/new", { cwd: process.cwd(), mcpServers: [] });
    const { sessionId } = z.object({ sessionId: z.string() }).parse(created.result);
    const result = await request("session/prompt", { sessionId, prompt: [{ type: "text", text: "Read package.json and tell me the name." }] });
    console.error("Real tool turn:", JSON.stringify({ calls, reply, result }));
    assert.ok(calls.length > 0, "model did not read a file");
    assert.match(reply, /apple-fm-acp/);
  } finally { child.kill(); }
});
