import { z } from "zod";
import { FM_CONFIG } from "./fm.config.ts";
import type { ChatStreamEvent } from "./fm.types.ts";

const errorSchema = z.object({ error: z.object({ message: z.string() }) });

const chunkSchema = z.object({
  choices: z.array(
    z.object({
      delta: z.object({ content: z.string().optional() }).optional(),
      finish_reason: z.string().nullish(),
    }),
  ),
});

/** Parse one SSE line; returns no events for blanks, `[DONE]`, and malformed chunks. */
export const parseSseLine = (line: string, isError = false): ChatStreamEvent[] => {
  if (!line.startsWith(FM_CONFIG.sseDataPrefix)) return [];
  const payload = line.slice(FM_CONFIG.sseDataPrefix.length).trim();
  if (payload === "" || payload === FM_CONFIG.streamDoneMarker) return [];

  let json: unknown;
  try {
    json = JSON.parse(payload);
  } catch {
    return [];
  }
  if (isError) {
    const failure = errorSchema.safeParse(json);
    return [{ type: "error", message: failure.success ? failure.data.error.message : payload }];
  }
  const parsed = chunkSchema.safeParse(json);
  if (!parsed.success) return [];

  const events: ChatStreamEvent[] = [];
  for (const choice of parsed.data.choices) {
    if (choice.delta?.content) events.push({ type: "delta", text: choice.delta.content });
    if (choice.finish_reason) events.push({ type: "finish", reason: choice.finish_reason });
  }
  return events;
};

/** Incrementally split a byte stream into SSE events. */
export async function* readChatStream(body: AsyncIterable<Uint8Array>): AsyncGenerator<ChatStreamEvent> {
  const decoder = new TextDecoder();
  let buffer = "";
  let isError = false;
  const parseLine = (line: string): ChatStreamEvent[] => {
    if (line.startsWith(FM_CONFIG.sseEventPrefix)) {
      isError = line.slice(FM_CONFIG.sseEventPrefix.length).trim() === FM_CONFIG.sseErrorEvent;
      return [];
    }
    return parseSseLine(line, isError);
  };
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      yield* parseLine(buffer.slice(0, newline).trimEnd());
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
    }
  }
  yield* parseLine(buffer.trim());
}
