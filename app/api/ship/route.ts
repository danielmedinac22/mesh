import { NextRequest } from "next/server";
import { z } from "zod";
import { getPlan, listPlans, type SavedPlan } from "@/lib/plan-store";
import { loadMemory, type Memory } from "@/lib/memory";
import { getCurrentProjectId, loadConfig, listRepos } from "@/lib/mesh-state";
import { bootstrapProjects } from "@/lib/migrations";
import { getEngine } from "@/lib/engine";
import {
  buildShipSystem,
  buildShipStepUser,
  buildShipCommitMessage,
  extractShipEdit,
} from "@/lib/prompts/ship";
import { flattenPlanV2, isPlanV2, type UnifiedStep } from "@/lib/prompts/plan";
import {
  readRepoFile,
  writeRepoFile,
  stageFile,
  commitAll,
  hasUnstagedChanges,
  getCurrentBranch,
  createBranch,
} from "@/lib/github";
import { runSkillChecks, type SkillViolation } from "@/lib/skill-runner";
import {
  createSession,
  writeSession,
  type ShipInterception,
  type ShipSession,
  type ShipStepResult,
} from "@/lib/ship-session";
import { openPr } from "@/lib/github-pr";
import { getTicket, updateTicket } from "@/lib/ticket-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  plan_id: z.string().optional(),
  ticket_id: z.string().optional(),
  force_simulated_prs: z.boolean().optional(),
  max_attempts_per_step: z.number().int().min(1).max(3).optional(),
  // When true, the first attempt per step drops the explicit
  // "respect invariants X" reminder, making skill interceptions organic.
  // The second attempt always runs with full invariant context.
  demo_loosen_first_attempt: z.boolean().optional(),
});

