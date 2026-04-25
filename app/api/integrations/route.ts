import { NextResponse } from "next/server";
import { listIntegrations, INTEGRATION_META } from "@/lib/integrations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const states = await listIntegrations();
  const items = states.map((s) => ({
    ...s,
    meta: INTEGRATION_META[s.kind],
  }));
  return NextResponse.json({ integrations: items });
}
