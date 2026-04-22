import { NextRequest } from "next/server";
import { z } from "zod";
import { PlanSchema } from "@/lib/prompts/plan";
import { listPlans, savePlan } from "@/lib/plan-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  plan: PlanSchema,
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
