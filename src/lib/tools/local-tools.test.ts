import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { builtinTools } from "./tool-registry.ts";
import { TOOL_CONFIG } from "./tools.config.ts";

test("local tools read, write, edit exactly once, list and search", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "local-tools-"));
  const tools = builtinTools("s", cwd, {}, async () => { throw new Error("unexpected ACP"); });
  const run = (name: string, args: Record<string, unknown>) => {
    const tool = tools.find((tool) => tool.name === name);
    assert.ok(tool); return tool.run(args, new AbortController().signal);
  };
  try {
    assert.deepEqual(tools.map((tool) => tool.name), ["read_file", "write_file", "edit_file", "run_command", "list_directory", "search_files"]);
    for (const content of ["none", "aa", "a"]) {
      await run("write_file", { path: "f", content });
      const edit = run("edit_file", { path: "f", old_text: "a", new_text: "$&" });
      if (content === "a") assert.equal(await edit, "$&");
      else await assert.rejects(edit, /exactly one/);
    }
    await run("write_file", { path: "f", content: "one\ntwo\nthree" });
    assert.equal(await run("read_file", { path: "f", line: 2, limit: 1 }), "two");
    assert.match(await run("list_directory", {}), /f/);
    assert.match(await run("search_files", { query: "two" }), /f:2:two/);
    await assert.rejects(run("read_file", { path: "../outside" }), /escapes/);
    await assert.rejects(run("write_file", { path: "../outside", content: "" }), /escapes/);
    const outside = await mkdtemp(join(tmpdir(), "outside-tools-"));
    try {
      await writeFile(join(outside, "secret"), "secret");
      await symlink(outside, join(cwd, "link"));
      await assert.rejects(run("read_file", { path: "link/secret" }), /escapes/);
      await assert.rejects(run("write_file", { path: "link/new", content: "" }), /escapes/);
      await symlink(join(outside, "missing"), join(cwd, "dangling"));
      await assert.rejects(run("write_file", { path: "dangling", content: "" }), /escapes/);
    } finally { await rm(outside, { recursive: true, force: true }); }
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

test("fallback is selected independently per advertised capability", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "backend-tools-"));
  const calls: string[] = [];
  try {
    await writeFile(join(cwd, "f"), "local");
    const tools = builtinTools("s", cwd, { fs: { readTextFile: false, writeTextFile: true } }, async (method) => { calls.push(method); return {}; });
    const edit = tools.find((tool) => tool.name === "edit_file");
    assert.ok(edit);
    assert.equal(await edit.run({ path: "f", old_text: "local", new_text: "client" }, new AbortController().signal), "client");
    assert.deepEqual(calls, [TOOL_CONFIG.write]);
    assert.equal(await readFile(join(cwd, "f"), "utf8"), "local");
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

test("local commands use literal arguments, cwd, bounded output, timeout and cancellation", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "command-tools-"));
  const tool = builtinTools("s", cwd, {}, async () => null).find((tool) => tool.name === "run_command");
  assert.ok(tool);
  const previous = process.env[TOOL_CONFIG.commandTimeoutEnv];
  const run = (args: string[], signal = new AbortController().signal) => tool.run({ command: process.execPath, args }, signal);
  try {
    const output = await run(["-e", "console.log(process.cwd(), process.argv[1])", "$(echo injected)"]);
    assert.match(output, /command-tools-/);
    assert.match(output, /\$\(echo injected\)/);
    const large = JSON.parse(await run(["-e", "process.stdout.write('x'.repeat(100000))"])) as { output: string; truncated: boolean };
    assert.equal(Buffer.byteLength(large.output), TOOL_CONFIG.outputBytes);
    assert.equal(large.truncated, true);
    process.env[TOOL_CONFIG.commandTimeoutEnv] = "50";
    await assert.rejects(run(["-e", "setInterval(()=>{}, 1000)"]), /timeout/i);
    process.env[TOOL_CONFIG.commandTimeoutEnv] = "5000";
    const controller = new AbortController();
    const running = run(["-e", "setInterval(()=>{}, 1000)"], controller.signal);
    setTimeout(() => controller.abort(), 50);
    await assert.rejects(running, /abort/i);
    await assert.rejects(tool.run({ command: process.execPath, cwd: ".." }, new AbortController().signal), /escapes/);
  } finally {
    if (previous === undefined) delete process.env[TOOL_CONFIG.commandTimeoutEnv];
    else process.env[TOOL_CONFIG.commandTimeoutEnv] = previous;
    await rm(cwd, { recursive: true, force: true });
  }
});

test("local mutations go through ACP permission before touching disk", async () => {
  const { runToolLoop } = await import("../agent/agent-loop.ts");
  const cwd = await mkdtemp(join(tmpdir(), "permission-tools-"));
  try {
    for (const allowed of [false, true]) {
      const script: unknown[] = [{ action: "write_file" }, { path: "f", content: "permitted" }, { action: "reply" }];
      let requests = 0;
      await runToolLoop({ complete: async () => script.shift() }, builtinTools("s", cwd, {}, async () => null),
        [{ role: "user", content: "write f" }], "s", () => {}, async (method) => {
          assert.equal(method, TOOL_CONFIG.permission);
          requests++;
          return { outcome: { outcome: "selected", optionId: allowed ? TOOL_CONFIG.allow : TOOL_CONFIG.reject } };
        }, new AbortController().signal);
      assert.equal(requests, 1);
      if (allowed) assert.equal(await readFile(join(cwd, "f"), "utf8"), "permitted");
      else await assert.rejects(readFile(join(cwd, "f")), /ENOENT/);
    }
  } finally { await rm(cwd, { recursive: true, force: true }); }
});
