export const ACTION_E2E_CONFIG = {
  enabledEnv: "APPLE_FM_ACP_ACTION_E2E",
  trials: 10,
  timeoutEnv: "APPLE_FM_ACP_ACTION_TIMEOUT_MS",
  timeoutMessage: "Real-model turn timed out",
  timeoutMs: 100_000,
  suiteTimeoutMs: 2_400_000,
  maxReplyChars: 240,
  file: "notes.txt",
  content: "hello world",
  writePrompts: [
    "Create a file called notes.txt containing: hello world",
    "Write hello world into a new file named notes.txt.",
    "Make notes.txt with the text hello world.",
  ],
  renderPrompts: [
    "Render a simple HTML page that says hello in a big blue heading.",
    "Use html_render to show hello as a large blue heading on a simple HTML page.",
    "Display a simple HTML page with a big heading saying hello, coloured blue.",
  ],
  renderName: "t3_code__html_render",
  renderDescription: "Render a complete HTML page for the user. Pass the page as html. Use the theme variables provided by T3 Code for charts and pages. " +
    "Theme: --background: #000; --foreground: #fff; --chart-1: #fff; --chart-2: #aaa; " +
    "Use var(--background) for the background and var(--foreground) for text. Use var(--chart-1) for primary headings. ".repeat(30),
  renderResult: "Rendered the HTML page.",
} as const;
