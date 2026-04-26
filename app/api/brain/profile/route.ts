import { NextResponse } from "next/server";
import {
  BrainProfileSchema,
  clearProfile,
  loadProfile,
  mergeProfile,
} from "@/lib/user-brain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const profile = await loadProfile();
  return NextResponse.json({ profile });
}

export async function PATCH(req: Request) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  // Allow partial — ignore unknown keys but validate the shape of the
  // dimensions provided.
  const partial = BrainProfileSchema.partial().safeParse(raw);
  if (!partial.success) {
    return NextResponse.json(
      { error: partial.error.issues.map((i) => i.message).join("; ") },
      { status: 400 },
    );
  }
  const profile = await mergeProfile(partial.data);
  return NextResponse.json({ profile });
}

export async function DELETE() {
  const profile = await clearProfile();
  return NextResponse.json({ profile });
}
