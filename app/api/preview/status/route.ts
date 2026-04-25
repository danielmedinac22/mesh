import { NextRequest } from "next/server";
import { getSession } from "@/lib/preview-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const ticketId = url.searchParams.get("ticket_id");
  const repo = url.searchParams.get("repo");
  if (!ticketId || !repo) {
    return Response.json(
      { error: "ticket_id and repo are required" },
      { status: 400 },
    );
  }
  const session = getSession(ticketId, repo);
  if (!session) return Response.json({ session: null });
  return Response.json({
    session: {
      status: session.status,
      port: session.port,
      url: session.url,
      pid: session.pid,
      script: session.script,
      startedAt: session.startedAt,
      logTail: session.logTail.slice(-50),
    },
  });
}
