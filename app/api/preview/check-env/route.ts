import { NextRequest } from "next/server";
import { z } from "zod";
import { getRepo, getRepoEnv } from "@/lib/mesh-state";
import {
  classifyMissing,
  detectRequiredEnvVars,
  type EnvDetectSource,
} from "@/lib/env-detect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  repo: z.string().min(1),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(body ?? {});
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
    const detect = await detectRequiredEnvVars(repo.localPath);
    const env = await getRepoEnv(repo.name).catch(() => ({}));
    const merged: Record<string, string | undefined> = {
      ...process.env,
      ...env,
    };
    const { hardMissing, softMissing } = classifyMissing(
      detect.required,
      merged,
    );
    const ok = hardMissing.length === 0;
    return Response.json({
      ok,
      missing: hardMissing,
      optionalMissing: softMissing,
      required: detect.required,
      source: detect.source satisfies EnvDetectSource,
      exampleFile: detect.exampleFile ?? null,
      scannedFiles: detect.scannedFiles ?? null,
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
