import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { FmAgent } from "./fm-agent.ts";
import { runToolLoop, toolCatalogue, truncateResult } from "./agent-loop.ts";
import { trimHistory } from "./history.ts";
import { builtinTools } from "../tools/tool-registry.ts";
import type { ClientRequest, Tool } from "../tools/tools.types.ts";
import type { SessionUpdate } from "./agent.types.ts";
import type { ChatMessage, ChatStreamEvent } from "../fm/fm.types.ts";

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
  const result = await turn([{ action: "read_file" }, { path: "package.json" }, { answer: "yes" }], async (method, params) => {
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

test("invalid arguments consume the failure budget", async () => {
  const script = Array.from({ length: 8 }, () => [{ action: "read_file" }, { path: 12 }]).flat();
  const result = await turn(script, async () => { assert.fail("invalid args executed"); });
  assert.equal(result.calls.length, 4);
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
    return { answer: "yes" };
  } }, tools, [{ role: "user", content: "read x" }], "s", () => {}, async () => null, new AbortController().signal);
  assert.match(JSON.stringify(messages), /tool result/i);
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

test("success defaults to reply through the constrained gate and keeps the original request last", async () => {
  const original = "Read the requested file. What does it say?";
  const script: unknown[] = [{ action: "read_file" }, { path: "x" }, { answer: "yes" }];
  const prompts: ChatMessage[][] = [];
  const tools = builtinTools("s", "/repo", { fs: { readTextFile: true } }, async () => ({ content: "answer" }));
  const messages = await runToolLoop({ complete: async (messages) => { prompts.push(messages); return script.shift(); } }, tools,
    [{ role: "user", content: original }], "s", () => {}, async () => null, new AbortController().signal);
  assert.equal(prompts.length, 3);
  assert.match(prompts[2]?.[0]?.content ?? "", /Choose yes by default/);
  assert.deepEqual(messages.at(-1), { role: "user", content: original });
  assert.match(JSON.stringify(messages), /x\\n```text\\nanswer/);
  assert.match(messages[0]?.content ?? "", /Never claim you cannot read files/);
});

test("duplicate normalized calls are rejected before execution", async () => {
  let calls = 0;
  const script = [{ action: "read_file" }, { path: "./x", line: 1 }, { answer: "no" }, { action: "read_file" }, { path: "x" }];
  const tools = builtinTools("s", "/repo", { fs: { readTextFile: true } }, async () => { calls++; return { content: "answer" }; });
  const messages = await runToolLoop({ complete: async () => script.shift() }, tools, [{ role: "user", content: "read x" }],
    "s", () => {}, async () => null, new AbortController().signal);
  assert.equal(calls, 1);
  assert.match(messages[0]?.content ?? "", /Repeated identical tool call blocked/);
});

test("failure permits only one further attempt, retaining success and failure in the final hint", async () => {
  for (const recover of [true, false]) {
    let calls = 0;
    const script = [{ action: "read_file" }, { path: "missing" }, { action: "read_file" }, { path: "x" }];
    const tools = builtinTools("s", "/repo", { fs: { readTextFile: true } }, async () => {
      calls++;
      if (calls === 1 || !recover) throw new Error("missing file");
      return { content: "answer" };
    });
    const messages = await runToolLoop({ complete: async () => { assert.ok(script.length); return script.shift(); } }, tools,
      [{ role: "user", content: "read x" }], "s", () => {}, async () => null, new AbortController().signal);
    assert.equal(calls, 2);
    assert.match(messages[0]?.content ?? "", /single follow-up attempt/);
    assert.match(JSON.stringify(messages), /Failed tool attempt.*missing/);
    if (recover) assert.match(JSON.stringify(messages), /Successful tool result.*answer/);
  }
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

test("success survives a later failed call and one recovery attempt", async () => {
  let calls = 0;
  const script = [{ action: "read_file" }, { path: "first" }, { answer: "no" }, { action: "read_file" }, { path: "missing" },
    { answer: "no" }, { action: "read_file" }, { path: "last" }];
  const tools = builtinTools("s", "/repo", { fs: { readTextFile: true } }, async () => {
    if (++calls === 2) throw new Error("missing file");
    return { content: `result ${calls}` };
  });
  const messages = await runToolLoop({ complete: async () => { assert.ok(script.length); return script.shift(); } }, tools,
    [{ role: "user", content: "read files" }], "s", () => {}, async () => null, new AbortController().signal);
  assert.equal(calls, 3);
  assert.match(JSON.stringify(messages), /result 1/);
  assert.match(JSON.stringify(messages), /missing file/);
  assert.match(JSON.stringify(messages), /result 3/);
});

test("a conversational reply keeps prior context and needs no tool results", async () => {
  const history: ChatMessage[] = [{ role: "user", content: "My name is Pat." }, { role: "assistant", content: "Hi Pat." }, { role: "user", content: "What is my name?" }];
  const messages = await runToolLoop({ complete: async () => ({ action: "reply" }) }, [], history,
    "s", () => {}, async () => null, new AbortController().signal);
  assert.deepEqual(messages.slice(1), history);
  assert.match(messages[0]?.content ?? "", /For conversation, respond normally/);
});

test("duplicate MCP arguments ignore nested object key ordering", async () => {
  let calls = 0;
  const tool: Tool = { name: "remote__inspect", description: "Inspect", kind: "read", readOnly: true,
    schema: { type: "object", properties: {} }, validate: (value) => z.record(z.string(), z.unknown()).parse(value),
    run: async () => { calls++; return "observed"; } };
  const script = [{ action: tool.name }, { filter: { a: 1, b: 2 }, paths: ["x", "y"] }, { answer: "no" },
    { action: tool.name }, { paths: ["x", "y"], filter: { b: 2, a: 1 } }];
  const messages = await runToolLoop({ complete: async () => script.shift() }, [tool], [{ role: "user", content: "inspect" }],
    "s", () => {}, async () => null, new AbortController().signal);
  assert.equal(calls, 1);
  assert.match(messages[0]?.content ?? "", /Repeated identical tool call blocked/);
});
