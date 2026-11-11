export const TOOL_E2E_CONFIG = {
  enabledEnv: "APPLE_FM_ACP_TOOL_E2E",
  trials: 10,
  turnTimeoutMs: 100_000,
  suiteTimeoutMs: 4_200_000,
  scenarios: [
    { name: "package", prompts: ["Read package.json and tell me the package name.", "What is this project's package name? Look in package.json.", "Open package.json. What name is declared there?"], expected: ["apple-fm-acp"], tools: true },
    { name: "folders", prompts: ["List the files in src/lib and tell me which folders exist.", "Which subdirectories are in src/lib? List that directory.", "Show the folders under src/lib by listing its contents."], expected: ["agent", "fm", "mcp", "tools"], tools: true },
    { name: "search", prompts: ["Which file defines AgentLoop / the tool loop? Search the code.", "Search src for runToolLoop and tell me where it is defined.", "Find the tool loop implementation by searching the code. Which file contains it?"], expected: ["agent-loop.ts"], tools: true },
    { name: "conversation", prompts: ["hi, what can you do?", "Hello! Tell me how you can help.", "Hey there, introduce yourself and your capabilities."], expected: [], tools: false },
  ],
} as const;
