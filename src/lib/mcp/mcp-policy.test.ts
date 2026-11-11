import assert from "node:assert/strict";
import { test } from "node:test";
import { mcpToolAllowed } from "./mcp-policy.ts";
import { toolCatalogue } from "../agent/agent-loop.ts";
import { builtinTools } from "../tools/tool-registry.ts";

test("default MCP policy admits presentation and excludes noisy and unknown tools", () => {
  for (const name of ["html_render", "html_preview"]) assert.equal(mcpToolAllowed(name, "t3_code__" + name), true);
  for (const name of ["preview_act", "device_list", "t3_thread_launch", "unknown"]) assert.equal(mcpToolAllowed(name, "t3_code__" + name), false);
});
test("explicit allow replaces defaults; explicit deny wins; glob metacharacters are literal", () => {
  assert.equal(mcpToolAllowed("preview_act", "t3_code__preview_act", "preview_*"), true);
  assert.equal(mcpToolAllowed("preview_act", "t3_code__preview_act", "*", "*__preview_*"), false);
  assert.equal(mcpToolAllowed("echo", "fixture__echo", "fixture__*"), true);
  assert.equal(mcpToolAllowed("echo", "fixture__echo", ""), false);
  assert.equal(mcpToolAllowed("ax", "s__ax", "a."), false);
});
test("filtering leaves budget for allowed MCP tools after core tools", () => {
  const core = builtinTools("s", "/repo", {}, async () => null);
  const distractors = Array.from({ length: 70 }, (_, index) => ({ ...core[0]!, name: "t3_code__preview_" + index }));
  const render = { ...core[0]!, name: "t3_code__html_render" };
  const filtered = [...distractors, render].filter((tool) => mcpToolAllowed(tool.name.split("__")[1]!, tool.name));
  const catalogue = toolCatalogue([...core, ...filtered], 650);
  assert.ok(catalogue.startsWith("read_file:"));
  assert.ok(catalogue.includes(render.name));
  assert.ok(catalogue.length <= 650);
  assert.ok(!catalogue.includes("preview_"));
});
