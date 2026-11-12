import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { z } from "zod";
import { ACTION_E2E_CONFIG as C } from "./action-turn-e2e.config.ts";
import { FmServer } from "./lib/fm/fm-server.ts";
import { runToolLoop } from "./lib/agent/agent-loop.ts";
import { positiveConfig } from "./lib/tools/tools.config.ts";
import { builtinTools } from "./lib/tools/tool-registry.ts";
import type { Tool } from "./lib/tools/tools.types.ts";

test("real fm action confirmations and HTML arguments", {
  skip: process.env[C.enabledEnv] !== "1", timeout: C.suiteTimeoutMs,
}, async (t) => {
  let fm: FmServer | undefined;
  const scores: Record<string, number> = {};
  try {
    for (const scenario of ["write", "render"] as const) {
      let passes = 0;
      for (let trial = 0; trial < C.trials; trial++) {
        const cwd = await mkdtemp(join(tmpdir(), "fm-action-"));
        const calls: { name: string; args: Record<string, unknown> }[] = [];
        let reply = "";
        let error = "";
        let html = "";
        let content = "";
        const schema = z.object({ html: z.string() });
        const remote: Tool = {
          name: C.renderName, description: C.renderDescription, readOnly: true, kind: "other",
          schema: z.toJSONSchema(schema), validate: (value) => schema.parse(value),
          run: async (args) => { html = schema.parse(args).html; return C.renderResult; },
        };
        const core = builtinTools("local", cwd, {}, async () => ({ outcome: { outcome: "selected", optionId: "allow_once" } }));
        const tools = [...core, remote].map((tool) => ({ ...tool, run: async (args: Record<string, unknown>, signal: AbortSignal) => {
          calls.push({ name: tool.name, args });
          return tool.run(args, signal);
        } }));
        const prompts = scenario === "write" ? C.writePrompts : C.renderPrompts;
        const prompt = prompts[trial % prompts.length] ?? prompts[0];
        try {
          fm = await FmServer.start();
          const server = fm;
          const abort = new AbortController();
          const signal = abort.signal;
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            await Promise.race([(async () => {
              const { messages, reply: actionReply } = await runToolLoop(server, tools, [{ role: "user", content: prompt }], "local", () => {},
                async () => ({ outcome: { outcome: "selected", optionId: "allow_once" } }), signal);
              reply = actionReply ?? "";
              if (actionReply === undefined) for await (const event of server.chat(messages, signal)) {
                if (event.type === "delta") reply += event.text;
                if (event.type === "error") throw new Error(event.message);
              }
              if (scenario === "write") content = await readFile(join(cwd, C.file), "utf8");
            })(), new Promise<never>((_, reject) => {
              timer = setTimeout(() => { abort.abort(); reject(new Error(C.timeoutMessage)); }, positiveConfig(C.timeoutEnv, C.timeoutMs));
            })]);
          } finally { clearTimeout(timer); abort.abort(); fm.stop(); fm = undefined; }
        } catch (cause) { error = String(cause); }
        finally { await rm(cwd, { recursive: true, force: true }); }
        const confirmation = reply.trim().length > 0 && reply.length <= C.maxReplyChars && !reply.includes(C.content)
          && !/<(?:!doctype|html|h1|style)\b/i.test(reply);
        const passed = !error && (scenario === "write"
          ? content === C.content && confirmation && /notes\.txt/i.test(reply) && /creat|wrot|writ|sav|made/i.test(reply)
          : /color\s*:\s*(?:blue\b|#00f\b|#0000ff\b|rgb\(\s*0\s*,\s*0\s*,\s*255\s*\))/i.test(html)
            && /<h[1-6]\b/i.test(html)
            && /hello/i.test(html) && !html.includes("var(--") && confirmation);
        if (passed) passes++;
        console.error(JSON.stringify({ scenario, trial: trial + 1, prompt, calls, reply, content, html, passed, error }));
      }
      scores[scenario] = passes;
      t.diagnostic(JSON.stringify({ scenario, passes, trials: C.trials }));
    }
  } finally { fm?.stop(); }
  assert.ok(Object.values(scores).every((score) => score === C.trials), JSON.stringify(scores));
});
