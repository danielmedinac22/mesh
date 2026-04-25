import { z } from "zod";

// ============================================================================
// Plan schema v2 — Spec-Driven + Test-Driven structure
// ============================================================================
//
// A v2 plan answers three questions, in order:
//   1) Spec  — what are we building, in plain language?
//   2) Tests — how will we know it works? (written FIRST, expected to fail)
//   3) Implementation — what code makes the tests pass?
//
// Every step lives on a single target branch (set by the user on Connect).
// Each acceptance criterion (AC) is verified by ≥1 test. Each test is made
// green by ≥1 impl step. The traceability table makes those links explicit
// so Ship can execute tests-before-impl and the UI can show AC → T → I.

// ---- Base step shape, shared by tests and implementation ----

export const PlanStepBaseSchema = z.object({
  step: z.number().int().positive(),
  repo: z.string(),
  file: z.string(),
  action: z.enum(["edit", "create"]),
  rationale: z.string(),
  invariants_respected: z.array(z.string()).default([]),
  memory_citations: z.array(z.string()).default([]),
  target_branch: z.string(),
});
export type PlanStepBase = z.infer<typeof PlanStepBaseSchema>;

// ---- Spec (Product agent owns this) ----

export const AcceptanceCriterionSchema = z.object({
  id: z.string().regex(/^AC-\d+$/),
  given: z.string(),
  when: z.string(),
  then: z.string(),
});
export type AcceptanceCriterion = z.infer<typeof AcceptanceCriterionSchema>;

export const ContractSchema = z.object({
  id: z.string().regex(/^C-\d+$/),
  kind: z.enum(["http", "function", "data", "event"]),
  description: z.string(),
  shape: z.string().optional(),
});
export type Contract = z.infer<typeof ContractSchema>;

export const SpecSchema = z.object({
  summary: z.string(),
  user_stories: z.array(z.string()).default([]),
  acceptance_criteria: z.array(AcceptanceCriterionSchema).default([]),
  contracts: z.array(ContractSchema).default([]),
  non_goals: z.array(z.string()).default([]),
  invariants_respected: z.array(z.string()).default([]),
});
export type Spec = z.infer<typeof SpecSchema>;

// ---- Tests (QA agent owns this) ----

export const TestStepSchema = PlanStepBaseSchema.extend({
  test_id: z.string().regex(/^T-\d+$/),
  ac_ids: z.array(z.string().regex(/^AC-\d+$/)).default([]),
  test_kind: z.enum(["unit", "integration", "e2e", "contract", "manual"]),
  agent: z.literal("qa"),
  expected_initial_state: z.enum(["fails", "n/a-doc-or-config"]),
});
export type TestStep = z.infer<typeof TestStepSchema>;

// ---- Implementation (Frontend / Backend / Product own this) ----

export const ImplStepSchema = PlanStepBaseSchema.extend({
  impl_id: z.string().regex(/^I-\d+$/),
  test_ids: z.array(z.string().regex(/^T-\d+$/)).default([]),
  agent: z.enum(["frontend", "backend", "product"]),
});
export type ImplStep = z.infer<typeof ImplStepSchema>;

// ---- Traceability ----

export const TraceabilitySchema = z.object({
  ac_to_tests: z.record(z.array(z.string())).default({}),
  test_to_impl: z.record(z.array(z.string())).default({}),
});
export type Traceability = z.infer<typeof TraceabilitySchema>;

// ---- Top-level v2 plan ----

export const PlanV2Schema = z.object({
  schema_version: z.literal("2"),
  spec: SpecSchema,
  tests: z.array(TestStepSchema).default([]),
  implementation: z.array(ImplStepSchema).default([]),
  sequencing: z.array(z.string()).default([]),
  blast_radius: z.string().default(""),
  traceability: TraceabilitySchema,
});
export type PlanV2 = z.infer<typeof PlanV2Schema>;

// ---- Legacy v1 plan (read-only — kept so old saved plans load) ----

export const PlanV1StepSchema = z.object({
  step: z.number().int().positive(),
  repo: z.string(),
  file: z.string(),
  action: z.enum(["edit", "create"]),
  rationale: z.string(),
  invariants_respected: z.array(z.string()).default([]),
  memory_citations: z.array(z.string()).default([]),
  target_branch: z.string(),
});

