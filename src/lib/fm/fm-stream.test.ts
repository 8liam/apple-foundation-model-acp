import assert from "node:assert/strict";
import { test } from "node:test";
import { readChatStream } from "./fm-stream.ts";
import type { ChatStreamEvent } from "./fm.types.ts";

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

const collect = async (chunks: string[]): Promise<ChatStreamEvent[]> => {
  const events: ChatStreamEvent[] = [];
  for await (const event of readChatStream((async function* () { yield* chunks.map(encode); })())) events.push(event);
  return events;
};

test("parses deltas and finish across split chunks", async () => {
  const events = await collect([
    'data: {"choices":[{"delta":{"role":"assistant"},"index":0}]}\n\ndata: {"choices":[{"delta":{"con',
    'tent":"Hi"},"index":0}]}\n\ndata: {"choices":[{"finish_reason":"stop","delta":{},"index":0}]}\n\ndata: [DONE]\n\n',
  ]);
  assert.deepEqual(events, [
    { type: "delta", text: "Hi" },
    { type: "finish", reason: "stop" },
  ]);
});

test("surfaces error events", async () => {
  const events = await collect(['event: error\ndata: {"error":{"message":"boom","code":"500"}}\n\n']);
  assert.deepEqual(events, [{ type: "error", message: "boom" }]);
});
