import { NextResponse } from "next/server";
import { z } from "zod";
import {
  appendBrainEntry,
  BrainEntryKindSchema,
  loadBrain,
  removeBrainEntry,
} from "@/lib/user-brain";

export async function GET() {
  const brain = await loadBrain();
  return NextResponse.json(brain);
}

const PostBodySchema = z.object({
  kind: BrainEntryKindSchema,
  body: z.string().default(""),
  title: z.string().optional(),
  source: z.string().optional(),
  ref: z.string().optional(),
  url: z.string().optional(),
  tags: z.array(z.string()).default([]),
});

export async function POST(req: Request) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const parsed = PostBodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 },
    );
  }
  const entry = await appendBrainEntry(parsed.data);
  return NextResponse.json({ entry });
}

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }
  const brain = await removeBrainEntry(id);
  return NextResponse.json(brain);
}
