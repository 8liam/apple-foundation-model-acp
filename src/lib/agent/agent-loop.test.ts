import assert from "node:assert/strict";
import { test } from "node:test";
import { FmAgent } from "./fm-agent.ts";
import { runToolLoop, toolCatalogue, truncateResult } from "./agent-loop.ts";
import { trimHistory } from "./history.ts";
import { builtinTools } from "../tools/tool-registry.ts";
import type { ClientRequest } from "../tools/tools.types.ts";
import type { SessionUpdate } from "./agent.types.ts";
import type { ChatStreamEvent } from "../fm/fm.types.ts";

const turn = async (script: unknown[], request: ClientRequest, caps = { fs: { readTextFile: true, writeTextFile: true } }) => {
  const updates: SessionUpdate[] = [];
  const calls: string[] = [];
  const agent = new FmAgent({
    complete: async () => { calls.push("complete"); return script.shift(); },
    async *chat(): AsyncGenerator<ChatStreamEvent> { yield { type: "delta", text: "done" }; },
  }, (_, update) => updates.push(update), undefined, request);
  await agent.handlers.onRequest("initialize", { protocolVersion: 1, clientCapabilities: caps });
  const session = await agent.handlers.onRequest("session/new", { cwd: "/repo" }) as { sessionId: string };
  const result = await agent.handlers.onRequest("session/prompt", { ...session, prompt: [{ type: "text", text: "work" }] });
  return { result, updates, calls };
};

test("loop reads through client and surfaces call lifecycle", async () => {
  const seen: unknown[] = [];
  const result = await turn([{ action: "read_file" }, { path: "package.json" }, { action: "reply" }], async (method, params) => {
    seen.push([method, params]); return { content: "hello" };
  });
  assert.deepEqual(seen, [["fs/read_text_file", { sessionId: (seen[0] as [string, { sessionId: string }])[1].sessionId, path: "/repo/package.json" }]]);
  assert.equal(result.updates[0]?.sessionUpdate, "tool_call");
  assert.equal(result.updates[1]?.sessionUpdate, "tool_call_update");
  assert.equal(result.updates[2]?.sessionUpdate, "agent_message_chunk");
});

test("permission rejection and cancelled outcome prevent writes", async () => {
  for (const outcome of [{ outcome: "selected", optionId: "reject_once" }, { outcome: "cancelled" }]) {
    const seen: string[] = [];
    const { updates } = await turn([{ action: "write_file" }, { path: "a", content: "b" }, { action: "reply" }], async (method) => { seen.push(method); return { outcome }; });
    assert.deepEqual(seen, ["session/request_permission"]);
    assert.equal(updates[1]?.sessionUpdate === "tool_call_update" && updates[1].status, "failed");
  }
});

test("permission grant allows write", async () => {
  const seen: string[] = [];
  await turn([{ action: "write_file" }, { path: "a", content: "b" }, { action: "reply" }], async (method) => {
    seen.push(method); return method === "session/request_permission" ? { outcome: { outcome: "selected", optionId: "allow_once" } } : null;
  });
  assert.deepEqual(seen, ["session/request_permission", "fs/write_text_file"]);
});

test("invalid args and repeated actions are bounded by the iteration cap", async () => {
  const script = Array.from({ length: 8 }, () => [{ action: "read_file" }, { path: 12 }]).flat();
  const result = await turn(script, async () => { assert.fail("invalid args executed"); });
  assert.equal(result.calls.length, 16);
  assert.deepEqual(result.result, { stopReason: "end_turn" });
});

test("fallback arguments are validated after schema rejection", async () => {
  let count = 0;
  const tools = builtinTools("s", "/repo", { fs: { readTextFile: true } }, async () => ({ content: "yes" }));
  const messages = await runToolLoop({ complete: async () => {
    count++;
    if (count === 1) return { action: "read_file" };
    if (count === 2) throw new Error("schema rejected");
    if (count === 3) return { json: '{"path":"x"}' };
    return { action: "reply" };
  } }, tools, [{ role: "user", content: "read x" }], "s", () => {}, async () => null, new AbortController().signal);
  assert.match(JSON.stringify(messages), /tool result/);
});

test("cancel interrupts pending permission and returns cancelled", async () => {
  let notifyPermission: () => void = () => {};
  const permissionStarted = new Promise<void>((resolve) => { notifyPermission = resolve; });
  let step = 0;
  const agent = new FmAgent({ complete: async () => ++step === 1 ? { action: "write_file" } : { path: "a", content: "b" }, async *chat() {} }, () => {}, undefined,
    async () => { notifyPermission(); return new Promise(() => {}); });
  await agent.handlers.onRequest("initialize", { protocolVersion: 1, clientCapabilities: { fs: { writeTextFile: true } } });
  const session = await agent.handlers.onRequest("session/new", { cwd: "/repo" }) as { sessionId: string };
  const result = agent.handlers.onRequest("session/prompt", { ...session, prompt: [{ type: "text", text: "write" }] });
  await permissionStarted;
  agent.handlers.onNotification("session/cancel", session);
  assert.deepEqual(await result, { stopReason: "cancelled" });
});

test("catalogue and observation truncation and history trimming", () => {
  assert.equal(truncateResult("123456", 3), "123\n[truncated]");
  const tools = builtinTools("s", "/", { fs: { readTextFile: true } }, async () => null);
  assert.ok(toolCatalogue(tools, 10).length <= 10);
  assert.deepEqual(trimHistory([{ role: "user", content: "old" }, { role: "assistant", content: "old" }, { role: "user", content: "new" }], 3), [{ role: "user", content: "new" }]);
});

test("successful repeated tool calls stop at the cap", async () => {
  let calls = 0;
  const result = await turn(Array.from({ length: 8 }, () => [{ action: "read_file" }, { path: "x" }]).flat(), async () => { calls++; return { content: "result" }; });
  assert.equal(calls, 8);
  assert.equal(result.updates.filter((update) => update.sessionUpdate === "tool_call").length, 8);
});

test("cancel aborts a constrained fm request", async () => {
  let started: () => void = () => {};
  const ready = new Promise<void>((resolve) => { started = resolve; });
  const agent = new FmAgent({
    complete: async (_messages, _schema, signal) => { started(); return new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })); },
    async *chat() {},
  }, () => {});
  await agent.handlers.onRequest("initialize", { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: true } } });
  const session = await agent.handlers.onRequest("session/new", { cwd: "/" }) as { sessionId: string };
  const result = agent.handlers.onRequest("session/prompt", { ...session, prompt: [] });
  await ready;
  agent.handlers.onNotification("session/cancel", session);
  assert.deepEqual(await result, { stopReason: "cancelled" });
});
