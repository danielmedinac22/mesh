import { NextRequest } from "next/server";
import { loadConfig, saveConfig, ConfigSchema, detectClaudeCode } from "@/lib/mesh-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const [config, claudeCodeDetected] = await Promise.all([
    loadConfig(),
    detectClaudeCode(),
  ]);
  return Response.json({ config, claudeCodeDetected });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const parsed = ConfigSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid config", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  await saveConfig(parsed.data);
  return Response.json({ config: parsed.data });
}
