import { NextResponse } from "next/server";
import { inspectGranolaInstall, resolveAccessToken } from "@/lib/granola-token";
import { setMcpStatus } from "@/lib/integrations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  // resolveAccessToken triggers a refresh if expired.
  const token = await resolveAccessToken();
  if (token) {
    await setMcpStatus("granola", { status: "linked", email: token.email });
    return NextResponse.json({
      status: "linked",
      email: token.email,
      expiresAt: token.expiresAt,
    });
  }

  // Couldn't resolve — surface the diagnostic.
  const info = await inspectGranolaInstall();
  await setMcpStatus("granola", { status: info.status, email: info.email });

  if (info.status === "not_installed") {
    return NextResponse.json(
      {
        status: "not_installed",
        error:
          "Granola desktop not detected. Install Granola from granola.ai and sign in, then retry.",
      },
      { status: 412 },
    );
  }
  return NextResponse.json(
    {
      status: "needs_login",
      error:
        "Granola session expired. Open Granola desktop and sign in, then retry.",
    },
    { status: 401 },
  );
}
