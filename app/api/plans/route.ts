import { NextRequest } from "next/server";
import { z } from "zod";
import { PlanV2Schema } from "@/lib/prompts/plan";
import { listPlans, savePlan } from "@/lib/plan-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST accepts only v2 plans. Legacy v1 plans cannot be created via this
// endpoint — they are read-only artifacts from previous demos.
const BodySchema = z.object({
  ticket: z.string().min(1),
  classification: z.object({
    type: z.string(),
    repos_touched: z.array(z.string()),
    target_branch: z.string(),
    confidence: z.number(),
    summary: z.string(),
    reasoning: z.string(),
  }),
  plan: PlanV2Schema,
});

export async function GET() {
  return Response.json({ plans: await listPlans() });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues.map((i) => i.message).join(", ") },
      { status: 400 },
    );
  }
  const saved = await savePlan(parsed.data);
  return Response.json({ plan: saved });
}
