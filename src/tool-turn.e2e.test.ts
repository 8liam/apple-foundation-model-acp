import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { test } from "node:test";
import { z } from "zod";
import { TOOL_E2E_CONFIG } from "./tool-turn-e2e.config.ts";

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
test("real fm local scenarios with 70 MCP distractors", { skip: process.env[TOOL_E2E_CONFIG.enabledEnv] !== "1", timeout: TOOL_E2E_CONFIG.suiteTimeoutMs }, async (t) => {
  const { FmServer } = await import("./lib/fm/fm-server.ts");
  const { builtinTools } = await import("./lib/tools/tool-registry.ts");
  const { runToolLoop } = await import("./lib/agent/agent-loop.ts");
  const { mcpToolAllowed } = await import("./lib/mcp/mcp-policy.ts");
  const fm = await FmServer.start();
  const scores: Record<string, number> = {};
  try {
    for (const scenario of TOOL_E2E_CONFIG.scenarios) {
      let passes = 0;
      for (let trial = 0; trial < TOOL_E2E_CONFIG.trials; trial++) {
        const calls: { name: string; args: Record<string, unknown>; succeeded: boolean }[] = [];
        const core = builtinTools("local", process.cwd(), {}, async () => { throw new Error("Unexpected ACP file/terminal request"); })
          .map((tool) => ({ ...tool, run: async (args: Record<string, unknown>, signal: AbortSignal) => {
            const call = { name: tool.name, args, succeeded: false };
            calls.push(call);
            const result = await tool.run(args, signal);
            call.succeeded = true;
            return result;
          } }));
        const base = core[0];
        assert.ok(base);
        const remoteNames = ["html_preview", "html_render", ...Array.from({ length: 68 }, (_, i) =>
          ["preview_act", "device_list", "t3_thread_read", "t3_task_status"][i % 4] + "_" + i)];
        const remotes = remoteNames.filter((name) => mcpToolAllowed(name, "t3_code__" + name))
          .map((name) => ({ ...base, name: "t3_code__" + name, description: "T3 Code " + name, schema: { type: "object", properties: {} },
            run: async () => { calls.push({ name, args: {}, succeeded: false }); throw new Error("Presentation tool cannot read files"); } }));
        const signal = AbortSignal.timeout(TOOL_E2E_CONFIG.turnTimeoutMs);
        const prompt = scenario.prompts[trial % scenario.prompts.length] ?? scenario.prompts[0];
        let reply = "";
        let error = "";
        try {
          const messages = await runToolLoop(fm, [...core, ...remotes], [{ role: "user", content: prompt }],
            "local", () => {}, async () => ({ outcome: { outcome: "selected", optionId: "allow_once" } }), signal);
          for await (const event of fm.chat(messages, signal)) {
            if (event.type === "delta") reply += event.text;
            if (event.type === "error") throw new Error(event.message);
          }
        } catch (cause) { error = String(cause); }
        const evidence = scenario.name === "package" ? calls.some((call) => call.succeeded && call.name === "read_file" && String(call.args.path).endsWith("package.json"))
          : scenario.name === "folders" ? calls.some((call) => call.succeeded && call.name === "list_directory")
          : calls.some((call) => call.succeeded && call.name === "search_files");
        const passed = !error && reply.trim().length > 0 && (scenario.tools ? evidence : calls.length === 0)
          && scenario.expected.every((text) => reply.includes(text)) && !/\[tool call\]|ENOENT|cannot read|unable to read|can't read/i.test(reply);
        if (passed) passes++;
        t.diagnostic(JSON.stringify({ scenario: scenario.name, trial: trial + 1, prompt, calls, passed, reply, error }));
      }
      scores[scenario.name] = passes;
      t.diagnostic(JSON.stringify({ scenario: scenario.name, passes, trials: TOOL_E2E_CONFIG.trials }));
    }
  } finally { fm.stop(); }
  assert.ok(Object.values(scores).every((passes) => passes === TOOL_E2E_CONFIG.trials), JSON.stringify(scores));
});
