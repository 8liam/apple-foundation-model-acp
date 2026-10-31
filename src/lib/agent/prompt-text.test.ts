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

test("drops arbitrary snake/kebab-case scaffolding blocks without a request tag", () => {
  const text = "<some_client_rules>\nbe nice\n</some_client_rules>\n\nwhat is 2+2?\n\n<extra-context>\nignore\n</extra-context>";
  assert.equal(stripClientScaffold(text), "what is 2+2?");
});

test("keeps the user's text when it is itself only a tagged block", () => {
  assert.equal(contentBlocksToText([{ type: "text", text: "<note_to_self>remember</note_to_self>" }]), "<note_to_self>remember</note_to_self>");
});
