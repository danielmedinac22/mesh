import { NextRequest } from "next/server";
import path from "node:path";
import { promises as fs } from "node:fs";
import { ingestRepos, type IngestResult } from "@/lib/repo-ingest";
import { buildConnectSystemPrompt, CONNECT_USER_PROMPT } from "@/lib/prompts/connect";
import { getEngine, DEFAULT_MODEL } from "@/lib/engine";
import { MemorySchema, parseMemoryJson, saveMemory, type Memory } from "@/lib/memory";
import { loadConfig, addRepo } from "@/lib/mesh-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ConnectEvent =
  | { type: "ingest-start"; paths: string[] }
  | { type: "ingest-done"; totalTokens: number; degraded: boolean; repos: { name: string; files: number; tokens_est: number }[] }
  | { type: "repo-ready"; name: string }
  | { type: "thinking"; delta: string }
  | { type: "text"; delta: string }
  | { type: "meta"; ttft_ms: number }
  | { type: "memory"; memory: Memory }
  | { type: "retry"; attempt: number; reason: string }
  | {
      type: "done";
      duration_ms: number;
      engine_mode: string;
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    }
  | { type: "error"; message: string };

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const paths = Array.isArray(body?.paths)
    ? (body.paths as string[]).map((p) => String(p))
    : [];

  if (paths.length === 0) {
    return Response.json({ error: "paths[] required" }, { status: 400 });
  }

  for (const p of paths) {
    try {
      const stat = await fs.stat(p);
      if (!stat.isDirectory()) {
        return Response.json(
          { error: `not a directory: ${p}` },
          { status: 400 },
        );
      }
    } catch {
      return Response.json(
        { error: `path not found: ${p}` },
        { status: 400 },
      );
    }
  }

  const encoder = new TextEncoder();
  const startedAt = Date.now();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (ev: ConnectEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
      };

      try {
        const config = await loadConfig();
        send({ type: "ingest-start", paths });
        const ingest = await ingestRepos(paths);
        send({
          type: "ingest-done",
          totalTokens: ingest.totalTokens,
          degraded: ingest.degraded,
          repos: ingest.repos.map((r) => ({
            name: r.name,
            files: r.files.length,
            tokens_est: estimateRepoChars(r) / 4,
          })),
        });

        for (const repo of ingest.repos) {
          const existing = path.resolve(repo.localPath);
          await addRepo({
            name: repo.name,
            localPath: existing,
            defaultBranch: "main",
            connectedAt: new Date().toISOString(),
          });
        }

        const memory = await runWithRetries(ingest, config.engineMode, send);
        const duration_ms = Date.now() - startedAt;
        const withMeta: Memory = {
          ...memory,
          meta: {
            ...(memory.meta ?? {}),
            generated_at: new Date().toISOString(),
            model: DEFAULT_MODEL,
            engine_mode: config.engineMode,
            duration_ms,
            repos_ingested: ingest.repos.map((r) => r.name),
          },
        };
        await saveMemory(withMeta);
        send({ type: "memory", memory: withMeta });
        send({
          type: "done",
          duration_ms,
          engine_mode: config.engineMode,
          input_tokens: withMeta.meta?.input_tokens,
          output_tokens: withMeta.meta?.output_tokens,
          cache_creation_input_tokens: withMeta.meta?.cache_creation_input_tokens,
          cache_read_input_tokens: withMeta.meta?.cache_read_input_tokens,
        });
      } catch (err) {
        send({
          type: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

function estimateRepoChars(repo: {
  files: { content: string }[];
  gitLog: string;
  adrs: { content: string }[];
}): number {
  let c = 0;
  for (const f of repo.files) c += f.content.length;
  c += repo.gitLog.length;
  for (const a of repo.adrs) c += a.content.length;
  return c;
}

async function runWithRetries(
  ingest: IngestResult,
  mode: "raw" | "agent",
  send: (ev: ConnectEvent) => void,
): Promise<Memory> {
  const engine = getEngine(mode);
  const system = buildConnectSystemPrompt(ingest);
  const MAX_ATTEMPTS = 3;
  let lastError: string = "no attempts run";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const corrective =
      attempt === 1
        ? CONNECT_USER_PROMPT
        : `${CONNECT_USER_PROMPT}\n\nYour previous attempt did not produce valid JSON matching the schema. Error: ${lastError}\nEmit ONLY the JSON object after </thinking>. No markdown fences, no prose.`;

    if (attempt > 1) {
      send({ type: "retry", attempt, reason: lastError });
    }

    let fullText = "";
    let fullThinking = "";
    let metaInputTokens: number | undefined;
    let metaOutputTokens: number | undefined;
    let metaCacheCreate: number | undefined;
    let metaCacheRead: number | undefined;
    const readyRepos = new Set<string>();
    const repoNames = new Set(ingest.repos.map((r) => r.name));

    for await (const ev of engine.run({
      prompt: corrective,
      system,
      cacheSystem: true,
      wrapThinking: false,
    })) {
      if (ev.type === "thinking") {
        fullThinking += ev.delta;
        send({ type: "thinking", delta: ev.delta });
      } else if (ev.type === "text") {
        fullText += ev.delta;
        // Connect streams JSON directly (no thinking wrap). Route text to
        // the UI's reasoning panel so the user watches the memory emerge.
        send({ type: "thinking", delta: ev.delta });
        for (const name of repoNames) {
          if (!readyRepos.has(name) && mentionsRepoCompletion(fullText, name)) {
            readyRepos.add(name);
            send({ type: "repo-ready", name });
          }
        }
      } else if (ev.type === "meta") {
        send({ type: "meta", ttft_ms: ev.ttft_ms });
      } else if (ev.type === "done") {
        metaInputTokens = ev.input_tokens;
        metaOutputTokens = ev.output_tokens;
        metaCacheCreate = ev.cache_creation_input_tokens;
        metaCacheRead = ev.cache_read_input_tokens;
      } else if (ev.type === "error") {
        lastError = ev.message;
        continue;
      }
    }

    for (const name of repoNames) {
      if (!readyRepos.has(name)) send({ type: "repo-ready", name });
    }

    try {
      const memory = parseMemoryJson(fullText);
      MemorySchema.parse(memory);
      return {
        ...memory,
        meta: {
          ...(memory.meta ?? {}),
          input_tokens: metaInputTokens,
          output_tokens: metaOutputTokens,
          cache_creation_input_tokens: metaCacheCreate,
          cache_read_input_tokens: metaCacheRead,
        },
      };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  throw new Error(`Connect failed after ${MAX_ATTEMPTS} attempts: ${lastError}`);
}

// Connect emits repo summaries sequentially in the JSON output. We mark a
// repo as "ready" once we've seen its name token followed by at least one
// "evidence" block closing (}]) — strong signal its invariant list is being
// populated. Not perfect; a final sweep on "done" marks stragglers.
function mentionsRepoCompletion(stream: string, repoName: string): boolean {
  const marker = `"name": "${repoName}"`;
  const idx = stream.indexOf(marker);
  if (idx === -1) return false;
  const after = stream.slice(idx + marker.length);
  return /\}\s*\]/.test(after);
}
