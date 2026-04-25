import Anthropic from "@anthropic-ai/sdk";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { makeTagSplitter } from "@/lib/streaming/tag-splitter";
import { wrapSystemWithThinking } from "@/lib/prompts/thinking-wrapper";

export { DEFAULT_MODEL, DEFAULT_EFFORT } from "@/lib/engine-defaults";
import { DEFAULT_MODEL, DEFAULT_EFFORT } from "@/lib/engine-defaults";
const MAX_TOKENS = 16_000;

export type EngineMode = "raw" | "agent";

export type EngineEvent =
  | { type: "thinking"; delta: string }
  | { type: "text"; delta: string }
  | { type: "meta"; ttft_ms: number }
  | {
      type: "done";
      duration_ms: number;
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    }
  | { type: "error"; message: string };

export type EngineRunOptions = {
  prompt: string;
  system?: string;
  cacheSystem?: boolean;
  // When false, the system prompt is used verbatim (no <thinking>-tag
  // instruction appended) and all model output is routed to `text` events.
  // Use for JSON-only tasks like Connect, where ingested source code may
  // contain literal "<thinking>" substrings that would otherwise desync
  // the tag splitter.
  wrapThinking?: boolean;
  signal?: AbortSignal;
};

export interface Engine {
  mode: EngineMode;
  run(opts: EngineRunOptions): AsyncIterable<EngineEvent>;
}

function buildSystemBlocks(
  system: string | undefined,
  cache: boolean,
  wrapThinking: boolean,
) {
  const merged = wrapThinking ? wrapSystemWithThinking(system) : (system ?? "");
  if (!cache) return merged;
  return [
    {
      type: "text" as const,
      text: merged,
      cache_control: { type: "ephemeral" as const },
    },
  ];
}

class RawSdkEngine implements Engine {
  mode: EngineMode = "raw";

  async *run(opts: EngineRunOptions): AsyncIterable<EngineEvent> {
    const client = new Anthropic();
    const startedAt = Date.now();
    let metaSent = false;
    const wrapThinking = opts.wrapThinking !== false;

    const buffer: EngineEvent[] = [];
    let waiter: (() => void) | null = null;
    let ended = false;
    let errorMessage: string | null = null;

    const push = (ev: EngineEvent) => {
      buffer.push(ev);
      if (waiter) {
        const w = waiter;
        waiter = null;
        w();
      }
    };

    const emitDelta = (delta: string, asThinking: boolean) => {
      if (!metaSent) {
        push({ type: "meta", ttft_ms: Date.now() - startedAt });
        metaSent = true;
      }
      push({ type: asThinking ? "thinking" : "text", delta });
    };

    const splitter = wrapThinking
      ? makeTagSplitter({
          onThinking: (d) => emitDelta(d, true),
          onText: (d) => emitDelta(d, false),
        })
      : null;

    const system = buildSystemBlocks(
      opts.system,
      !!opts.cacheSystem,
      wrapThinking,
    );

    const runStream = async () => {
      try {
        const stream = client.beta.messages.stream(
          {
            model: DEFAULT_MODEL,
            max_tokens: MAX_TOKENS,
            thinking: { type: "adaptive" },
            output_config: { effort: DEFAULT_EFFORT },
            system: system as never,
            messages: [{ role: "user", content: opts.prompt }],
          } as never,
          opts.signal ? { signal: opts.signal as never } : undefined,
        );

        let inputTokens: number | undefined;
        let outputTokens: number | undefined;
        let cacheCreate: number | undefined;
        let cacheRead: number | undefined;

        for await (const event of stream) {
          const anyEv = event as {
            type: string;
            delta?: { type?: string; text?: string };
            usage?: {
              input_tokens?: number;
              output_tokens?: number;
              cache_creation_input_tokens?: number;
              cache_read_input_tokens?: number;
            };
            message?: {
              usage?: {
                input_tokens?: number;
                output_tokens?: number;
                cache_creation_input_tokens?: number;
                cache_read_input_tokens?: number;
              };
            };
          };
          if (anyEv.type === "content_block_delta" && anyEv.delta) {
            if (anyEv.delta.type === "text_delta" && anyEv.delta.text) {
              if (splitter) splitter.feed(anyEv.delta.text);
              else emitDelta(anyEv.delta.text, false);
            }
          }
          if (anyEv.type === "message_start" && anyEv.message?.usage) {
            inputTokens = anyEv.message.usage.input_tokens;
            cacheCreate = anyEv.message.usage.cache_creation_input_tokens;
            cacheRead = anyEv.message.usage.cache_read_input_tokens;
          }
          if (anyEv.type === "message_delta" && anyEv.usage) {
            outputTokens = anyEv.usage.output_tokens;
          }
        }
        splitter?.flush();
        push({
          type: "done",
          duration_ms: Date.now() - startedAt,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          cache_creation_input_tokens: cacheCreate,
          cache_read_input_tokens: cacheRead,
        });
      } catch (err) {
        errorMessage = err instanceof Error ? err.message : String(err);
        push({ type: "error", message: errorMessage });
      } finally {
        ended = true;
        if (waiter) {
          const w = waiter;
          waiter = null;
          w();
        }
      }
    };

    runStream();

    while (true) {
      if (buffer.length > 0) {
        yield buffer.shift()!;
        continue;
      }
      if (ended) return;
      await new Promise<void>((resolve) => {
        waiter = resolve;
      });
    }
  }
}