type ShipEvent =
  | {
      type: "session-start";
      session_id: string;
      plan_id: string;
      branch: string;
      repos: string[];
      steps: number;
    }
  | { type: "step-start"; step: number; repo: string; file: string; action: string }
  | { type: "thinking"; step: number; delta: string }
  | { type: "text"; step: number; delta: string }
  | { type: "draft-ready"; step: number; attempt: number; lines: number }
  | {
      type: "skill-intercept";
      step: number;
      attempt: number;
      skill_id: string;
      title: string;
      message: string;
      fix_hint: string;
    }
  | { type: "skill-pass"; step: number; attempt: number }
  | {
      type: "commit";
      step: number;
      repo: string;
      sha: string;
      message: string;
    }
  | { type: "step-done"; step: number; attempts: number }
  | {
      type: "pr-opened";
      repo: string;
      url: string;
      simulated: boolean;
      pushed: boolean;
      number?: number;
      push_reason?: string;
    }
  | { type: "done"; session_id: string; duration_ms: number }
  | { type: "error"; message: string; step?: number };

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(body ?? {});
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues.map((i) => i.message).join(", ") },
      { status: 400 },
    );
  }

  let planId = parsed.data.plan_id;
  const ticketId = parsed.data.ticket_id;
  if (!planId && ticketId) {
    const t = await getTicket(ticketId);
    if (t?.plan_id) planId = t.plan_id;
  }
  const saved = planId
    ? await getPlan(planId)
    : (await listPlans())[0] ?? null;
  if (!saved) {
    return Response.json(
      {
        error:
          "no plan available — open Build, approve, and Proceed first (persists the plan).",
      },
      { status: 409 },
    );
  }
  if (!isPlanV2(saved.plan)) {
    return Response.json(
      {
        error:
          "this plan was generated with the legacy v1 brain — re-run the build to regenerate it as a v2 SDD/TDD plan before shipping.",
      },
      { status: 409 },
    );
  }

  await bootstrapProjects();
  const projectId = saved.projectId ?? (await getCurrentProjectId());
  const memory = projectId ? await loadMemory(projectId) : null;
  if (!memory) {
    return Response.json(
      { error: "no memory — run /connect first." },
      { status: 409 },
    );
  }

  const config = await loadConfig();
  const maxAttempts = parsed.data.max_attempts_per_step ?? 2;
  const forceSim = !!parsed.data.force_simulated_prs;
  const loosen = !!parsed.data.demo_loosen_first_attempt;

  const encoder = new TextEncoder();
  const startedAt = Date.now();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const stepsDoneByShip = { count: 0 };
      const send = (ev: ShipEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
        if (!ticketId) return;
        // Best-effort ticket mirroring. Errors here must not break ship.
        void mirrorToTicket(ticketId, ev, stepsDoneByShip).catch(() => null);
      };

      try {
        await runShip({
          saved,
          memory,
          mode: config.engineMode,
          maxAttempts,
          forceSim,
          loosen,
          ticketId,
          send,
          startedAt,
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

async function runShip(args: {
  saved: SavedPlan;
  memory: Memory;
  mode: "raw" | "agent";
  maxAttempts: number;
  forceSim: boolean;
  loosen: boolean;
  ticketId?: string;
  send: (ev: ShipEvent) => void;
  startedAt: number;
}): Promise<void> {
  const {
    saved,
    memory,
    mode,
    maxAttempts,
    forceSim,
    loosen,
    ticketId,
    send,
    startedAt,
  } = args;
  if (!isPlanV2(saved.plan)) {
    throw new Error("ship requires a v2 plan");
  }
  const planV2 = saved.plan;
  const unified: UnifiedStep[] = flattenPlanV2(planV2);
  const totalSteps = unified.length;
  const engine = getEngine(mode);
  const system = buildShipSystem(memory);

  // Resolve repo paths once.
  const allRepos = await listRepos();
  const repoIndex = new Map(allRepos.map((r) => [r.name, r]));

  // Ensure every target repo is on the right branch; if the Converse step
  // created branches, they already exist. Otherwise, create here.
  const targetBranch = saved.classification.target_branch;
  const reposTouched = uniqueOrdered(unified.map((s) => s.repo));
  for (const name of reposTouched) {
    const rec = repoIndex.get(name);
    if (!rec) continue;
    const current = await getCurrentBranch(rec.localPath).catch(() => "");
    if (current !== targetBranch) {
      await createBranch(rec.localPath, targetBranch).catch(() => {
        // ignore; committer will fail loudly if branch is unusable.
      });
    }
  }

  let session: ShipSession = await createSession({
    plan_id: saved.id,
    branch: targetBranch,
    ticket_id: ticketId,
  });
  send({
    type: "session-start",
    session_id: session.id,
    plan_id: saved.id,
    branch: targetBranch,
    repos: reposTouched,
    steps: totalSteps,
  });

  for (let i = 0; i < unified.length; i += 1) {
    const step = unified[i];
    const rec = repoIndex.get(step.repo);
    if (!rec) {
      const result: ShipStepResult = {
        step: step.step,
        repo: step.repo,
        file: step.file,
        action: step.action,
        attempts: 0,
        thinking_chars: 0,
        interceptions: [],
        skipped: true,
        error: `repo ${step.repo} not registered`,
      };
      session.steps.push(result);
      await writeSession(session);
      send({ type: "error", message: result.error!, step: step.step });
      continue;
    }

    send({
      type: "step-start",
      step: step.step,
      repo: step.repo,
      file: step.file,
      action: step.action,
    });

    const currentContent = await readRepoFile(rec.localPath, step.file);
    let previousDraft: string | null = null;
    let lastViolation: SkillViolation | null = null;
    const interceptions: ShipInterception[] = [];
    let attempt = 0;
    let finalContent: string | null = null;
    let thinkingChars = 0;
    let textBuf = "";

    while (attempt < maxAttempts) {
      attempt += 1;
      textBuf = "";

      const userPrompt = buildShipStepUser({
        saved,
        step,
        totalSteps,
        currentContent,
        attempt,
        previousDraft,
        violation: lastViolation
          ? {
              title: lastViolation.title,
              message: lastViolation.message,
              fix_hint: lastViolation.fix_hint,
            }
          : null,
        loosen,
      });

      for await (const ev of engine.run({
        prompt: userPrompt,
        system,
        cacheSystem: true,
        wrapThinking: true,
      })) {
        if (ev.type === "thinking") {
          thinkingChars += ev.delta.length;
          send({ type: "thinking", step: step.step, delta: ev.delta });
        } else if (ev.type === "text") {
          textBuf += ev.delta;
        } else if (ev.type === "error") {
          send({ type: "error", message: ev.message, step: step.step });
          break;
        }
      }

      const edit = extractShipEdit(textBuf);
      if (!edit) {
        lastViolation = {
          skill_id: "ship-format",
          title: "ship-format",
          message: "Model output did not contain a fenced block with path=... header.",
          fix_hint:
            "Emit exactly one fenced code block tagged with path=<repo-relative-path> and the full file contents.",
        };
        previousDraft = textBuf.slice(-2000);
        continue;
      }

      send({
        type: "draft-ready",
        step: step.step,
        attempt,
        lines: edit.content.split("\n").length,
      });

      const violations = runSkillChecks({
        repo: step.repo,
        file: step.file,
        content: edit.content,
        previous: currentContent,
        ticket: saved.ticket,
      });

      if (violations.length === 0) {
        send({ type: "skill-pass", step: step.step, attempt });
        finalContent = edit.content;
        break;
      }

      const v = violations[0];
      interceptions.push({
        step: step.step,
        skill_id: v.skill_id,
        title: v.title,
        message: v.message,
        fix_hint: v.fix_hint,
        resolved: false,
      });
      send({
        type: "skill-intercept",
        step: step.step,
        attempt,
        skill_id: v.skill_id,
        title: v.title,
        message: v.message,
        fix_hint: v.fix_hint,
      });
      previousDraft = edit.content;
      lastViolation = v;
    }

    // Resolve interceptions against the final attempt's skill status.
    if (finalContent) {
      for (const it of interceptions) it.resolved = true;
    }

    const result: ShipStepResult = {
      step: step.step,
      repo: step.repo,
      file: step.file,
      action: step.action,
      attempts: attempt,
      thinking_chars: thinkingChars,
      interceptions,
      skipped: false,
    };

    if (!finalContent) {
      result.error = `skill violation persisted after ${maxAttempts} attempts`;
      session.steps.push(result);
      await writeSession(session);
      send({ type: "step-done", step: step.step, attempts: attempt });
      continue;
    }

    try {
      await writeRepoFile(rec.localPath, step.file, finalContent);
      await stageFile(rec.localPath, step.file);

      if (!(await hasUnstagedChanges(rec.localPath))) {
        // No actual change against HEAD (identical content). Skip commit but
        // don't treat it as failure — the step was executed correctly.
        result.error = "no-op edit (content identical to HEAD)";
      } else {
        const acIds =
          step.kind === "impl"
            ? Array.from(
                new Set(
                  planV2.tests
                    .filter((t) => step.test_ids.includes(t.test_id))
                    .flatMap((t) => t.ac_ids),
                ),
              )
            : undefined;
        const message = buildShipCommitMessage({
          step,
          totalSteps,
          acIds,
        });
        const sha = await commitAll(rec.localPath, message);
        result.commit_sha = sha;
        send({
          type: "commit",
          step: step.step,
          repo: step.repo,
          sha,
          message,
        });
      }
    } catch (err) {
      result.error = err instanceof Error ? err.message : String(err);
      send({ type: "error", message: result.error, step: step.step });
    }

    session.steps.push(result);
    await writeSession(session);
    send({ type: "step-done", step: step.step, attempts: attempt });
  }

  // Open a draft PR for every repo that had at least one committed step.
  // The PR is intentionally opened EARLY — before the user validates —
  // because Mesh leans on GitHub's "PR is a living thread" pattern: every
  // adjustment Claude makes after this point lands as another commit on
  // the same branch and shows up in the same PR. The user undrafts the PR
  // (via /api/ship/approve) when they're satisfied with the diff +
  // checks + preview.
  const reposWithCommits = new Set(
    session.steps
      .filter((s) => s.commit_sha)
      .map((s) => s.repo),
  );
  for (const name of reposWithCommits) {
    const rec = repoIndex.get(name);
    if (!rec) continue;
    const { title, body } = buildPrTitleBody(saved, name, session);
    try {
      const outcome = await openPr({
        repoName: name,
        repoPath: rec.localPath,
        base: rec.defaultBranch || "main",
        title,
        body,
        forceSimulated: forceSim,
      });
      session.prs.push({
        repo: outcome.repo,
        url: outcome.url,
        title: outcome.title,
        body: outcome.body,
        simulated: outcome.simulated,
        html_url: outcome.html_url,
        number: outcome.number,
      });
      send({
        type: "pr-opened",
        repo: outcome.repo,
        url: outcome.url,
        simulated: outcome.simulated,
        pushed: outcome.pushed,
        number: outcome.number,
        push_reason: outcome.push_reason,
      });
    } catch (err) {
      send({
        type: "error",
        message: `PR open failed for ${name}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      });
    }
  }

  session.status = "completed";
  session.finished_at = new Date().toISOString();
  await writeSession(session);

  send({
    type: "done",
    session_id: session.id,
    duration_ms: Date.now() - startedAt,
  });
}

function buildPrTitleBody(
  saved: SavedPlan,
  repoName: string,
  session: ShipSession,
): { title: string; body: string } {
  const repoSteps = session.steps.filter((s) => s.repo === repoName);
  const interceptCount = repoSteps.reduce(
    (n, s) => n + s.interceptions.filter((i) => i.resolved).length,
    0,
  );
  const title = `[mesh] ${saved.classification.summary.slice(0, 60)} (${repoName})`;
  const body = [
    `Ticket: ${saved.ticket}`,
    "",
    `Repo: ${repoName}`,
    `Target branch: ${saved.classification.target_branch}`,
    "",
    "Steps:",
    ...repoSteps.map(
      (s) =>
        `- step ${s.step} · ${s.action} ${s.file} · attempts ${s.attempts}${
          s.interceptions.length > 0
            ? ` · skills fired: ${s.interceptions
                .map((i) => i.skill_id)
                .join(", ")} (resolved)`
            : ""
        }`,
    ),
    "",
    `Skill interceptions resolved before commit: ${interceptCount}`,
    "",
    `Classifier: ${saved.classification.reasoning}`,
    "",
    "Opened by Mesh.",
  ].join("\n");
  return { title, body };
}

function uniqueOrdered<T>(arr: T[]): T[] {
  const seen = new Set<T>();
  const out: T[] = [];
  for (const v of arr) {
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

async function mirrorToTicket(
  ticketId: string,
  ev: ShipEvent,
  stepsDoneCounter: { count: number },
): Promise<void> {
  if (ev.type === "session-start") {
    await updateTicket(ticketId, {
      status: "in_process",
      ship_session: {
        id: ev.session_id,
        started_at: new Date().toISOString(),
        steps_total: ev.steps,
        steps_done: 0,
      },
    });
    return;
  }
  if (ev.type === "step-done") {
    stepsDoneCounter.count += 1;
    const t = await getTicket(ticketId);
    if (!t?.ship_session) return;
    await updateTicket(ticketId, {
      ship_session: {
        ...t.ship_session,
        steps_done: Math.max(t.ship_session.steps_done, stepsDoneCounter.count),
      },
    });
    return;
  }
  if (ev.type === "pr-opened") {
    const t = await getTicket(ticketId);
    if (!t) return;
    const prs = [
      ...t.prs,
      {
        repo: ev.repo,
        url: ev.url,
        simulated: ev.simulated,
        number: ev.number,
        html_url: ev.url,
      },
    ];
    await updateTicket(ticketId, {
      status: "for_review",
      prs,
    });
    return;
  }
}
