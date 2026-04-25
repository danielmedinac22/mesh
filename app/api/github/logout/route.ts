import { ghLogout } from "@/lib/gh-cli";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    await ghLogout();
    return Response.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
