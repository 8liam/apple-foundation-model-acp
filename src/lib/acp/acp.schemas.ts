import { z } from "zod";

export const contentBlockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({ type: z.literal("resource_link"), uri: z.string(), name: z.string().optional() }),
  z.object({
    type: z.literal("resource"),
    resource: z.object({ uri: z.string(), text: z.string().optional() }).passthrough(),
  }),
  z.object({ type: z.literal("image") }).passthrough(),
  z.object({ type: z.literal("audio") }).passthrough(),
]);

export const initializeParamsSchema = z.object({ protocolVersion: z.number().int() }).passthrough();

export const newSessionParamsSchema = z.object({ cwd: z.string() }).passthrough();

export const promptParamsSchema = z.object({
  sessionId: z.string(),
  prompt: z.array(contentBlockSchema),
});

export const cancelParamsSchema = z.object({ sessionId: z.string() });

export type ContentBlock = z.infer<typeof contentBlockSchema>;
