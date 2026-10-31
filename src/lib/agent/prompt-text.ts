import type { ContentBlock } from "../acp/acp.schemas.ts";
import { AGENT_TEXT, CLIENT_SCAFFOLD_TAGS, USER_REQUEST_TAG } from "./agent.config.ts";

const tagPattern = (tag: string): RegExp => new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g");

/** Unwrap `<user_request>` and drop client scaffolding blocks. */
export const stripClientScaffold = (text: string): string => {
  let result = text.replace(tagPattern(USER_REQUEST_TAG), "$1");
  for (const tag of CLIENT_SCAFFOLD_TAGS) result = result.replace(tagPattern(tag), "");
  return result.trim();
};

/** Flatten ACP content blocks into the plain text the model sees. */
export const contentBlocksToText = (blocks: ContentBlock[]): string =>
  blocks
    .map((block) => {
      switch (block.type) {
        case "text":
          return block.text;
        case "resource_link":
          return AGENT_TEXT.resourceLink(block.uri);
        case "resource":
          return block.resource.text === undefined
            ? AGENT_TEXT.resourceLink(block.resource.uri)
            : AGENT_TEXT.resource(block.resource.uri, block.resource.text);
        case "image":
          return AGENT_TEXT.unsupportedImage;
        case "audio":
          return AGENT_TEXT.unsupportedAudio;
      }
    })
    .map(stripClientScaffold)
    .filter((text) => text !== "")
    .join("\n\n");
