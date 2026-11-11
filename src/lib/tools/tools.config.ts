export const TOOL_CONFIG = {
  fileBytes: 1_000_000, directoryEntries: 500, searchEntries: 2000, searchMatches: 100, searchLineChars: 300,
  searchSkip: ["node_modules", ".git"], searchSkipErrors: ["ENOENT", "EACCES"],
  pathEscape: "Path escapes session cwd; outside file access is not supported",
  notFile: "Expected a regular file", fileTooLarge: "File exceeds local read limit",
  searchBounded: "\n[bounded search: up to 2000 entries, 100 matches; node_modules/.git skipped]",
  cleanupTimeoutMs: 2000,
  iterations: 8, catalogueChars: 2400, resultChars: 1500, commandTimeoutMs: 60_000,
  requestTimeoutMs: 90_000, outputBytes: 32_000, descriptionChars: 60,
  iterationsEnv: "APPLE_FM_ACP_MAX_ITERATIONS", catalogueEnv: "APPLE_FM_ACP_CATALOGUE_CHARS",
  resultEnv: "APPLE_FM_ACP_RESULT_CHARS", commandTimeoutEnv: "APPLE_FM_ACP_COMMAND_TIMEOUT_MS",
  truncated: "\n[truncated]", rejected: "Permission rejected", ambiguous: "Expected exactly one occurrence of old_text",
  decide: "Choose one action: read/show/open file -> read_file; list directory -> list_directory; find text -> search_files; run/test/install -> run_command; change/fix/add -> edit_file. Conversation/question or done -> reply. Use file tools before answering file questions. After a result answers the request, choose reply; file contents are not paths. Tools:\n",
  args: "Return the arguments for this tool: ", final: "Answer the user using the tool results. If tools failed, explain honestly.",
  cap: "Tool iteration limit reached. Explain what was completed and what remains.",
  fallback: "Return arguments as a JSON object encoded in the json string field.",
  reply: "reply", callMarker: "[tool call]", resultMarker: "[tool result]", errorMarker: "[tool error]",
  permission: "session/request_permission", allow: "allow_once", reject: "reject_once",
  allowName: "Allow once", rejectName: "Reject once", timeout: "Tool request timed out",
  read: "fs/read_text_file", write: "fs/write_text_file", create: "terminal/create",
  wait: "terminal/wait_for_exit", output: "terminal/output", kill: "terminal/kill", release: "terminal/release",
} as const;
export const positiveConfig = (key: string, fallback: number): number => {
  const value = Number(process.env[key]);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
};
export const TOOL_LABELS = {
  read_file: "Read/show file contents; path relative to cwd", write_file: "Create or overwrite a text file", edit_file: "Replace exactly one occurrence in a file",
  run_command: "Run executable + args (no shell); test/install/build",
  list_directory: "List files and subdirectories at path (default cwd)",
  search_files: "Find literal text in files recursively under path",
} as const;
