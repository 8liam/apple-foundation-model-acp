import assert from "node:assert/strict";
import { test } from "node:test";
import { PassThrough } from "node:stream";
import { JsonRpcConnection } from "./jsonrpc.connection.ts";

test("outbound requests correlate out of order, reject errors and close", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const sent: { id: string }[] = [];
  output.on("data", (chunk: Buffer) => sent.push(JSON.parse(chunk.toString()) as { id: string }));
  const conn = new JsonRpcConnection(input, output, { onRequest: async () => null, onNotification: () => {} });
  const a = conn.request("a", {});
  const b = conn.request("b", {});
  input.write(JSON.stringify({ jsonrpc: "2.0", id: sent[1]?.id, result: "b" }) + "\n");
  input.write(JSON.stringify({ jsonrpc: "2.0", id: sent[0]?.id, error: { code: -1, message: "bad" } }) + "\n");
  assert.equal(await b, "b");
  await assert.rejects(a, /bad/);
  const pending = conn.request("c", {});
  input.end();
  await assert.rejects(pending, /closed/);
  await assert.rejects(conn.request("d", {}), /closed/);
});
