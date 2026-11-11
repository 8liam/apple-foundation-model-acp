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

Six core coding tools are always listed first. The schemas and descriptions are shared across backends:

- `read_file(path, line?, limit?)` reads text (line numbers start at 1).
- `write_file(path, content)` creates or overwrites a file.
- `edit_file(path, old_text, new_text)` replaces exactly one matching occurrence.
- `run_command(command, args?, cwd?)` runs an executable with an argument array and collects output.
- `list_directory(path?)` lists up to 500 entries (default: session cwd).
- `search_files(query, path?)` searches literal text recursively, returning file:line matches. It skips symlinks, binary/oversized files, `node_modules` and `.git`; traversal stops at 2,000 entries or 100 matches. Each directory contributes at most 500 entries. Lines are capped at 300 characters.

Reads/writes use ACP fs capabilities independently when advertised; otherwise they use `node:fs`. Commands use ACP terminals when advertised, otherwise `node:child_process`. Listing/search always use local files. **T3 Code advertises fs and terminal as false**, so all six tools use local implementations there, even when the T3 MCP bridge is connected. No T3 settings changes are required.

Local paths resolve against session cwd. File tools and command cwd reject lexical escapes and symlinks leading outside cwd, including dangling symlinks, even after permission approval; outside access through these parameters is intentionally unsupported. Local reads are capped at 1 MB (oversized files fail). These checks are not an OS sandbox: concurrent filesystem changes can race checks, and an approved executable can access files/network outside cwd. Commands require permission, run with inherited environment and ignored stdin, and never implicitly invoke a shell. Shell syntax is passed literally as arguments; explicitly invoking a shell executable still requires command permission. Output is capped at 32,000 bytes across stdout/stderr (excess discarded); timeout/cancellation kills the local process group. Detached descendants that escape the process group are outside that guarantee.

Writes, edits, commands, and MCP tools without `annotations.readOnlyHint: true` request ACP permission before execution. T3 auto-accept mode can approve these requests. Rejected/cancelled requests become tool observations. Calls and results appear as `tool_call` / `tool_call_update` session updates.

MCP servers supplied in `session/new.mcpServers` are supported over stdio, Streamable HTTP (with SSE fallback), and SSE. Connections and tool discovery share a 10-second deadline per server; failed servers are logged to stderr and skipped. Remote names become sanitized `<server>__<tool>` names with collision suffixes. Text results are flattened; other content becomes a placeholder. Clients close on process shutdown (ACP v1 has no session-end request). Discovery is filtered before the catalogue character budget is applied. By default only `html_preview` and `html_render` are exposed; preview/device/management families and all other remote tools are excluded. This keeps the small model focused on coding tools.

| Variable | Default | Purpose |
| --- | --- | --- |
| `APPLE_FM_ACP_MCP_ALLOW` | `html_preview,html_render,*__html_preview,*__html_render` | Comma-separated allow globs; setting replaces default allows and default family denies |
| `APPLE_FM_ACP_MCP_DENY` | `preview_*,device_*,t3_*,*__preview_*,*__device_*,*__t3_*` | Comma-separated deny globs; setting replaces default denies; deny wins |

Globs are case-sensitive, with only `*` acting as a wildcard. Explicit policies match the original remote name or sanitized `server__tool` name; default family denies match the remote name so the `t3_code` server prefix does not exclude its presentation tools. Empty allow hides all MCP tools; `APPLE_FM_ACP_MCP_ALLOW=*` opts into all tools. For example, `APPLE_FM_ACP_MCP_ALLOW='html_*,t3_code__preview_*' APPLE_FM_ACP_MCP_DENY='*__preview_close'` opts into selected browser tools. These knobs curate the model's choices; they are not a security sandbox.

The MCP SDK is pinned to 1.32.1, published October 5, 2026. Stdio integration is tested; HTTP/SSE interoperability has not been tested against a live remote server.

Not supported: `session/load`, images/audio.

## Tool loop and limits

`fm serve` ignores OpenAI's `tools` field. Instead, each tool step uses two non-streaming constrained JSON calls: first choose `reply` or a tool name, then generate that tool's arguments. Arguments are validated before execution. After a successful result, a constrained yes/no check defaults to answering; another tool decision is allowed only when the model says information is missing. Identical calls (canonical arguments and normalized built-in paths) stop before execution. A failed execution or invalid decision/arguments permits at most one further attempt. Results go into temporary messages; file contents are truncated and fenced under their path. The streamed final reply receives compact observations and the original request last, with instructions to retain successful evidence and identify failed attempts. Only the user prompt and final answer persist between turns. Sessions without tools keep the original plain streaming chat path.

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

The optional real-model tool tests are skipped by default because model decisions vary. The local-backend benchmark runs ten trials each for package reads, folder listing, code search, and conversation, cycling three phrasings per scenario. It uses 70 MCP-style distractors filtered by production policy (two presentation tools survive). Diagnostics include every prompt, executed call, reply, error, and score. Each tool scenario requires successful local evidence and the expected answer; conversation requires a nonempty reply without tool execution. Opting in can fail the suite.

Local verification on November 11, 2026, using real `fm serve` and the LOCAL backend (10 trials per scenario, three phrasings, identical scoring):

| Scenario | Before (`4acf3de`) | After |
| --- | ---: | ---: |
| Package name | 4/10 | 10/10 |
| Folders | 8/10 | 10/10 |
| Code search | 2/10 | 8/10 |
| Conversation without tools | 4/10 | 10/10 |

An intermediate gate-only run scored 10/10, 8/10, 3/10, 4/10 respectively; clearer general decision/argument prompts improved initial choices. The final search failures were one 100-second timeout after a successful search and one invented path/answer after failed attempts. The opt-in benchmark therefore still fails its all-trials assertion. Prompt safeguards reduce errors but cannot guarantee truthful answers or successful searches. These small, variable samples are observations, not reliability guarantees.

Typecheck passed; the final default suite passed (39 passed, 2 opt-in tests skipped), and the opt-in ACP file-read test passed. An earlier default run timed out in the real ACP integration test; the unchanged test passed on rerun. Multi-turn conversation can still select unnecessary tools.
