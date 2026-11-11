import { connectMcpTools } from "../mcp/mcp-client.ts";
import { builtinTools } from "../tools/tool-registry.ts";
import type { ClientCapabilities, ClientRequest } from "../tools/tools.types.ts";
import { runToolLoop } from "./agent-loop.ts";
import { randomUUID } from "node:crypto";
import type { z } from "zod";
import {
  ACP_METHODS,
  ACP_PROTOCOL_VERSION,
  ACP_STOP_REASONS,
  ACP_UPDATE_KINDS,
  AGENT_CAPABILITIES,
  AGENT_INFO,
} from "../acp/acp.config.ts";
import {
  cancelParamsSchema,
  initializeParamsSchema,
  newSessionParamsSchema,
  promptParamsSchema,
} from "../acp/acp.schemas.ts";
import type { FmServer } from "../fm/fm-server.ts";
import type { ChatMessage } from "../fm/fm.types.ts";
import { JSONRPC_ERROR, JSONRPC_MESSAGES } from "../jsonrpc/jsonrpc.config.ts";
import { JsonRpcError } from "../jsonrpc/jsonrpc.error.ts";
import type { JsonRpcHandlers } from "../jsonrpc/jsonrpc.types.ts";
import { AGENT_CONFIG, AGENT_ERRORS } from "./agent.config.ts";
import type { Session, SessionUpdateSink, StopReason } from "./agent.types.ts";
import { trimHistory } from "./history.ts";
import { contentBlocksToText } from "./prompt-text.ts";

/** ACP agent that answers prompts with Apple's on-device Foundation Model. */
export class FmAgent {
  readonly #fm: Pick<FmServer, "chat"> & Partial<Pick<FmServer, "complete">>;
  #capabilities: ClientCapabilities = {};
  readonly #request: ClientRequest;
  readonly #emit: SessionUpdateSink;
  readonly #instructions: string | undefined;
  readonly #sessions = new Map<string, Session>();

  constructor(fm: Pick<FmServer, "chat"> & Partial<Pick<FmServer, "complete">>, emit: SessionUpdateSink, instructions?: string, request: ClientRequest = async () => { throw new Error(JSONRPC_MESSAGES.methodNotFound); }) {
    this.#request = request;
    this.#fm = fm;
    this.#emit = emit;
    this.#instructions = instructions;
  }

  readonly handlers: JsonRpcHandlers = {
    onRequest: async (method, params) => {
      switch (method) {
        case ACP_METHODS.initialize:
          return this.#initialize(parse(method, initializeParamsSchema, params));
        case ACP_METHODS.sessionNew:
          return this.#newSession(parse(method, newSessionParamsSchema, params));
        case ACP_METHODS.sessionPrompt:
          return this.#prompt(parse(method, promptParamsSchema, params));
        default:
          throw new JsonRpcError(JSONRPC_ERROR.methodNotFound, `${JSONRPC_MESSAGES.methodNotFound}: ${method}`);
      }
    },
    onNotification: (method, params) => {
      if (method !== ACP_METHODS.sessionCancel) return;
      const parsed = cancelParamsSchema.safeParse(params);
      if (parsed.success) this.#sessions.get(parsed.data.sessionId)?.abort?.abort();
    },
  };

  #initialize(params: z.infer<typeof initializeParamsSchema>) {
    this.#capabilities = params.clientCapabilities ?? {};
    return {
      protocolVersion: ACP_PROTOCOL_VERSION,
      agentCapabilities: AGENT_CAPABILITIES,
      agentInfo: AGENT_INFO,
      authMethods: [],
    };
  }

  async close(): Promise<void> {
    for (const session of this.#sessions.values()) session.abort?.abort();
    await Promise.allSettled([...this.#sessions.values()].map((session) => session.close()));
    this.#sessions.clear();
  }

  async #newSession(params: z.infer<typeof newSessionParamsSchema>) {
    const id = `${AGENT_CONFIG.sessionIdPrefix}${randomUUID()}`;
    const mcp = await connectMcpTools(params.mcpServers, params.cwd);
    this.#sessions.set(id, { id, history: [], abort: null, tools: [...builtinTools(id, params.cwd, this.#capabilities, this.#request), ...mcp.tools], close: mcp.close });
    return { sessionId: id };
  }

  async #prompt(params: z.infer<typeof promptParamsSchema>): Promise<{ stopReason: StopReason }> {
    const session = this.#sessions.get(params.sessionId);
    if (!session) {
      throw new JsonRpcError(JSONRPC_ERROR.invalidParams, AGENT_ERRORS.unknownSession(params.sessionId));
    }
    if (session.abort) {
      throw new JsonRpcError(JSONRPC_ERROR.invalidRequest, AGENT_ERRORS.promptInFlight(session.id));
    }

    const baseline = session.history.length;
    session.history.push({ role: "user", content: contentBlocksToText(params.prompt) });
    const abort = new AbortController();
    session.abort = abort;

    let messages: ChatMessage[] = [
      ...(this.#instructions ? [{ role: "system" as const, content: this.#instructions }] : []),
      ...trimHistory(session.history, AGENT_CONFIG.historyCharBudget),
    ];

    let reply = "";
    let stopReason: StopReason = ACP_STOP_REASONS.endTurn;
    try {
      if (session.tools.length && this.#fm.complete) {
        messages = await runToolLoop({ complete: this.#fm.complete.bind(this.#fm) }, session.tools, trimHistory(session.history, AGENT_CONFIG.historyCharBudget),
          session.id, this.#emit, this.#request, abort.signal, this.#instructions);
      }
      for await (const event of this.#fm.chat(messages, abort.signal)) {
        if (event.type === "delta") {
          reply += event.text;
          this.#emit(session.id, { sessionUpdate: ACP_UPDATE_KINDS.agentMessageChunk, content: { type: "text", text: event.text } });
        } else if (event.type === "finish") {
          if (event.reason === "length") stopReason = ACP_STOP_REASONS.maxTokens;
          if (event.reason === "content_filter") stopReason = ACP_STOP_REASONS.refusal;
        } else {
          throw new Error(event.message);
        }
      }
    } catch (error) {
      if (abort.signal.aborted) {
        stopReason = ACP_STOP_REASONS.cancelled;
      } else {
        session.history.length = baseline; // failed turn leaves no trace
        throw error;
      }
    } finally {
      session.abort = null;
    }
    // An aborted response stream can end quietly instead of throwing.
    if (abort.signal.aborted) stopReason = ACP_STOP_REASONS.cancelled;

    if (reply !== "") session.history.push({ role: "assistant", content: reply });
    return { stopReason };
  }
}

const parse = <S extends z.ZodType>(method: string, schema: S, params: unknown): z.infer<S> => {
  const result = schema.safeParse(params);
  if (!result.success) {
    throw new JsonRpcError(JSONRPC_ERROR.invalidParams, AGENT_ERRORS.invalidParams(method, result.error.message));
  }
  return result.data;
};
