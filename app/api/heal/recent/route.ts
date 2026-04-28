import { NextRequest } from "next/server";
import { readHealLog, readProposalArtifact } from "@/lib/self-heal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const limit = Math.min(
    Math.max(parseInt(url.searchParams.get("limit") ?? "20", 10) || 20, 1),
    100,
  );
  const includeProposal = url.searchParams.get("proposal") === "1";

  const entries = await readHealLog(limit);
  if (!includeProposal) {
    return Response.json({ entries });
  }
  const enriched = await Promise.all(
    entries.map(async (e) => ({
      ...e,
      proposal:
        e.status === "proposal" ? await readProposalArtifact(e.errorId) : null,
    })),
  );
  return Response.json({ entries: enriched });
}
