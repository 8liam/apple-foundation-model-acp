import type { ContentBlock } from "../acp/acp.schemas.ts";
import { AGENT_TEXT, REQUEST_TAGS } from "./agent.config.ts";

const requestPattern = new RegExp(`<(${REQUEST_TAGS.join("|")})>([\\s\\S]*?)</\\1>`);

/** A top-level block whose tag is snake_case or kebab-case, e.g. `<runtime_info>…</runtime_info>`. */
const scaffoldBlockPattern = /^[ \t]*<([a-z][a-z0-9]*(?:[_-][a-z0-9]+)+)>[\s\S]*?<\/\1>[ \t]*$/gm;

/**
 * Reduce one block to the user's own words: use the request-tag contents when present,
 * otherwise drop injected scaffolding blocks. Client-agnostic by design.
 */
export const stripClientScaffold = (text: string): string => {
  const request = requestPattern.exec(text);
  if (request?.[2] !== undefined) return request[2].trim();
  return text.replace(scaffoldBlockPattern, "").trim();
};

/** Strip scaffolding from user text, but never reduce a prompt to nothing. */
const userText = (blocks: ContentBlock[]): string => {
  const texts = blocks.flatMap((block) => (block.type === "text" ? [block.text] : []));
  const stripped = texts.map(stripClientScaffold).filter((text) => text !== "");
  return (stripped.length > 0 ? stripped : texts).join("\n\n");
};

/** Flatten ACP content blocks into the plain text the model sees. */
export const contentBlocksToText = (blocks: ContentBlock[]): string => {
  const text = userText(blocks);
  return [
    text,
    ...blocks.map((block) => {
      switch (block.type) {
        case "text":
          return "";
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
    }),
  ]
    .filter((part) => part !== "")
    .join("\n\n");
};
