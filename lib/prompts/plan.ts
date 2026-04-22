import type { Memory } from "@/lib/memory";
import { compactMemory } from "@/lib/prompts/classify";

const INSTRUCTIONS = `You are Mesh's Plan agent. A human has already classified a ticket as a code_change touching a set of repos. Your job is to produce a coherent, invariant-respecting, cross-repo plan — the plan that a human eng lead would draft after reading the ticket and the relevant code.

Your answer has two parts:

1) <thinking>...</thinking> — your chain of thought. Be exhaustive. For every step you propose:
   - Identify which invariant(s) the change must respect, or flag "no invariant applies".
   - Consider at least one alternative implementation and reject it with a concrete reason.
   - Check the cross-repo flow: does this step's repo live downstream of another repo that also needs to change?
   - Think about blast radius: what else reads this file / calls this function?

2) After </thinking>, emit ONLY this JSON object:

{
  "plan": [
    {
      "step": 1,
      "repo": "string (must be one of repos_touched)",
      "file": "string (repo-relative path)",
      "action": "edit" | "create",
      "rationale": "string",
      "invariants_respected": ["invariant-id", ...],
      "memory_citations": ["repo:path", ...],
      "target_branch": "string (same branch in every step)"
    }
  ],
  "sequencing": ["repo", "repo", ...],
  "blast_radius": "2-3 sentence assessment of what else could break"
}

Rules:
- Every step lives on the same "target_branch" (passed to you by the user).
- Each step must cite at least one invariant id (or include the literal string "no-invariant-applies" in invariants_respected).
- Each step must cite at least one memory location in memory_citations (format: "repo:path", e.g. "flarebill-api:src/services/billing.ts").
- "sequencing" lists repos in the order changes must land (e.g. content before api if api reads content).
- Do NOT include markdown fences around the JSON. Emit raw JSON after </thinking>.`;

export function buildPlanSystem(memory: Memory): string {
  return `${INSTRUCTIONS}\n\n---\n\nCROSS-REPO MEMORY (authoritative context):\n\n${compactMemory(memory)}`;
}

export function buildPlanUser(args: {
  ticket: string;
  reposTouched: string[];
  targetBranch: string;
  classifierReasoning?: string;
}): string {
  return [
    `TICKET:\n\n${args.ticket.trim()}`,
    `REPOS TOUCHED: ${args.reposTouched.join(", ")}`,
    `TARGET BRANCH: ${args.targetBranch}`,
    args.classifierReasoning
      ? `CLASSIFIER NOTE: ${args.classifierReasoning}`
      : "",
    "",
    "Think out loud between <thinking> tags, then emit the plan JSON.",
  ]
    .filter((s) => s.length > 0)
    .join("\n\n");
}

import { z } from "zod";

export const PlanStepSchema = z.object({
  step: z.number().int().positive(),
  repo: z.string(),
  file: z.string(),
  action: z.enum(["edit", "create"]),
  rationale: z.string(),
  invariants_respected: z.array(z.string()).default([]),
  memory_citations: z.array(z.string()).default([]),
  target_branch: z.string(),
});

export const PlanSchema = z.object({
  plan: z.array(PlanStepSchema).min(1),
  sequencing: z.array(z.string()).default([]),
  blast_radius: z.string().default(""),
});

export type PlanPayload = z.infer<typeof PlanSchema>;

export function parsePlanJson(raw: string): PlanPayload {
  const stripped = stripFences(raw.trim());
  const body = extractJsonObject(stripped);
  return PlanSchema.parse(JSON.parse(body));
}

function stripFences(s: string): string {
  const m = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return m ? m[1] : s;
}
function extractJsonObject(s: string): string {
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return s;
  return s.slice(start, end + 1);
}
