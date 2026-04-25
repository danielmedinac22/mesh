import { NextResponse } from "next/server";
import { IntegrationKindSchema, disconnect } from "@/lib/integrations";

export const runtime = "nodejs";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;
  const kindParse = IntegrationKindSchema.safeParse(provider);
  if (!kindParse.success) {
    return NextResponse.json({ error: "unknown provider" }, { status: 404 });
  }
  if (kindParse.data === "github") {
    return NextResponse.json(
      { error: "github is managed via gh CLI — use the GitHub section to sign out" },
      { status: 400 },
    );
  }
  const state = await disconnect(kindParse.data);
  return NextResponse.json({ state });
}
