import { lstat, open, opendir, realpath, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { TOOL_CONFIG, positiveConfig } from "./tools.config.ts";

/** Check both lexical and canonical paths; missing leaves use their nearest existing parent. */
export const scopedPath = async (cwd: string, path: string): Promise<string> => {
  const root = await realpath(cwd);
  const target = resolve(root, path);
  const inside = (candidate: string) => {
    const rel = relative(root, candidate);
    if (rel === ".." || rel.startsWith("../") || isAbsolute(rel)) throw new Error(TOOL_CONFIG.pathEscape);
  };
  inside(target);
  let parent = target;
  for (;;) {
    try { inside(await realpath(parent)); break; }
    catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      const entry = await lstat(parent).catch((failure: unknown) => {
        if (failure instanceof Error && "code" in failure && failure.code === "ENOENT") return undefined;
        throw failure;
      });
      if (entry?.isSymbolicLink()) throw new Error(TOOL_CONFIG.pathEscape);
      const next = dirname(parent);
      if (next === parent) throw error;
      parent = next;
    }
  }
  return target;
};

export const localRead = async (cwd: string, path: string, signal: AbortSignal, line = 1, limit?: number): Promise<string> => {
  signal.throwIfAborted();
  const handle = await open(await scopedPath(cwd, path), "r");
  try {
    if (!(await handle.stat()).isFile()) throw new Error(TOOL_CONFIG.notFile);
    const buffer = Buffer.alloc(TOOL_CONFIG.fileBytes + 1);
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      signal.throwIfAborted();
      const chunk = await handle.read(buffer, bytesRead, buffer.length - bytesRead, bytesRead);
      if (!chunk.bytesRead) break;
      bytesRead += chunk.bytesRead;
    }
    signal.throwIfAborted();
    if (bytesRead > TOOL_CONFIG.fileBytes) throw new Error(TOOL_CONFIG.fileTooLarge);
    return buffer.subarray(0, bytesRead).toString("utf8").split("\n").slice(line - 1, limit === undefined ? undefined : line - 1 + limit).join("\n");
  } finally { await handle.close(); }
};

export const localWrite = async (cwd: string, path: string, content: string, signal: AbortSignal): Promise<string> => {
  signal.throwIfAborted();
  await writeFile(await scopedPath(cwd, path), content, { signal });
  return content;
};

export const localList = async (cwd: string, path: string, signal: AbortSignal): Promise<string> => {
  signal.throwIfAborted();
  const dir = await opendirBounded(await scopedPath(cwd, path), signal);
  return dir.map((entry) => entry.name + (entry.isDirectory() ? "/" : "")).sort().join("\n")
    + (dir.length >= TOOL_CONFIG.directoryEntries ? TOOL_CONFIG.truncated : "");
};

// Streaming enumeration bounds memory even for enormous directories.
const opendirBounded = async (path: string, signal: AbortSignal) => {
  const entries = [];
  const dir = await opendir(path);
  for await (const entry of dir) {
    signal.throwIfAborted();
    entries.push(entry);
    if (entries.length >= TOOL_CONFIG.directoryEntries) break;
  }
  return entries;
};

/** Literal text search, no regex execution; bounded traversal and bounded file reads. */
export const localSearch = async (cwd: string, path: string, query: string, signal: AbortSignal): Promise<string> => {
  const root = await scopedPath(cwd, path);
  const pending = [root];
  const matches: string[] = [];
  let visited = 0;
  while (pending.length && visited < TOOL_CONFIG.searchEntries && matches.length < TOOL_CONFIG.searchMatches) {
    const directory = pending.pop();
    if (!directory) break;
    for (const entry of await opendirBounded(directory, signal)) {
      signal.throwIfAborted();
      if (++visited > TOOL_CONFIG.searchEntries || matches.length >= TOOL_CONFIG.searchMatches) break;
      const file = resolve(directory, entry.name);
      if (entry.isDirectory() && !TOOL_CONFIG.searchSkip.some((name) => name === entry.name)) pending.push(file);
      if (!entry.isFile()) continue; // Never follow symlinks during traversal.
      let text: string;
      try { text = await localRead(cwd, file, signal); }
      catch (error) {
        signal.throwIfAborted();
        if (error instanceof Error && (error.message === TOOL_CONFIG.fileTooLarge ||
          ("code" in error && TOOL_CONFIG.searchSkipErrors.some((code) => code === String(error.code))))) continue;
        throw error;
      }
      if (text.includes("\0")) continue;
      for (const [index, line] of text.split("\n").entries()) {
        if (line.includes(query)) matches.push(`${relative(cwd, file)}:${index + 1}:${line.slice(0, TOOL_CONFIG.searchLineChars)}`);
        if (matches.length >= TOOL_CONFIG.searchMatches) break;
      }
    }
  }
  return matches.join("\n") + TOOL_CONFIG.searchBounded;
};

export const localCommand = async (cwd: string, command: string, args: string[], path: string | undefined, signal: AbortSignal): Promise<string> => {
  signal.throwIfAborted();
  const directory = await scopedPath(cwd, path ?? ".");
  const timed = AbortSignal.any([signal, AbortSignal.timeout(positiveConfig(TOOL_CONFIG.commandTimeoutEnv, TOOL_CONFIG.commandTimeoutMs))]);
  timed.throwIfAborted();
  return new Promise((resolveResult, reject) => {
    const child = spawn(command, args, { cwd: directory, shell: false, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let bytes = 0;
    let truncated = false;
    const collect = (chunk: Buffer) => {
      const remaining = TOOL_CONFIG.outputBytes - bytes;
      if (chunk.length > remaining) truncated = true;
      if (remaining > 0) { const kept = chunk.subarray(0, remaining); chunks.push(kept); bytes += kept.length; }
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    const kill = () => {
      if (child.pid !== undefined) {
        try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
      }
    };
    const abort = () => { kill(); };
    timed.addEventListener("abort", abort, { once: true });
    if (timed.aborted) abort();
    child.once("error", (error) => { timed.removeEventListener("abort", abort); reject(error); });
    child.once("close", (code, exitSignal) => {
      timed.removeEventListener("abort", abort);
      if (timed.aborted) { reject(timed.reason); return; }
      resolveResult(JSON.stringify({ output: Buffer.concat(chunks).toString("utf8"), truncated, exit: { code, signal: exitSignal } }));
    });
  });
};
