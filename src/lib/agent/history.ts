import type { ChatMessage } from "../fm/fm.types.ts";

/** Drop the oldest messages until the history fits the budget; the newest message is always kept. */
export const trimHistory = (history: ChatMessage[], charBudget: number): ChatMessage[] => {
  let total = 0;
  let start = history.length;
  for (let i = history.length - 1; i >= 0; i--) {
    const size = history[i]?.content.length ?? 0;
    if (start < history.length && total + size > charBudget) break;
    total += size;
    start = i;
  }
  // Never begin on an orphaned assistant reply.
  while (start < history.length - 1 && history[start]?.role === "assistant") start++;
  return history.slice(start);
};
