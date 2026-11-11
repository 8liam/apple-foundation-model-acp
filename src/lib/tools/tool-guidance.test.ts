import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { actionSummary, commandFailed, isActionTool, toolArgsGuidance } from "./tool-guidance.ts";
import { TOOL_ARGS_HINTS, TOOL_CONFIG } from "./tools.config.ts";
import type { Tool } from "./tools.types.ts";

const remote = (name: string): Tool => ({
  name, description: "x".repeat(10_000), kind: "other", readOnly: true,
  schema: {}, validate: (value) => z.record(z.string(), z.unknown()).parse(value), run: async () => "payload",
});

test("MCP argument descriptions are bounded and suffix hints follow the description", () => {
  for (const suffix of ["html_render", "html_preview"]) {
    for (const name of [suffix, `t3_code__${suffix}`]) {
      const prompt = toolArgsGuidance(remote(name));
      assert.ok(prompt.endsWith(TOOL_ARGS_HINTS[suffix] ?? "missing"));
      assert.ok(prompt.includes("x".repeat(TOOL_CONFIG.argsDescriptionChars)));
      assert.ok(!prompt.includes("x".repeat(TOOL_CONFIG.argsDescriptionChars + 1)));
      assert.equal(isActionTool(remote(name)), true);
    }
  }
  assert.ok(!toolArgsGuidance(remote("remote__read")).includes("CSS"));
  assert.match(toolArgsGuidance({ ...remote("write_file"), kind: "edit", readOnly: false }), /exact filename requested/);
  assert.equal(isActionTool(remote("remote__read")), false);
  assert.equal(isActionTool({ ...remote("remote__write"), readOnly: false }), true);
});

test("action summaries exclude input and output payloads and identify failures", () => {
  assert.equal(actionSummary({ name: "write_file", args: { path: "notes.txt", content: "hello world" }, succeeded: true }), 'Wrote "notes.txt".');
  assert.equal(actionSummary({ name: "edit_file", args: { path: "notes.txt", new_text: "secret" }, succeeded: true }), 'Edited "notes.txt".');
  assert.equal(actionSummary({ name: "run_command", args: { command: "echo", args: ["secret"] }, succeeded: true }), "Ran the command successfully.");
  assert.match(actionSummary({ name: "write_file", args: { path: "notes.txt" }, succeeded: false }), /Failed.*write_file.*notes.txt/);
});


test("command exit failures cannot produce a success confirmation", () => {
  assert.equal(commandFailed("run_command", '{"exit":{"code":1}}'), true);
  assert.equal(commandFailed("run_command", '{"exit":{"exitCode":2}}'), true);
  assert.equal(commandFailed("run_command", '{"exit":{"code":null,"signal":"SIGTERM"}}'), true);
  assert.equal(commandFailed("run_command", '{"exit":{"code":0,"signal":null}}'), false);
  assert.equal(commandFailed("read_file", '{"exit":{"code":1}}'), false);
});
