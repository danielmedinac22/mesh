import { NextRequest } from "next/server";
import { z } from "zod";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { getTicket, updateTicket } from "@/lib/ticket-store";
import { getPlan } from "@/lib/plan-store";
import { getRepo, getCurrentProjectId, loadConfig } from "@/lib/mesh-state";
import { loadMemory } from "@/lib/memory";
import { getEngine } from "@/lib/engine";
import {
  buildAdjustSystem,
  buildAdjustUser,
  buildAdjustCommitMessage,
  extractAdjustEdits,
} from "@/lib/prompts/adjust";
import {
  readRepoFile,
  writeRepoFile,
  stageFile,
  commitAll,
  getCurrentBranch,
  hasUnstagedChanges,
  pushCurrentBranch,
} from "@/lib/github";
import { repoDiffAgainstBase } from "@/lib/git-diff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const execFileP = promisify(execFile);

const BodySchema = z.object({
  ticket_id: z.string().min(1),
  repo: z.string().min(1),
  instruction: z.string().min(3).max(2000),
});

type AdjustEvent =
  | { type: "thinking"; delta: string }
  | { type: "text"; delta: string }
  | {
      type: "edit-ready";
      file: string;
      additions_estimate: number;
    }
  | {
      type: "commit";
      repo: string;
      sha: string;
      message: string;
      files: string[];
    }
  | {
      type: "push";
      repo: string;
      pushed: boolean;
      reason?: string;
    }
  | {
      type: "done";
      duration_ms: number;
      files_touched: number;
    }
  | { type: "error"; message: string };

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(body ?? {});
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues.map((i) => i.message).join(", ") },
      { status: 400 },
    );
  }
  const { ticket_id: ticketId, repo: repoName, instruction } = parsed.data;

  const ticket = await getTicket(ticketId);
  if (!ticket) {
    return Response.json({ error: `ticket ${ticketId} not found` }, { status: 404 });
  }
  if (ticket.status !== "for_review") {
    return Response.json(
      {
        error: `adjustments only run on for_review tickets (this one is ${ticket.status}).`,
      },
      { status: 409 },
    );
  }
  if (!ticket.plan_id) {
    return Response.json({ error: "ticket has no plan" }, { status: 409 });
  }
  const plan = await getPlan(ticket.plan_id);
  if (!plan) {
    return Response.json({ error: `plan ${ticket.plan_id} missing` }, { status: 404 });
  }
  const repo = await getRepo(repoName);
  if (!repo) {
    return Response.json({ error: `repo ${repoName} not registered` }, { status: 404 });
  }

  const projectId = ticket.projectId ?? plan.projectId ?? (await getCurrentProjectId());
  const memory = projectId ? await loadMemory(projectId) : null;
  if (!memory) {
    return Response.json(
      { error: "no memory — run /connect first." },
      { status: 409 },
    );
  }
  const config = await loadConfig();

  const encoder = new TextEncoder();
  const startedAt = Date.now();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (ev: AdjustEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
        } catch {
          // controller closed
        }
      };

      try {
        const branch = plan.classification.target_branch;
        const base = repo.defaultBranch || "main";

        // Make sure we're on the feature branch in the working tree.
        const cur = await getCurrentBranch(repo.localPath).catch(() => "");
        if (cur !== branch) {
          await execFileP("git", ["checkout", branch], {
            cwd: repo.localPath,
            timeout: 10_000,
          }).catch(() => null);
        }

        // Pull diff context against base — gives Claude the changed-files
        // list it needs to ground the addendum.
        const diff = await repoDiffAgainstBase(repo.localPath, base).catch(
          () => null,
        );
        const changedFiles =
          diff?.files.map((f) => ({
            path: f.path,
            status: f.status[0],
            additions: f.additions,
            deletions: f.deletions,
          })) ?? [];

        // Last 5 commits on the branch for "what we already did" context.
        const log = await execFileP(
          "git",
          ["log", `${base}..HEAD`, "--pretty=format:%H%x09%s", "-n", "5"],
          { cwd: repo.localPath, timeout: 10_000 },
        ).catch(() => ({ stdout: "" }));
        const recentCommits = log.stdout
          .split("\n")
          .map((l) => l.split("\t"))
          .filter((cols) => cols.length >= 2 && cols[0])
          .map((cols) => ({ sha: cols[0], message: cols[1] }));

        // Snapshot up to 4 of the most-changed files so Claude has real
        // code to ground in. We pick by total additions+deletions.
        const ranked = [...(diff?.files ?? [])]
          .filter((f) => !f.binary && f.status !== "deleted")
          .sort(
            (a, b) =>
              b.additions + b.deletions - (a.additions + a.deletions),
          )
          .slice(0, 4);
        const fileSnapshots = await Promise.all(
          ranked.map(async (f) => ({
            path: f.path,
            content: await readRepoFile(repo.localPath, f.path).catch(() => null),
          })),
        );

        const planV2 = plan.plan as { spec?: { summary?: string } };
        const planSummary = planV2.spec?.summary ?? plan.classification.summary;

        const system = buildAdjustSystem(memory);
        const userPrompt = buildAdjustUser({
          ticketTitle: ticket.title,
          ticketBody: ticket.description,
          planSummary,
          branch,
          base,
          repo: repoName,
          instruction,
          changedFiles,
          recentCommits,
          fileSnapshots,
        });

        const engine = getEngine(config.engineMode);
        let textBuf = "";
        for await (const ev of engine.run({
          prompt: userPrompt,
          system,
          cacheSystem: true,
          wrapThinking: true,
        })) {
          if (ev.type === "thinking") {
            send({ type: "thinking", delta: ev.delta });
          } else if (ev.type === "text") {
            textBuf += ev.delta;
            send({ type: "text", delta: ev.delta });
          } else if (ev.type === "error") {
            send({ type: "error", message: ev.message });
            controller.close();
            return;
          }
        }

        const edits = extractAdjustEdits(textBuf);
        if (edits.length === 0) {
          send({
            type: "error",
            message:
              "Claude declined the addendum (no file edits emitted). See thinking for why.",
          });
          controller.close();
          return;
        }

        const filesTouched: string[] = [];
        for (const edit of edits) {
          // Defense in depth — extractAdjustEdits already validates the
          // path shape, but writeRepoFile rejects path traversal too.
          const relPath = edit.path.replace(/^\.?\/+/, "");
          await writeRepoFile(repo.localPath, relPath, edit.content);
          await stageFile(repo.localPath, relPath);
          filesTouched.push(relPath);
          send({
            type: "edit-ready",
            file: relPath,
            additions_estimate: edit.content.split("\n").length,
          });
        }

        if (!(await hasUnstagedChanges(repo.localPath))) {
          send({
            type: "error",
            message:
              "no changes detected after the addendum — Claude may have written the same content.",
          });
          controller.close();
          return;
        }

        const message = buildAdjustCommitMessage({
          repo: repoName,
          instruction,
          filesChanged: filesTouched.length,
          ticketId,
        });
        const sha = await commitAll(repo.localPath, message);
        send({
          type: "commit",
          repo: repoName,
          sha,
          message,
          files: filesTouched,
        });

        const push = await pushCurrentBranch(repo.localPath);
        send({
          type: "push",
          repo: repoName,
          pushed: push.pushed,
          reason: push.reason,
        });

        // Record the addendum on the ticket for traceability — same array
        // the converse pipeline uses for plan adjustments.
        const fresh = await getTicket(ticketId);
        if (fresh) {
          await updateTicket(ticketId, {
            adjustments: [
              ...fresh.adjustments,
              {
                at: new Date().toISOString(),
                instruction: `[ship adjust · ${repoName}] ${instruction}`,
                previous_plan_id: plan.id,
              },
            ],
          });
        }

        send({
          type: "done",
          duration_ms: Date.now() - startedAt,
          files_touched: filesTouched.length,
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

// Avoid an unused import warning when the path import becomes redundant
// after future refactors.
void path;
