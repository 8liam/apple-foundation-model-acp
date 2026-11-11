import { Ajv } from "ajv";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { abortable } from "../tools/tool-registry.ts";
import { mcpToolAllowed } from "./mcp-policy.ts";
import { MCP_CONFIG } from "./mcp.config.ts";
import type { McpServer, McpTools } from "./mcp.types.ts";

export const namespaceTool = (server: string, tool: string, used: Set<string>): string => {
  const clean = (name: string) => name.toLowerCase().replaceAll(/[^a-z0-9_]/g, "_").slice(0, MCP_CONFIG.nameChars) || "mcp";
  const base = `${clean(server)}__${clean(tool)}`;
  let name = base;
  let index = 0;
  while (used.has(name)) name = `${base}_${++index}`;
  used.add(name);
  return name;
};
const textResultSchema = z.object({ content: z.array(z.object({ type: z.string(), text: z.string().optional() }).passthrough()).optional(), isError: z.boolean().optional() }).passthrough();

export const connectMcpTools = async (servers: McpServer[], cwd: string): Promise<McpTools> => {
  const clients: Client[] = [];
  const used = new Set<string>();
  const tools: McpTools["tools"] = [];
  // Each server has a single deadline across connect, HTTP fallback, and listing.
  const groups = await Promise.all(servers.map(async (server) => {
    const signal = AbortSignal.timeout(MCP_CONFIG.timeoutMs);
    const open = async (sse: boolean) => {
      const client = new Client(MCP_CONFIG.client);
      const transport = "command" in server
        ? new StdioClientTransport({ command: server.command, args: server.args, env: { ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)), ...Object.fromEntries(server.env.map(({ name, value }) => [name, value])) }, cwd, stderr: "inherit" })
        : sse ? new SSEClientTransport(new URL(server.url), { requestInit: { headers: Object.fromEntries(server.headers.map(({ name, value }) => [name, value])) }, eventSourceInit: { fetch: (url, init) => {
          const headers = new Headers(init?.headers);
          for (const pair of server.headers) headers.set(pair.name, pair.value);
          return fetch(url, { ...init, headers });
        } } })
        : new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers: Object.fromEntries(server.headers.map(({ name, value }) => [name, value])) } });
      try { await abortable(client.connect(transport), signal); return client; }
      catch (error) { await client.close().catch(() => {}); throw error; }
    };
    let client: Client | undefined;
    try {
      try { client = await open("type" in server && server.type === "sse"); }
      catch (error) { if (!("type" in server) || server.type !== "http" || signal.aborted) throw error; client = await open(true); }
      const listed = [];
      let cursor: string | undefined;
      do {
        const page = await abortable(client.listTools({ cursor }), signal);
        listed.push(...page.tools);
        cursor = page.nextCursor;
      } while (cursor);
      clients.push(client);
      return { server, client, listed };
    } catch (error) {
      await client?.close().catch(() => {});
      console.error(MCP_CONFIG.failed, server.name, error);
      return undefined;
    }
  }));
  for (const group of groups) {
    if (!group) continue;
    for (const remote of group.listed) {
      const name = namespaceTool(group.server.name, remote.name, used);
      if (!mcpToolAllowed(remote.name, name)) continue;
      const ajv = new Ajv({ strict: false, validateFormats: false });
      let validate: ReturnType<typeof ajv.compile>;
      try { validate = ajv.compile(remote.inputSchema); }
      catch (error) { console.error(MCP_CONFIG.failed, remote.name, error); continue; }
      tools.push({ name, description: remote.description ?? remote.name,
        kind: "other", readOnly: remote.annotations?.readOnlyHint === true, schema: remote.inputSchema,
        validate: (value) => {
          const args = z.record(z.string(), z.unknown()).parse(value);
          if (!validate(args)) throw new Error(`${MCP_CONFIG.invalid}: ${ajv.errorsText(validate.errors)}`);
          return args;
        },
        run: async (args, signal) => {
          const result = textResultSchema.parse(await group.client.callTool({ name: remote.name, arguments: args }, undefined,
            { signal, timeout: MCP_CONFIG.callTimeoutMs }));
          const text = result.content?.map((item) => item.type === "text" ? item.text ?? "" : MCP_CONFIG.nonText).join("\n") ?? JSON.stringify(result);
          if (result.isError) throw new Error(text);
          return text;
        } });
    }
  }
  return { tools, close: async () => { await Promise.allSettled(clients.map((client) => client.close())); } };
};
