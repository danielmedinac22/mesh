import { NextRequest } from "next/server";
import { z } from "zod";
import {
  ensureExitCleanup,
  startPreview,
  getSession,
  type PreviewEvent,
  type FailKind,
} from "@/lib/preview-server";
import { getProject, getReposForProject } from "@/lib/mesh-state";
import { readCachedPlan } from "@/lib/run-planner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  projectId: z.string().min(1),
  // Optional: skip these repos for this run.
  skip: z.array(z.string()).optional(),
  // Per-repo override for docker-compose mode. Defaults to "full". Use
  // "deps-only" for repos where the user can't build app images.
  composeMode: z.record(z.enum(["full", "deps-only"])).optional(),
});

// Per-repo SSE event shape, multiplexed by `repo` field.
type ProjectRunEvent =
  | { repo: string; type: "status"; status: PreviewEvent["type"] | string }
  | { repo: string; type: "log"; chunk: string }
  | { repo: string; type: "ready"; port: number; url: string }
  | { repo: string; type: "failed"; reason: string; failKind?: FailKind }
  | { type: "wave-start"; wave: number; repos: string[] }
  | { type: "wave-done"; wave: number; outcome: "ready" | "all-failed" | "timeout" }
  | { type: "project-done"; ready: number; failed: number; skipped: number }
  | { type: "error"; message: string };

const WAVE_TIMEOUT_MS = 60_000;

function wait(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

async function waitForWaveSettled(
  repoNames: string[],
): Promise<"ready" | "all-failed" | "timeout"> {
  const start = Date.now();
  while (Date.now() - start < WAVE_TIMEOUT_MS) {
    const sessions = repoNames.map((n) => getSession(`run-${n}`, n));
    if (sessions.some((s) => s?.status === "ready")) return "ready";
    if (
      sessions.every(
        (s) => s?.status === "failed" || s?.status === "stopped",
      )
    ) {
      return "all-failed";
    }
    await wait(500);
  }
  return "timeout";
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(body ?? {});
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues.map((i) => i.message).join(", ") },
      { status: 400 },
    );
  }

  const project = await getProject(parsed.data.projectId);
  if (!project) {
    return Response.json(
      { error: `project not found: ${parsed.data.projectId}` },
      { status: 404 },
    );
  }
  const plan = await readCachedPlan(parsed.data.projectId);
  if (!plan) {
    return Response.json(
      {
        error:
          "no run plan cached — open the project's Run page first to let Claude plan it.",
      },
      { status: 409 },
    );
  }
  const repos = await getReposForProject(parsed.data.projectId);
  const repoByName = new Map(repos.map((r) => [r.name, r]));
  const skip = new Set(parsed.data.skip ?? []);

  ensureExitCleanup();

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (ev: ProjectRunEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
        } catch {
          // controller closed
        }
      };

      const tally = { ready: 0, failed: 0, skipped: 0 };

      // Surface skipped (planner-decided) repos up front so the UI grid
      // shows them immediately.
      for (const r of plan.perRepo) {
        if (r.role === "skipped" || skip.has(r.name)) {
          tally.skipped += 1;
          send({
            repo: r.name,
            type: "failed",
            failKind: "no-script",
            reason:
              skip.has(r.name)
                ? "skipped by user"
                : r.reason || "no run script and no docker-compose",
          });
        }
      }

      try {
        for (let i = 0; i < plan.waves.length; i += 1) {
          const wave = plan.waves[i];
          const live = wave.filter(
            (n) => !skip.has(n) && repoByName.has(n),
          );
          if (live.length === 0) continue;

          send({ type: "wave-start", wave: i + 1, repos: live });

          // Kick off every repo in the wave in parallel. startPreview emits
          // events via onEvent; we forward them with the repo name attached.
          await Promise.all(
            live.map(async (repoName) => {
              const r = repoByName.get(repoName)!;
              try {
                await startPreview({
                  ticketId: `run-${repoName}`,
                  repoName,
                  cwd: r.localPath,
                  composeMode: parsed.data.composeMode?.[repoName],
                  onEvent: (ev) => {
                    if (ev.type === "ready") {
                      send({ repo: repoName, ...ev });
                    } else if (ev.type === "failed") {
                      send({ repo: repoName, ...ev });
                    } else {
                      send({ repo: repoName, ...ev });
                    }
                  },
                });
              } catch (err) {
                send({
                  repo: repoName,
                  type: "failed",
                  failKind: "start",
                  reason:
                    err instanceof Error ? err.message : String(err),
                });
              }
            }),
          );

          const outcome = await waitForWaveSettled(live);
          send({ type: "wave-done", wave: i + 1, outcome });

          // Don't bail early on "all-failed" or "timeout" — let later waves
          // try anyway (they may not strictly depend on this one).
        }

        // Final tally based on actual session state.
        for (const r of plan.perRepo) {
          if (r.role === "skipped" || skip.has(r.name)) continue;
          const s = getSession(`run-${r.name}`, r.name);
          if (s?.status === "ready") tally.ready += 1;
          else tally.failed += 1;
        }
        send({ type: "project-done", ...tally });
      } catch (err) {
        send({
          type: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        try {
          controller.close();
        } catch {
          // ignore
        }
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
