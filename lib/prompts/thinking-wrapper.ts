// Opus 4.7 redacts native extended-thinking output, so to preserve the
// "watch the model reason" narrative we instruct Claude to wrap its chain
// of thought in <thinking> tags in plain text. A server-side tag splitter
// then routes the stream into separate thinking/text channels for the UI.
export const THINKING_TAG_INSTRUCTION = `You reason out loud before answering.

Before your final response, enclose your full chain of thought inside
<thinking>...</thinking> tags. Inside those tags: narrate tradeoffs,
check assumptions, consider edge cases, and revise if needed.

After </thinking>, write the final response as you would to a user —
no meta-commentary, no "let me explain my reasoning", just the answer.`;

export function wrapSystemWithThinking(base: string | undefined): string {
  if (!base || base.trim().length === 0) return THINKING_TAG_INSTRUCTION;
  return `${base}\n\n---\n\n${THINKING_TAG_INSTRUCTION}`;
}
