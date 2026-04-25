import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  PlanSchema,
  isPlanV2,
  type PlanPayload,
  type PlanV2,
} from "@/lib/prompts/plan";
import { AgentOutputSchema } from "@/lib/prompts/multi-agent";

const PLANS_DIR = path.join(process.cwd(), ".mesh", "plans");

export const SavedPlanSchema = z.object({
  id: z.string(),
  projectId: z.string().optional(),
  created_at: z.string(),
  ticket: z.string(),
  classification: z.object({
    type: z.string(),
    repos_touched: z.array(z.string()),
    target_branch: z.string(),
    confidence: z.number(),
    summary: z.string(),
    reasoning: z.string(),
  }),
  // Tolerant of both v2 (current) and v1 (legacy) shapes. The pipeline always
  // writes v2; v1 is only ever read back from disk for older saved plans.
  plan: PlanSchema,
  ticket_id: z.string().optional(),
  base_plan_id: z.string().optional(),
  agent_outputs: z.array(AgentOutputSchema).optional(),
  blast_radius: z.string().optional(),
});
export type SavedPlan = z.infer<typeof SavedPlanSchema>;

async function ensure(): Promise<void> {
  await fs.mkdir(PLANS_DIR, { recursive: true });
}

export async function savePlan(input: {
  ticket: string;
  classification: SavedPlan["classification"];
  plan: PlanV2;
  ticket_id?: string;
  base_plan_id?: string;
  agent_outputs?: SavedPlan["agent_outputs"];
  projectId?: string;
}): Promise<SavedPlan> {
  await ensure();
  const id = `${Date.now()}-${slug(input.classification.target_branch)}`;
  const saved: SavedPlan = {
    id,
    projectId: input.projectId,
    created_at: new Date().toISOString(),
    ticket: input.ticket,
    classification: input.classification,
    plan: input.plan,
    ticket_id: input.ticket_id,
    base_plan_id: input.base_plan_id,
    agent_outputs: input.agent_outputs,
    blast_radius: input.plan.blast_radius || undefined,
  };
  SavedPlanSchema.parse(saved);
  await fs.writeFile(
    path.join(PLANS_DIR, `${id}.json`),
    JSON.stringify(saved, null, 2) + "\n",
    "utf8",
  );
  return saved;
}

export async function listPlans(): Promise<SavedPlan[]> {
  try {
    const entries = await fs.readdir(PLANS_DIR);
    const out: SavedPlan[] = [];
    for (const e of entries) {
      if (!e.endsWith(".json")) continue;
      try {
        const raw = await fs.readFile(path.join(PLANS_DIR, e), "utf8");
        out.push(SavedPlanSchema.parse(JSON.parse(raw)));
      } catch {
        // skip malformed
      }
    }
    out.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    return out;
  } catch {
    return [];
  }
}

export async function getPlan(id: string): Promise<SavedPlan | null> {
  try {
    const raw = await fs.readFile(path.join(PLANS_DIR, `${id}.json`), "utf8");
    return SavedPlanSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

// Convenience re-export so consumers don't have to import from prompts/plan.
export { isPlanV2 };
export type { PlanPayload, PlanV2 };

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}
