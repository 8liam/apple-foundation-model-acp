import assert from "node:assert/strict";
import { test } from "node:test";
import { connectMcpTools, namespaceTool } from "./mcp-client.ts";

test("namespaces are sanitized, bounded and collision safe", () => {
  const used = new Set<string>();
  assert.equal(namespaceTool("A-b", "C!", used), "a_b__c_");
  assert.equal(namespaceTool("A-b", "C!", used), "a_b__c__1");
  assert.ok(namespaceTool("x".repeat(200), "y".repeat(200), used).length < 64);
});
test("real stdio SDK connection lists, validates, calls and closes", { timeout: 15000 }, async () => {
  const connected = await connectMcpTools([{ name: "Fixture", command: process.execPath, args: ["src/lib/mcp/fixtures/server.ts"], env: [] }], process.cwd());
  try {
    const tool = connected.tools[0];
    assert.ok(tool);
    assert.equal(tool.name, "fixture__echo_tool");
    assert.equal(tool.readOnly, true);
    assert.throws(() => tool.validate({ text: 1 }));
    assert.equal(await tool.run(tool.validate({ text: "hello" }), new AbortController().signal), "hello");
  } finally { await connected.close(); }
});
