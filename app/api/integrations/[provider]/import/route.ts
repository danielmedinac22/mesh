import { NextResponse } from "next/server";
import { z } from "zod";
import {
  IntegrationKindSchema,
  INTEGRATION_META,
  recordImport,
} from "@/lib/integrations";
import { appendBrainEntry, BrainEntryKindSchema } from "@/lib/user-brain";

export const runtime = "nodejs";

const ImportBodySchema = z.object({
  kind: BrainEntryKindSchema.optional(),
  body: z.string().min(1),
  title: z.string().optional(),
  ref: z.string().optional(),
  url: z.string().optional(),
  tags: z.array(z.string()).default([]),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;
  const kindParse = IntegrationKindSchema.safeParse(provider);
  if (!kindParse.success) {
    return NextResponse.json({ error: "unknown provider" }, { status: 404 });
  }
  const integrationKind = kindParse.data;
  if (integrationKind === "github") {
    return NextResponse.json(
      { error: "github does not support paste import — use Connect instead" },
      { status: 400 },
    );
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const parsed = ImportBodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 },
    );
  }

  const meta = INTEGRATION_META[integrationKind];
  const trimmed = parsed.data.body.trim();
  const inferredTitle =
    parsed.data.title?.trim() || trimmed.split("\n")[0]?.slice(0, 120) || undefined;

  const entry = await appendBrainEntry({
    kind: parsed.data.kind ?? meta.defaultEntryKind,
    body: trimmed,
    title: inferredTitle,
    source: integrationKind,
    ref: parsed.data.ref,
    url: parsed.data.url,
    tags: parsed.data.tags,
  });
  const state = await recordImport(integrationKind);

  return NextResponse.json({ entry, state });
}
