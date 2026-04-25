import { NextRequest } from "next/server";
import { z } from "zod";
import { Octokit } from "@octokit/rest";
import { getTicket, updateTicket } from "@/lib/ticket-store";
import { getPlan } from "@/lib/plan-store";
import { getRepo } from "@/lib/mesh-state";
import { getRemoteOwnerRepo } from "@/lib/github";
import { ghToken } from "@/lib/gh-cli";
import {
  getLatestSessionFor,
  writeSession,
  type ShipSession,
} from "@/lib/ship-session";
import { stopAllForTicket } from "@/lib/preview-server";
import { discardBranch } from "@/lib/git-diff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  ticket_id: z.string().min(1),
});

// Discard reverses everything Generate did:
//   - kill any preview servers tied to the ticket
//   - close every open PR via Octokit (best-effort; simulated ones just
//     get cleared from the ticket record)
//   - delete the local feature branch (`git branch -D`)
//   - reset the ticket back to `drafted` so the user can adjust the plan
//     and try again
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(body ?? {});
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues.map((i) => i.message).join(", ") },
      { status: 400 },
    );
  }
  const { ticket_id: ticketId } = parsed.data;

  const ticket = await getTicket(ticketId);
  if (!ticket) {
    return Response.json({ error: `ticket ${ticketId} not found` }, { status: 404 });
  }
  const plan = ticket.plan_id ? await getPlan(ticket.plan_id) : null;
  const session = ticket.plan_id
    ? await getLatestSessionFor({
        plan_id: ticket.plan_id,
        ticket_id: ticketId,
      })
    : null;

  await stopAllForTicket(ticketId).catch(() => null);

  const token = process.env.GITHUB_TOKEN || (await ghToken());
  const octokit = token ? new Octokit({ auth: token }) : null;

  const errors: { repo: string; message: string }[] = [];

  for (const pr of ticket.prs) {
    if (pr.simulated || !pr.number) continue;
    if (!octokit) {
      errors.push({ repo: pr.repo, message: "no GitHub token to close PR" });
      continue;
    }
    const repo = await getRepo(pr.repo);
    const remote = repo ? await getRemoteOwnerRepo(repo.localPath) : null;
    if (!remote) continue;
    try {
      await octokit.pulls.update({
        owner: remote.owner,
        repo: remote.repo,
        pull_number: pr.number,
        state: "closed",
      });
    } catch (err) {
      errors.push({
        repo: pr.repo,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const reposWithCommits = session
    ? Array.from(new Set(session.steps.filter((s) => s.commit_sha).map((s) => s.repo)))
    : plan?.classification.repos_touched ?? [];
  const branch = plan?.classification.target_branch ?? "";

  for (const repoName of reposWithCommits) {
    if (!branch) break;
    const repo = await getRepo(repoName);
    if (!repo) continue;
    try {
      await discardBranch(repo.localPath, branch, repo.defaultBranch || "main");
    } catch (err) {
      errors.push({
        repo: repoName,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (session) {
    const updated: ShipSession = {
      ...session,
      status: "failed",
      finished_at: new Date().toISOString(),
      error: "discarded by user",
    };
    await writeSession(updated);
  }

  await updateTicket(ticketId, {
    status: "drafted",
    ship_session: undefined,
    prs: [],
  });

  return Response.json({ ok: true, errors });
}
