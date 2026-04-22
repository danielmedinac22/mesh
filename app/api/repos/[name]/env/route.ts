import { NextRequest } from "next/server";
import {
  getRepoEnv,
  setRepoEnv,
  RepoEnvSchema,
  safeRepoName,
} from "@/lib/mesh-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: { name: string } };

export async function GET(_req: NextRequest, { params }: Ctx) {
  if (!safeRepoName(params.name)) {
    return Response.json({ error: "invalid repo name" }, { status: 400 });
  }
  const env = await getRepoEnv(params.name);
  return Response.json({ env });
}

export async function PUT(req: NextRequest, { params }: Ctx) {
  if (!safeRepoName(params.name)) {
    return Response.json({ error: "invalid repo name" }, { status: 400 });
  }
  const body = await req.json().catch(() => ({}));
  const parsed = RepoEnvSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "env must be string->string map", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const env = await setRepoEnv(params.name, parsed.data);
  return Response.json({ env });
}