export const PlanV1Schema = z.object({
  schema_version: z.literal("1").optional(),
  plan: z.array(PlanV1StepSchema).min(1),
  sequencing: z.array(z.string()).default([]),
  blast_radius: z.string().default(""),
});
export type PlanV1 = z.infer<typeof PlanV1Schema>;

// ---- Union: any saved plan is v2 (preferred) or v1 (legacy read) ----

export const PlanSchema = z.union([PlanV2Schema, PlanV1Schema]);
export type PlanPayload = z.infer<typeof PlanSchema>;

export function isPlanV2(p: PlanPayload): p is PlanV2 {
  return (p as { schema_version?: string }).schema_version === "2";
}

// Flatten a v2 plan into a single ordered execution list (tests first, then
// implementation). Each entry has a `kind` discriminator so callers can branch
// on test vs impl. The `step` numbers are renumbered globally so Ship can keep
// using its existing 1..N progress UI.
export type UnifiedStep =
  | ({ kind: "test" } & TestStep)
  | ({ kind: "impl" } & ImplStep);

export function flattenPlanV2(plan: PlanV2): UnifiedStep[] {
  const tests = plan.tests.map((t) => ({ kind: "test" as const, ...t }));
  const impls = plan.implementation.map((i) => ({ kind: "impl" as const, ...i }));
  const all = [...tests, ...impls];
  return all.map((s, idx) => ({ ...s, step: idx + 1 }));
}

// Convenience for UI code: pulls a unified step list from any saved plan.
// Legacy v1 plans return an empty list — the UI should fall back to its
// "legacy plan" banner instead of trying to render steps.
export function getPlanSteps(plan: PlanPayload): UnifiedStep[] {
  return isPlanV2(plan) ? flattenPlanV2(plan) : [];
}

// ---- JSON parsers (both shapes) ----

export function parsePlanJson(raw: string): PlanPayload {
  const stripped = stripFences(raw.trim());
  const body = extractJsonObject(stripped);
  return PlanSchema.parse(JSON.parse(body));
}

export function parsePlanV2Json(raw: string): PlanV2 {
  const stripped = stripFences(raw.trim());
  const body = extractJsonObject(stripped);
  return PlanV2Schema.parse(JSON.parse(body));
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

// Validate cross-references in a v2 plan. Returns a list of human-readable
// problems; empty list means the plan is internally consistent. Used by the
// synthesizer (which retries on failure) and by the UI (which surfaces gaps
// in red).
export function validateTraceability(plan: PlanV2): string[] {
  const problems: string[] = [];
  const acIds = new Set(plan.spec.acceptance_criteria.map((a) => a.id));
  const testIds = new Set(plan.tests.map((t) => t.test_id));

  for (const ac of plan.spec.acceptance_criteria) {
    const tests = plan.traceability.ac_to_tests[ac.id] ?? [];
    if (tests.length === 0) {
      problems.push(`${ac.id} has no tests in traceability.ac_to_tests`);
    }
    for (const tid of tests) {
      if (!testIds.has(tid))
        problems.push(`${ac.id} references unknown test ${tid}`);
    }
  }

  for (const t of plan.tests) {
    if (t.ac_ids.length === 0) {
      problems.push(`${t.test_id} has no ac_ids`);
    }
    for (const ac of t.ac_ids) {
      if (!acIds.has(ac))
        problems.push(`${t.test_id} references unknown ${ac}`);
    }
    const impls = plan.traceability.test_to_impl[t.test_id] ?? [];
    if (impls.length === 0 && t.test_kind !== "manual") {
      problems.push(
        `${t.test_id} has no implementation steps in traceability.test_to_impl`,
      );
    }
  }

  const implIds = new Set(plan.implementation.map((i) => i.impl_id));
  for (const i of plan.implementation) {
    for (const tid of i.test_ids) {
      if (!testIds.has(tid))
        problems.push(`${i.impl_id} references unknown test ${tid}`);
    }
  }
  for (const [tid, list] of Object.entries(plan.traceability.test_to_impl)) {
    for (const iid of list) {
      if (!implIds.has(iid))
        problems.push(`traceability test_to_impl[${tid}] has unknown ${iid}`);
    }
  }

  return problems;
}
