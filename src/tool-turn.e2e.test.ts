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

// Exercise the local backend and production policy with a T3-sized remote catalogue.
test("real fm local file question with 70 MCP distractors (five trials)", { skip: process.env.APPLE_FM_ACP_TOOL_E2E !== "1", timeout: 600_000 }, async (t) => {
  const { FmServer } = await import("./lib/fm/fm-server.ts");
  const { builtinTools } = await import("./lib/tools/tool-registry.ts");
  const { runToolLoop } = await import("./lib/agent/agent-loop.ts");
  const { mcpToolAllowed } = await import("./lib/mcp/mcp-policy.ts");
  const fm = await FmServer.start();
  let passes = 0;
  try {
    for (let trial = 1; trial <= 5; trial++) {
      let read = false;
      const core = builtinTools("local", process.cwd(), {}, async () => { throw new Error("Unexpected ACP file/terminal request"); })
        .map((tool) => ({ ...tool, run: async (args: Record<string, unknown>, signal: AbortSignal) => {
          const result = await tool.run(args, signal);
          if (tool.name === "read_file" && String(args.path).endsWith("package.json")) read = true;
          return result;
        } }));
      const base = core[0];
      assert.ok(base);
      const remoteNames = ["html_preview", "html_render", ...Array.from({ length: 68 }, (_, i) =>
        ["preview_act", "device_list", "t3_thread_read", "t3_task_status"][i % 4] + "_" + i)];
      const remotes = remoteNames.filter((name) => mcpToolAllowed(name, "t3_code__" + name))
        .map((name) => ({ ...base, name: "t3_code__" + name, description: "T3 Code " + name, schema: { type: "object", properties: {} },
          run: async () => { throw new Error("Presentation tool cannot read files"); } }));
      const signal = AbortSignal.timeout(100_000);
      const messages = await runToolLoop(fm, [...core, ...remotes],
        [{ role: "user", content: "Read package.json and tell me the package name." }],
        "local", () => {}, async () => ({ outcome: { outcome: "selected", optionId: "allow_once" } }), signal);
      let reply = "";
      for await (const event of fm.chat(messages, signal)) if (event.type === "delta") reply += event.text;
      const passed = read && /apple-fm-acp/.test(reply) && !/\[tool call\]|read_file|ENOENT/.test(reply);
      if (passed) passes++;
      t.diagnostic(JSON.stringify({ trial, read, passed, reply }));
    }
    t.diagnostic("Local backend real-model pass rate: " + passes + "/5");
    assert.equal(passes, 5, "See trial diagnostics for model failures");
  } finally { fm.stop(); }
});
