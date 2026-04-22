import { listRepos } from "@/lib/mesh-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const repos = await listRepos();
  return Response.json({ repos });
}
