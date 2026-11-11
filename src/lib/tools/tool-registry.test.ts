import assert from "node:assert/strict";
import { test } from "node:test";
import { builtinTools } from "./tool-registry.ts";

test("edit rejects ambiguous matches and resolves relative paths", async () => {
  for (const content of ["none", "aa", "a"]) {
    const seen: string[] = [];
    const tool = builtinTools("s", "/repo", { fs: { readTextFile: true, writeTextFile: true } }, async (method, params) => {
      seen.push(method); assert.equal((params as { path: string }).path, "/repo/f"); return { content };
    }).find((tool) => tool.name === "edit_file");
    assert.ok(tool);
    const operation = tool.run({ path: "f", old_text: "a", new_text: "$&" }, new AbortController().signal);
    if (content === "a") { assert.equal(await operation, "$&"); assert.equal(seen.length, 2); }
    else { await assert.rejects(operation); assert.equal(seen.length, 1); }
  }
});

test("terminal cancellation kills and releases", async () => {
  const seen: string[] = [];
  const abort = new AbortController();
  const tool = builtinTools("s", "/repo", { terminal: true }, async (method) => {
    seen.push(method);
    if (method === "terminal/create") return { terminalId: "t" };
    if (method === "terminal/wait_for_exit") { abort.abort(); return new Promise(() => {}); }
    return null;
  }).find((tool) => tool.name === "run_command");
  assert.ok(tool);
  await assert.rejects(tool.run({ command: "sleep", args: ["10"] }, abort.signal));
  assert.deepEqual(seen, ["terminal/create", "terminal/wait_for_exit", "terminal/kill", "terminal/release"]);
});

test("terminal timeout kills and releases", async () => {
  const previous = process.env.APPLE_FM_ACP_COMMAND_TIMEOUT_MS;
  process.env.APPLE_FM_ACP_COMMAND_TIMEOUT_MS = "10";
  const keepAlive = setInterval(() => {}, 1000);
  const seen: string[] = [];
  try {
    const tool = builtinTools("s", "/repo", { terminal: true }, async (method) => {
      seen.push(method);
      if (method === "terminal/create") return { terminalId: "t" };
      if (method === "terminal/wait_for_exit") return new Promise(() => {});
      return null;
    }).find((tool) => tool.name === "run_command");
    assert.ok(tool);
    await assert.rejects(tool.run({ command: "hang" }, new AbortController().signal), /timeout/i);
    assert.deepEqual(seen, ["terminal/create", "terminal/wait_for_exit", "terminal/kill", "terminal/release"]);
  } finally {
    clearInterval(keepAlive);
    if (previous === undefined) delete process.env.APPLE_FM_ACP_COMMAND_TIMEOUT_MS;
    else process.env.APPLE_FM_ACP_COMMAND_TIMEOUT_MS = previous;
  }
});
