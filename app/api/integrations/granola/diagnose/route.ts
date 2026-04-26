import { NextResponse } from "next/server";
import { diagnoseGranolaCache } from "@/lib/granola-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const info = await diagnoseGranolaCache();
  return NextResponse.json(info);
}
