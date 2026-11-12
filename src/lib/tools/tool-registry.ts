import { localRead, localWrite, localList, localSearch, localCommand } from "./local-tools.ts";
import { resolve } from "node:path";
import { z } from "zod";
import { TOOL_CONFIG, TOOL_LABELS, positiveConfig } from "./tools.config.ts";
import type { ClientCapabilities, ClientRequest, ReadOptions, Tool } from "./tools.types.ts";

export const abortable = async <T>(promise: Promise<T>, signal: AbortSignal): Promise<T> => {
  signal.throwIfAborted();
  let listener: () => void = () => {};
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      listener = () => reject(signal.reason);
      signal.addEventListener("abort", listener, { once: true });
    })]);
  } finally { signal.removeEventListener("abort", listener); }
};

export const builtinTools = (sessionId: string, cwd: string, caps: ClientCapabilities, request: ClientRequest): Tool[] => {
  const tools: Tool[] = [];
  const rpc = (method: string, params: Record<string, unknown>, signal: AbortSignal) =>
    abortable(request(method, { sessionId, ...params }), AbortSignal.any([signal, AbortSignal.timeout(TOOL_CONFIG.requestTimeoutMs)]));
  const read = async (path: string, signal: AbortSignal, options: ReadOptions = {}) => caps.fs?.readTextFile ? z.object({ content: z.string() }).parse(
    await rpc(TOOL_CONFIG.read, { path: resolve(cwd, path), ...options }, signal)).content : localRead(cwd, path, signal, options.line, options.limit);
  const write = async (path: string, content: string, signal: AbortSignal) => {
    if (!caps.fs?.writeTextFile) return localWrite(cwd, path, content, signal);
    await rpc(TOOL_CONFIG.write, { path: resolve(cwd, path), content }, signal);
    return content;
  };
  const add = <S extends z.ZodObject>(name: keyof typeof TOOL_LABELS, kind: Tool["kind"], readOnly: boolean, schema: S,
    run: (args: z.infer<S>, signal: AbortSignal) => Promise<string>) => {
    tools.push({ name, description: TOOL_LABELS[name], kind, readOnly,
      schema: z.toJSONSchema(schema), validate: (value) => schema.parse(value),
      run: (args, signal) => run(schema.parse(args), signal) });
  };
  add("read_file", "read", true, z.object({ path: z.string(), line: z.number().int().positive().optional(), limit: z.number().int().positive().optional() }),
    ({ path, line, limit }, signal) => read(path, signal, { ...(line === undefined ? {} : { line }), ...(limit === undefined ? {} : { limit }) }));
  add("write_file", "edit", false, z.object({ path: z.string(), content: z.string() }),
    ({ path, content }, signal) => write(path, content, signal));
  add("edit_file", "edit", false,
    z.object({ path: z.string(), old_text: z.string().min(1), new_text: z.string() }), async ({ path, old_text, new_text }, signal) => {
      const content = await read(path, signal);
      if (content.split(old_text).length !== 2) throw new Error(TOOL_CONFIG.ambiguous);
      return write(path, content.replace(old_text, () => new_text), signal);
    });
  add("run_command", "execute", false,
    z.strictObject({ command: z.string(), args: z.array(z.string()).optional(), cwd: z.string().optional() }), async (args, signal) => {
      if (!caps.terminal) return localCommand(cwd, args.command, args.args ?? [], args.cwd, signal);
      const timed = AbortSignal.any([signal, AbortSignal.timeout(positiveConfig(TOOL_CONFIG.commandTimeoutEnv, TOOL_CONFIG.commandTimeoutMs))]);
      // If cancellation wins during creation, release the eventual terminal too.
      const creation = request(TOOL_CONFIG.create, { sessionId, ...args, cwd: resolve(cwd, args.cwd ?? cwd), outputByteLimit: TOOL_CONFIG.outputBytes });
      const cleanup = async (terminalId: string) => {
        const cleanupSignal = AbortSignal.timeout(TOOL_CONFIG.cleanupTimeoutMs);
        await rpc(TOOL_CONFIG.kill, { terminalId }, cleanupSignal).catch(() => {});
        await rpc(TOOL_CONFIG.release, { terminalId }, cleanupSignal).catch(() => {});
      };
      let terminalId: string;
      try { terminalId = z.object({ terminalId: z.string() }).parse(await abortable(creation, timed)).terminalId; }
      catch (error) {
        void creation.then((value) => cleanup(z.object({ terminalId: z.string() }).parse(value).terminalId)).catch(() => {});
        throw error;
      }
      try {
        const exit = await rpc(TOOL_CONFIG.wait, { terminalId }, timed);
        const output = z.object({ output: z.string(), truncated: z.boolean() }).parse(await rpc(TOOL_CONFIG.output, { terminalId }, timed));
        return JSON.stringify({ ...output, exit });
      } finally { await cleanup(terminalId); }
    });
  add("list_directory", "read", true, z.object({ path: z.string().default(".") }),
    ({ path }, signal) => localList(cwd, path, signal));
  add("search_files", "read", true, z.object({ query: z.string().min(1), path: z.string().default(".") }),
    ({ path, query }, signal) => localSearch(cwd, path, query, signal));
  return tools;
};