class AgentSdkEngine implements Engine {
  mode: EngineMode = "agent";

  async *run(opts: EngineRunOptions): AsyncIterable<EngineEvent> {
    const startedAt = Date.now();
    let metaSent = false;
    const wrapThinking = opts.wrapThinking !== false;

    const buffer: EngineEvent[] = [];
    let waiter: (() => void) | null = null;
    let ended = false;

    const push = (ev: EngineEvent) => {
      buffer.push(ev);
      if (waiter) {
        const w = waiter;
        waiter = null;
        w();
      }
    };

    const emitDelta = (delta: string, asThinking: boolean) => {
      if (!metaSent) {
        push({ type: "meta", ttft_ms: Date.now() - startedAt });
        metaSent = true;
      }
      push({ type: asThinking ? "thinking" : "text", delta });
    };

    const splitter = wrapThinking
      ? makeTagSplitter({
          onThinking: (d) => emitDelta(d, true),
          onText: (d) => emitDelta(d, false),
        })
      : null;

    const systemPrompt = wrapThinking
      ? wrapSystemWithThinking(opts.system)
      : (opts.system ?? "");

    const runStream = async () => {
      try {
        const result = query({
          prompt: `${systemPrompt}\n\n---\n\n${opts.prompt}`,
          options: {
            model: DEFAULT_MODEL,
            includePartialMessages: true,
            settingSources: [],
            thinking: { type: "adaptive" },
            effort: DEFAULT_EFFORT,
            permissionMode: "bypassPermissions",
            allowDangerouslySkipPermissions: true,
          } as never,
        });

        let inputTokens: number | undefined;
        let outputTokens: number | undefined;

        for await (const msg of result) {
          const anyMsg = msg as {
            type: string;
            event?: {
              type?: string;
              delta?: { type?: string; text?: string };
              usage?: { input_tokens?: number; output_tokens?: number };
            };
            usage?: { input_tokens?: number; output_tokens?: number };
          };
          if (anyMsg.type === "stream_event" && anyMsg.event) {
            const ev = anyMsg.event;
            if (ev.type === "content_block_delta" && ev.delta) {
              if (ev.delta.type === "text_delta" && ev.delta.text) {
                if (splitter) splitter.feed(ev.delta.text);
                else emitDelta(ev.delta.text, false);
              }
            }
          } else if (anyMsg.type === "result") {
            inputTokens = anyMsg.usage?.input_tokens ?? inputTokens;
            outputTokens = anyMsg.usage?.output_tokens ?? outputTokens;
            break;
          }

          if (opts.signal?.aborted) break;
        }

        splitter?.flush();
        push({
          type: "done",
          duration_ms: Date.now() - startedAt,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
        });
      } catch (err) {
        push({
          type: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        ended = true;
        if (waiter) {
          const w = waiter;
          waiter = null;
          w();
        }
      }
    };

    runStream();

    while (true) {
      if (buffer.length > 0) {
        yield buffer.shift()!;
        continue;
      }
      if (ended) return;
      await new Promise<void>((resolve) => {
        waiter = resolve;
      });
    }
  }
}

let cachedRaw: RawSdkEngine | null = null;
let cachedAgent: AgentSdkEngine | null = null;

export function getEngine(mode: EngineMode): Engine {
  if (mode === "agent") {
    cachedAgent ??= new AgentSdkEngine();
    return cachedAgent;
  }
  cachedRaw ??= new RawSdkEngine();
  return cachedRaw;
}
