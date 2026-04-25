import { NextRequest } from "next/server";
import { getRepo } from "@/lib/mesh-state";
import { getTicket } from "@/lib/ticket-store";
import { getPlan } from "@/lib/plan-store";
import { repoDiffAgainstBase } from "@/lib/git-diff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const ticketId = url.searchParams.get("ticket_id");
  const repoName = url.searchParams.get("repo");
  if (!ticketId || !repoName) {
    return Response.json(
      { error: "ticket_id and repo are required" },
      { status: 400 },
    );
  }

  const ticket = await getTicket(ticketId);
  if (!ticket) {
    return Response.json({ error: `ticket ${ticketId} not found` }, { status: 404 });
  }
  const planId = ticket.plan_id;
  if (!planId) {
    return Response.json(
      { error: `ticket ${ticketId} has no plan attached` },
      { status: 409 },
    );
  }
  const plan = await getPlan(planId);
  if (!plan) {
    return Response.json({ error: `plan ${planId} not found` }, { status: 404 });
  }
  const repo = await getRepo(repoName);
  if (!repo) {
    return Response.json({ error: `repo ${repoName} not registered` }, { status: 404 });
  }
  const base = repo.defaultBranch || "main";

  try {
    const diff = await repoDiffAgainstBase(repo.localPath, base);
    return Response.json({
      ...diff,
      repo: repoName,
      base,
      branch: plan.classification.target_branch,
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
