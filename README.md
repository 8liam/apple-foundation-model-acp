<img src="assets/icon.svg" width="64" height="64" alt="">

# apple-fm-acp

An [Agent Client Protocol](https://agentclientprotocol.com) agent for Apple's on-device Foundation Models. It lets ACP clients (Zed, etc.) chat with the model behind the macOS `fm` command.

It spawns `fm serve` on a private unix socket and translates ACP over stdio (newline-delimited JSON-RPC) into streamed chat completions.

## Requirements

- Apple silicon Mac with the `fm` CLI (`fm available` should print `System model available`)
- Node 24+ (runs the TypeScript sources directly)

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

Not supported: `session/load`, tools/MCP, file or terminal access, images/audio. The model is small and has a short context window, so older history is trimmed (`src/lib/agent/agent.config.ts`).

## Develop

```sh
npm run typecheck
npm test   # includes an end-to-end test that needs a working `fm`
```
