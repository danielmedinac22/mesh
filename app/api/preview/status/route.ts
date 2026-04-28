import { NextRequest } from "next/server";
import { getSession } from "@/lib/preview-server";
import { getReposForProject } from "@/lib/mesh-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function viewSession(s: ReturnType<typeof getSession>) {
  if (!s) return null;
  return {
    status: s.status,
    port: s.port,
    url: s.url,
    pid: s.pid,
    script: s.script,
    startedAt: s.startedAt,
    logTail: s.logTail.slice(-50),
  };
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const projectId = url.searchParams.get("project");

  // Project-aggregate view: returns one entry per repo in the project,
  // with `session: null` for repos that haven't been started.
  if (projectId) {
    const repos = await getReposForProject(projectId);
    return Response.json({
      sessions: repos.map((r) => ({
        repo: r.name,
        session: viewSession(getSession(`run-${r.name}`, r.name)),
      })),
    });
  }

  // Single-repo view (existing behavior).
  const repo = url.searchParams.get("repo");
  if (!repo) {
    return Response.json(
      { error: "repo or project is required" },
      { status: 400 },
    );
  }
  const ticketId = url.searchParams.get("ticket_id") ?? `run-${repo}`;
  const session = getSession(ticketId, repo);
  return Response.json({ session: viewSession(session) });
}
