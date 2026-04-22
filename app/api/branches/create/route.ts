import { NextRequest } from "next/server";
import { z } from "zod";
import { listRepos } from "@/lib/mesh-state";
import { createBranch, getStatus } from "@/lib/github";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  branch: z.string().min(1).max(120),
  repos: z.array(z.string()).optional(),
  fromBranch: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const json = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues.map((i) => i.message).join(", ") },
      { status: 400 },
    );
  }
  const { branch, repos: names, fromBranch } = parsed.data;

  const all = await listRepos();
  const targets = (names && names.length > 0
    ? all.filter((r) => names.includes(r.name))
    : all.filter((r) => r.name !== "mesh"));

  if (targets.length === 0) {
    return Response.json({ error: "no target repos" }, { status: 400 });
  }

  const results: { repo: string; ok: boolean; error?: string }[] = [];
  for (const repo of targets) {
    try {
      await createBranch(repo.localPath, branch, fromBranch);
      results.push({ repo: repo.name, ok: true });
    } catch (err) {
      results.push({
        repo: repo.name,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const statuses = await Promise.all(
    targets.map((r) => getStatus(r.localPath, r.name)),
  );

  return Response.json({ branch, results, repos: statuses });
}
