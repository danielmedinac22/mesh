import { NextRequest } from "next/server";
import { z } from "zod";
import { getRepo } from "@/lib/mesh-state";
import { detectRunPlan } from "@/lib/repo-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const QuerySchema = z.object({
  repo: z.string().min(1),
});

export async function GET(req: NextRequest) {
  const parsed = QuerySchema.safeParse({
    repo: req.nextUrl.searchParams.get("repo") ?? "",
  });
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues.map((i) => i.message).join(", ") },
      { status: 400 },
    );
  }
  const repo = await getRepo(parsed.data.repo);
  if (!repo) {
    return Response.json(
      { error: `repo ${parsed.data.repo} not registered` },
      { status: 404 },
    );
  }
  try {
    const plan = await detectRunPlan(repo.localPath);
    return Response.json({ repo: repo.name, plan });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
