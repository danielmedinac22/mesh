import { NextResponse } from "next/server";
import { auth } from "@modelcontextprotocol/sdk/client/auth.js";
import {
  GRANOLA_MCP_SERVER_URL,
  GranolaOAuthProvider,
  clearPendingAuth,
  redirectUrlFromRequest,
} from "@/lib/granola-oauth";
import { setMcpStatus } from "@/lib/integrations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function htmlResponse(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function settingsRedirect(req: Request, query: string): Response {
  const u = new URL(req.url);
  const target = `${u.protocol}//${u.host}/settings?${query}#integrations`;
  return NextResponse.redirect(target, { status: 302 });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const errorParam = url.searchParams.get("error");

  if (errorParam) {
    await clearPendingAuth();
    return settingsRedirect(
      req,
      `granola=error&message=${encodeURIComponent(errorParam)}`,
    );
  }
  if (!code) {
    return settingsRedirect(req, "granola=error&message=missing_code");
  }

  const redirectUrl = redirectUrlFromRequest(req);
  const provider = new GranolaOAuthProvider(redirectUrl);

  try {
    const result = await auth(provider, {
      serverUrl: GRANOLA_MCP_SERVER_URL,
      authorizationCode: code,
    });
    await clearPendingAuth();
    if (result !== "AUTHORIZED") {
      return settingsRedirect(req, "granola=error&message=not_authorized");
    }
    await setMcpStatus("granola", { status: "linked" });
    return settingsRedirect(req, "granola=ok");
  } catch (err) {
    await clearPendingAuth();
    const message =
      err instanceof Error ? err.message : String(err);
    // Render an inline error so the user sees what failed (instead of a
    // bare redirect with truncated reason).
    return htmlResponse(
      `<!doctype html><html><head><title>Granola sign-in failed</title>
      <style>body{font-family:ui-monospace,monospace;background:#0B0B0C;color:#E6E6E6;padding:48px;line-height:1.6}
      a{color:#F5A524}</style></head><body>
      <h1>Granola sign-in failed</h1>
      <p>${escapeHtml(message)}</p>
      <p><a href="/settings#integrations">← back to settings</a></p>
      </body></html>`,
      500,
    );
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
