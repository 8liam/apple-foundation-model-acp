import type { ContentBlock } from "../acp/acp.schemas.ts";
import { AGENT_TEXT } from "./agent.config.ts";

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
    .join("\n\n");
