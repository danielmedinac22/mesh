import { NextResponse } from "next/server";
import { inspectGranolaInstall } from "@/lib/granola-token";
import { setMcpStatus } from "@/lib/integrations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const info = await inspectGranolaInstall();
  await setMcpStatus("granola", { status: info.status, email: info.email });
  return NextResponse.json({
    status: info.status,
    email: info.email,
    expiresAt: info.expiresAt,
  });
}
