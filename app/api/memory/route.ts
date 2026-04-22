import { loadMemory } from "@/lib/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const memory = await loadMemory();
  if (!memory) {
    return Response.json({ memory: null }, { status: 200 });
  }
  return Response.json({ memory });
}
