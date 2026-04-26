import { NextRequest } from "next/server";
import { listRepos } from "@/lib/mesh-state";
import { getStatus } from "@/lib/github";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest) {
  const repos = await listRepos();
  // Exclude mesh itself from the workspace view.
  const workspace = repos.filter((r) => r.name !== "mesh");
  const statuses = await Promise.all(
    workspace.map((r) => getStatus(r.localPath, r.name)),
  );
  return Response.json({ repos: statuses });
}
