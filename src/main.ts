#!/usr/bin/env node
import { ACP_METHODS } from "./lib/acp/acp.config.ts";
import { FmServer } from "./lib/fm/fm-server.ts";
import { FmAgent, sessionUpdateParams } from "./lib/agent/fm-agent.ts";
import { JsonRpcConnection } from "./lib/jsonrpc/jsonrpc.connection.ts";

const fm = await FmServer.start();
const shutdown = (): void => {
  fm.stop();
  process.exit(0);
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
process.stdin.once("end", shutdown);

// stdout is reserved for protocol messages; diagnostics go to stderr.
const agent = new FmAgent(fm, (sessionId, text) =>
  connection.notify(ACP_METHODS.sessionUpdate, sessionUpdateParams(sessionId, text)),
);
const connection = new JsonRpcConnection(process.stdin, process.stdout, agent.handlers);
