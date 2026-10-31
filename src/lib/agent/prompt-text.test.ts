import assert from "node:assert/strict";
import { test } from "node:test";
import { contentBlocksToText, stripClientScaffold } from "./prompt-text.ts";

test("strips client scaffolding and unwraps the user request", () => {
  const text = "<t3_code_instructions>\nlots\nof rules\n</t3_code_instructions>\n\n<user_request>\nhello there\n</user_request>";
  assert.equal(stripClientScaffold(text), "hello there");
});

test("drops scaffold-only blocks", () => {
  assert.equal(
    contentBlocksToText([
      { type: "text", text: "<user_request>\nhi\n</user_request>" },
      { type: "text", text: "<runtime_info>x</runtime_info>" },
    ]),
    "hi",
  );
});

test("leaves ordinary text untouched", () => {
  assert.equal(stripClientScaffold("plain <b>text</b>"), "plain <b>text</b>");
});
