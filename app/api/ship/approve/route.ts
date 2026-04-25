import { NextRequest } from "next/server";
import { z } from "zod";
import { Octokit } from "@octokit/rest";
import { getTicket, updateTicket } from "@/lib/ticket-store";
import { getRepo } from "@/lib/mesh-state";
import { getRemoteOwnerRepo } from "@/lib/github";
import { ghToken } from "@/lib/gh-cli";
import { stopAllForTicket } from "@/lib/preview-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  ticket_id: z.string().min(1),
});

type ApproveResult = {
  repo: string;
  url: string;
  number?: number;
  simulated: boolean;
  marked_ready: boolean;
  reason?: string;
};

// "Approve" no longer creates PRs. PRs are opened as drafts the moment a
// ticket enters for_review (via /api/ship). Approve is the explicit human
// gate that flips the draft PR to "ready for review" once the user has
// finished validating diff + checks + preview locally. Simulated PRs (no
// remote / no token) just record the local approval flag.
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
  if (ticket.prs.length === 0) {
    return Response.json(
      {
        error:
          "ticket has no PRs to approve — run Generate first to stage commits and open the draft PR.",
      },
      { status: 409 },
    );
  }

  // Free preview servers before flipping PRs ready — the dev process holds
  // a working tree and we don't want it racing with anything that touches
  // the branch.
  await stopAllForTicket(ticketId).catch(() => null);

  const token = process.env.GITHUB_TOKEN || (await ghToken());
  const octokit = token ? new Octokit({ auth: token }) : null;

  const results: ApproveResult[] = [];
  for (const pr of ticket.prs) {
    if (pr.simulated) {
      results.push({
        repo: pr.repo,
        url: pr.url,
        number: pr.number,
        simulated: true,
        marked_ready: true,
      });
      continue;
    }
    if (!octokit) {
      results.push({
        repo: pr.repo,
        url: pr.url,
        number: pr.number,
        simulated: false,
        marked_ready: false,
        reason: "no GitHub token (gh auth login or set GITHUB_TOKEN)",
      });
      continue;
    }
    const repo = await getRepo(pr.repo);
    const remote = repo ? await getRemoteOwnerRepo(repo.localPath) : null;
    if (!remote || pr.number === undefined) {
      results.push({
        repo: pr.repo,
        url: pr.url,
        number: pr.number,
        simulated: false,
        marked_ready: false,
        reason: "missing remote or PR number",
      });
      continue;
    }
    try {
      // GitHub's REST API marks a draft as ready by mutating the GraphQL
      // node, but PATCH /pulls supports `draft: false` since 2019 on most
      // accounts. Octokit hides this through pulls.update.
      await octokit.pulls.update({
        owner: remote.owner,
        repo: remote.repo,
        pull_number: pr.number,
        draft: false,
      });
      results.push({
        repo: pr.repo,
        url: pr.url,
        number: pr.number,
        simulated: false,
        marked_ready: true,
      });
    } catch (err) {
      results.push({
        repo: pr.repo,
        url: pr.url,
        number: pr.number,
        simulated: false,
        marked_ready: false,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Snapshot the approval on the ticket so the kanban can render a
  // "ready for review" pill instead of "draft".
  await updateTicket(ticketId, {
    labels: dedupe([...ticket.labels, "approved"]),
  });

  return Response.json({ ok: true, results });
}

function dedupe(arr: string[]): string[] {
  return Array.from(new Set(arr));
}
