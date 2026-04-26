import { NextResponse } from "next/server";
import { auth, UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import {
  GRANOLA_MCP_SERVER_URL,
  GranolaOAuthProvider,
  clearPendingAuth,
  redirectUrlFromRequest,
  readPendingAuth,
} from "@/lib/granola-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  await clearPendingAuth();
  const redirectUrl = redirectUrlFromRequest(req);
  const provider = new GranolaOAuthProvider(redirectUrl);

  try {
    const result = await auth(provider, { serverUrl: GRANOLA_MCP_SERVER_URL });
    if (result === "AUTHORIZED") {
      // Already have valid tokens — nothing to do.
      return NextResponse.json({ status: "linked" });
    }
  } catch (err) {
    if (!(err instanceof UnauthorizedError)) {
      const message = err instanceof Error ? err.message : String(err);
      return NextResponse.json(
        { status: "error", error: message },
        { status: 500 },
      );
    }
    // UnauthorizedError is expected — provider has captured the auth URL.
  }

  const pending = await readPendingAuth();
  if (!pending) {
    return NextResponse.json(
      {
        status: "error",
        error: "OAuth flow did not produce an authorization URL",
      },
      { status: 500 },
    );
  }
  return NextResponse.json({
    status: "redirect",
    authorizationUrl: pending.authorizationUrl,
  });
}
