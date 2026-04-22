export const THINK_OPEN = "<thinking>";
export const THINK_CLOSE = "</thinking>";

export type TagSplitterHandlers = {
  onThinking: (text: string) => void;
  onText: (text: string) => void;
};

// Stateful splitter: feed text_delta chunks in order; routes characters to
// onThinking or onText based on <thinking>/</thinking> boundaries, handles
// tags split across chunks, and guards against a partial tag match at the
// end of a chunk (so we never emit "<thinki" as text before the close tag
// arrives). Mode starts as "text" — any content before a <thinking> tag is
// still a valid response.
export function makeTagSplitter(h: TagSplitterHandlers) {
  let mode: "thinking" | "text" = "text";
  let pending = "";

  function emit(text: string) {
    if (!text) return;
    if (mode === "thinking") h.onThinking(text);
    else h.onText(text);
  }

  function longestSuffixMatching(s: string, target: string): number {
    const max = Math.min(s.length, target.length - 1);
    for (let len = max; len > 0; len--) {
      if (target.startsWith(s.slice(s.length - len))) return len;
    }
    return 0;
  }

  function feed(chunk: string) {
    pending += chunk;

    while (pending.length > 0) {
      const target = mode === "text" ? THINK_OPEN : THINK_CLOSE;
      const idx = pending.indexOf(target);

      if (idx !== -1) {
        emit(pending.slice(0, idx));
        pending = pending.slice(idx + target.length);
        mode = mode === "text" ? "thinking" : "text";
        continue;
      }

      const hold = longestSuffixMatching(pending, target);
      if (hold < pending.length) {
        emit(pending.slice(0, pending.length - hold));
        pending = pending.slice(pending.length - hold);
      }
      break;
    }
  }

  function flush() {
    if (pending.length > 0) {
      emit(pending);
      pending = "";
    }
  }

  return { feed, flush };
}

export default makeTagSplitter;
