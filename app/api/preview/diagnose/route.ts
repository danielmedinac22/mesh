import { NextRequest } from "next/server";
import { z } from "zod";
import { getEngine } from "@/lib/engine";
import { loadConfig } from "@/lib/mesh-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  repo: z.string().min(1),
  failKind: z.string().optional(),
  reason: z.string().optional(),
  logTail: z.array(z.string()).default([]),
  // Free-form context the UI passes through (e.g. detected env vars,
  // package manager, plan rationale).
  context: z.record(z.unknown()).optional(),
});

const SYSTEM = `You are a senior platform engineer diagnosing a failed local "run" of one repo inside a poly-repo project.

You receive:
- repo name
- failKind (one of: install, start, ready-timeout, docker-not-running, docker-compose-failed, no-script, unknown)
- short failure reason
- last ~50 lines of stdout/stderr
- optional context (package manager, env vars detected, etc.)

Diagnose the root cause and propose ONE concrete next action the user can take. Be precise and short — no hedging, no "you may want to try…", no recap of the log.

Output VALID JSON only, no markdown fences:
{
  "diagnosis": "1-2 sentences explaining the actual cause",
  "actionKind": "missing-env" | "port-conflict" | "install-fix" | "docker" | "lockfile" | "config" | "other",
  "actionLabel": "short button-style label, e.g. 'Add OPENAI_API_KEY'",
  "actionDetail": "1-2 sentences telling the user exactly what to do, including specific commands or env keys when relevant",
  "confidence": "high" | "medium" | "low"
}

Rules:
- If logs mention "EADDRINUSE" or "port already in use": actionKind=port-conflict, suggest killing the offending process or restarting.
- If logs mention an env var by name (regex /[A-Z][A-Z0-9_]+ is (not set|undefined|missing)/): actionKind=missing-env, name the var.
- If logs mention "ENOENT" / "command not found" for a tool (docker, pnpm, etc.): actionKind=other, suggest installing it.
- If logs mention lockfile mismatch ("ERR_PNPM_LOCKFILE_*", "package-lock out of sync"): actionKind=lockfile.
- For Docker build failures, scan the WHOLE log (not just the tail). Look for the FIRST line matching:
  - "ERROR [<stage> <step>] RUN ..." — that step's command is the failure point.
  - "failed to solve" / "executor failed running"
  - "COPY failed: file not found"
  - dockerfile syntax errors, missing base images, network errors fetching deps.
  Cite the failing step (RUN/COPY content) and the immediate error line. actionKind=other if it's a missing tool/dep, missing-env if a build-arg / env is unset, config for dockerfile or compose-file edits.
- Mesh exposes a "deps-only" retry that runs only services without a \`build:\` directive (e.g. postgres + redis). When the failure is in a build step that needs private-registry creds (AWS CodeArtifact, GitHub Packages, etc.) AND the user might not have them, set actionKind="docker", actionLabel="Retry deps only", actionDetail="Click \"retry — deps only\" on the card. Mesh will run only the services that pull public images (postgres, redis, etc.) so you can iterate locally even without build creds."
- If failKind=docker-not-running: actionKind=docker, actionLabel='Start Docker Desktop'.
- If failKind=no-script: actionKind=config, suggest adding a "dev" script or wiring docker-compose.
- If you genuinely can't tell: confidence=low, actionKind=other, suggest "view full log".`;

function extractJson(raw: string): string {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return raw;
  return raw.slice(start, end + 1);
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
  const { repo, failKind, reason, logTail, context } = parsed.data;

  const config = await loadConfig();
  const engine = getEngine(config.engineMode);

  const userPrompt = [
    `repo: ${repo}`,
    `failKind: ${failKind ?? "unknown"}`,
    `reason: ${reason ?? "(none)"}`,
    "",
    "logTail (newest at bottom):",
    "```",
    ...logTail.slice(-200),
    "```",
    context ? `\ncontext: ${JSON.stringify(context, null, 2)}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (data: unknown) => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          // ignore
        }
      };
      let textBuf = "";
      try {
        for await (const ev of engine.run({
          system: SYSTEM,
          prompt: userPrompt,
          cacheSystem: false,
          wrapThinking: true,
        })) {
          if (ev.type === "thinking") {
            send({ type: "thinking", delta: ev.delta });
          } else if (ev.type === "text") {
            textBuf += ev.delta;
          } else if (ev.type === "error") {
            send({ type: "error", message: ev.message });
            return;
          } else if (ev.type === "done") {
            try {
              const parsed = JSON.parse(extractJson(textBuf));
              send({ type: "result", ...parsed });
            } catch {
              send({
                type: "result",
                diagnosis:
                  "Couldn't structure the diagnosis. Raw output below.",
                actionKind: "other",
                actionLabel: "View full log",
                actionDetail: textBuf.slice(0, 300),
                confidence: "low",
              });
            }
          }
        }
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
