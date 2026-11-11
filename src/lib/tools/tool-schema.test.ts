import assert from "node:assert/strict";
import { test } from "node:test";
import { sanitizeSchema } from "./tool-schema.ts";
test("inlines refs, drops unsupported keywords and normalizes free objects", () => {
  assert.deepEqual(sanitizeSchema({ type: "object", properties: { x: { $ref: "#/$defs/x" } }, $defs: { x: { type: "integer", minimum: 0 } }, additionalProperties: false }),
    { type: "object", properties: { x: { type: "integer" } } });
  assert.deepEqual(sanitizeSchema({ type: "object" }), { type: "object", properties: {} });
});
test("cycles terminate and nested array and union schemas survive", () => {
  assert.deepEqual(sanitizeSchema({ $ref: "#/$defs/x", $defs: { x: { $ref: "#/$defs/x" } } }), { type: "string" });
  assert.deepEqual(sanitizeSchema({ type: "array", items: { anyOf: [{ type: "string" }, { type: "null" }] } }),
    { type: "array", items: { anyOf: [{ type: "string" }, { type: "null" }] } });
});
