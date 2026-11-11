<img src="assets/icon.svg" width="64" height="64" alt="">

# apple-fm-acp

An [Agent Client Protocol](https://agentclientprotocol.com) agent for Apple's on-device Foundation Models. It lets ACP clients (Zed, etc.) chat with the model behind the macOS `fm` command.

It spawns `fm serve` on a private unix socket and translates ACP over stdio (newline-delimited JSON-RPC) into streamed chat completions.

## Requirements

- Apple silicon Mac with the `fm` CLI (`fm available` should print `System model available`)
- Node 26+ (runs the TypeScript sources directly)

## Use

```sh
npm install
node src/main.ts   # speaks ACP on stdin/stdout
```

Zed (`settings.json`):

```json
{
  "agent_servers": {
    "Apple Foundation Models": {
      "command": "node",
      "args": ["/absolute/path/to/apple-fm-acp/src/main.ts"]
    }
  }
}
```

## Supported

`initialize`, `session/new`, `session/prompt` (streamed `agent_message_chunk`), `session/cancel`. Text, resource links and embedded text resources are accepted as prompt content.

Coding tools are available when the ACP client advertises the corresponding capabilities:

- `read_file(path, line?, limit?)` uses client file reads.
- `write_file(path, content)` and `edit_file(path, old_text, new_text)` use client writes. Edits require exactly one matching occurrence.
- `run_command(command, args?, cwd?)` uses client terminals, waits for exit, collects output, and kills/releases the terminal on cancellation or timeout.

Relative paths resolve against the session cwd. The agent process never reads or writes project files directly. Writes, edits, commands, and MCP tools without `annotations.readOnlyHint: true` request ACP permission before execution. Rejected/cancelled permission requests become tool observations. Calls and results appear as `tool_call` / `tool_call_update` session updates.

MCP servers supplied in `session/new.mcpServers` are supported over stdio, Streamable HTTP (with SSE fallback), and SSE. Connections and tool discovery share a 10-second deadline per server; failed servers are logged to stderr and skipped. Remote names become sanitized `<server>__<tool>` names with collision suffixes. Text results are flattened; other content becomes a placeholder. Clients close on process shutdown (ACP v1 has no session-end request). The MCP SDK is pinned to 1.32.1, published October 5, 2026. Stdio integration is tested; HTTP/SSE interoperability has not been tested against a live remote server.

Not supported: `session/load`, images/audio.

## Tool loop and limits

`fm serve` ignores OpenAI's `tools` field. Instead, each tool step uses two non-streaming constrained JSON calls: first choose `reply` or a tool name, then generate that tool's arguments. Arguments are validated before execution. Results go into temporary user/assistant messages, and the final answer streams normally. Only the user prompt and final answer persist between turns. Sessions without tools keep the original plain streaming chat path.

The roughly 3B model has about a 4k-token context and can choose the wrong tool, invent arguments, repeat calls, or answer early. This is a bounded coding assistant, with no guarantee of completing complex coding tasks. History uses an 8,000-character budget. Core tools precede MCP tools in the catalogue; descriptions are capped at 60 characters, entries degrade to names only, and trailing entries are omitted when the budget is exhausted. Omitted tools cannot be selected that turn. Tool observations are truncated and marked; large inputs and schemas can still exhaust context.

Configuration defaults live in `src/lib/tools/tools.config.ts`, `src/lib/mcp/mcp.config.ts`, and `src/lib/agent/agent.config.ts`. Positive integer environment overrides:

| Variable | Default | Purpose |
| --- | ---: | --- |
| `APPLE_FM_ACP_MAX_ITERATIONS` | 8 | Tool/decision attempt cap before a final answer |
| `APPLE_FM_ACP_CATALOGUE_CHARS` | 2400 | Tool catalogue character budget |
| `APPLE_FM_ACP_RESULT_CHARS` | 1500 | Per-observation text limit |
| `APPLE_FM_ACP_COMMAND_TIMEOUT_MS` | 60000 | Terminal command timeout |

`APPLE_FM_ACP_INSTRUCTIONS` sets optional system instructions. Client fs/terminal requests have a 90-second timeout; MCP calls have a 60-second timeout. Permission requests wait for the user or session cancellation.

### Verified fm schema behaviour

Local probes on November 11, 2026 accepted optional properties, integers, arrays, nested objects, enums, `anyOf` with null, explicit null, empty `properties: {}`, omitted `additionalProperties`, and explicit `additionalProperties: false`. A bare `{"type":"object"}` returned HTTP 400 with a schema decoding error. Both plain and constrained non-streaming calls returned JSON chat completions; streaming calls returned SSE.

The schema normalizer inlines local references, bounds recursive references, removes unsupported validation keywords, and adds explicit object properties. Original MCP schemas are validated with Ajv; built-ins use zod. If constrained argument generation rejects a schema, a second attempt uses a single JSON-encoded string field. Recursive/complex schemas and tools requiring arbitrary map keys remain limited; omitted constraints can cause validation errors and consume iterations.

## Develop

```sh
npm run typecheck
npm test   # includes the original chat end-to-end test; needs working fm
APPLE_FM_ACP_TOOL_E2E=1 node --test src/tool-turn.e2e.test.ts
```

The optional real-model tool test is skipped by default because model decisions vary. It passed locally: for “Read package.json and tell me the name”, the model called `read_file` with the absolute package path, received fake ACP file content, and streamed “The name is apple-fm-acp.” Unit tests use scripted model responses and fake ACP clients; the MCP fixture uses a real SDK stdio server.
