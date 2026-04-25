import { NextRequest } from "next/server";
import { listReadyForShip } from "@/lib/ticket-store";
import { getCurrentProjectId } from "@/lib/mesh-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const projectIdParam = url.searchParams.get("project_id");
  const projectId =
    projectIdParam ?? (await getCurrentProjectId()) ?? null;
  const tickets = await listReadyForShip({ projectId });
  return Response.json({ tickets });
}
