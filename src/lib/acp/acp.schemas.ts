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

export const clientCapabilitiesSchema = z.object({
  fs: z.object({ readTextFile: z.boolean().optional(), writeTextFile: z.boolean().optional() }).passthrough().optional(),
  terminal: z.boolean().optional(),
}).passthrough();
export const initializeParamsSchema = z.object({ protocolVersion: z.number().int(), clientCapabilities: clientCapabilitiesSchema.optional() }).passthrough();
const pairsSchema = z.array(z.object({ name: z.string(), value: z.string() }));
export const mcpServerSchema = z.union([
  z.object({ name: z.string(), command: z.string(), args: z.array(z.string()).default([]), env: pairsSchema.default([]) }),
  z.object({ type: z.enum(["http", "sse"]), name: z.string(), url: z.url(), headers: pairsSchema.default([]) }),
]);

export const newSessionParamsSchema = z.object({ cwd: z.string(), mcpServers: z.array(mcpServerSchema).default([]) }).passthrough();

export const promptParamsSchema = z.object({
  sessionId: z.string(),
  prompt: z.array(contentBlockSchema),
});

export const cancelParamsSchema = z.object({ sessionId: z.string() });

export type ContentBlock = z.infer<typeof contentBlockSchema>;
