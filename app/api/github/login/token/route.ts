import { NextRequest } from "next/server";
import { loginWithToken } from "@/lib/gh-cli";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { token?: string };
  const token = (body.token ?? "").trim();
  if (!token) {
    return Response.json({ error: "token required" }, { status: 400 });
  }
  try {
    await loginWithToken(token);
    return Response.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
