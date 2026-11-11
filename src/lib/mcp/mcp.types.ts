import type { z } from "zod";
import type { mcpServerSchema } from "../acp/acp.schemas.ts";
import type { Tool } from "../tools/tools.types.ts";
export type McpServer = z.infer<typeof mcpServerSchema>;
export type McpTools = { tools: Tool[]; close: () => Promise<void> };
