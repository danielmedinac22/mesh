import { cancelDeviceFlow } from "@/lib/gh-cli";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  cancelDeviceFlow();
  return Response.json({ ok: true });
}
