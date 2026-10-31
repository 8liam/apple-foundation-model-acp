import assert from "node:assert/strict";
import { test } from "node:test";
import type { ChatMessage, ChatStreamEvent } from "../fm/fm.types.ts";
import { FmAgent } from "./fm-agent.ts";

const setup = (instructions?: string) => {
  const calls: ChatMessage[][] = [];
  const fm = {
    async *chat(messages: ChatMessage[]): AsyncGenerator<ChatStreamEvent> {
      calls.push(structuredClone(messages));
      yield { type: "delta", text: `reply${calls.length}` };
      yield { type: "finish", reason: "stop" };
    },
  };
  const agent = new FmAgent(fm, () => {}, instructions);
  const call = (method: string, params: unknown) => agent.handlers.onRequest(method, params);
  return { calls, call };
};

const ask = (sessionId: string, text: string) => ({ sessionId, prompt: [{ type: "text", text }] });

test("sends no system message by default and carries history across turns", async () => {
  const { calls, call } = setup();
  const { sessionId } = (await call("session/new", { cwd: "/" })) as { sessionId: string };
  await call("session/prompt", ask(sessionId, "my name is Zorblax"));
  await call("session/prompt", ask(sessionId, "what is my name?"));
  assert.deepEqual(calls[0], [{ role: "user", content: "my name is Zorblax" }]);
  assert.deepEqual(calls[1], [
    { role: "user", content: "my name is Zorblax" },
    { role: "assistant", content: "reply1" },
    { role: "user", content: "what is my name?" },
  ]);
});

test("prepends custom instructions as a system message when provided", async () => {
  const { calls, call } = setup("Be a pirate.");
  const { sessionId } = (await call("session/new", { cwd: "/" })) as { sessionId: string };
  await call("session/prompt", ask(sessionId, "hi"));
  assert.deepEqual(calls[0]?.[0], { role: "system", content: "Be a pirate." });
});
