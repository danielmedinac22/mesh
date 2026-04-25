import { z } from "zod";
import type { Memory } from "@/lib/memory";
import type { Agent, AgentId } from "@/lib/agents";
import { renderAgentRoster } from "@/lib/agents";
import { compactMemory } from "@/lib/prompts/classify";
import {
  PlanV2Schema,
  validateTraceability,
  type PlanV2,
} from "@/lib/prompts/plan";

// ============================================================================
// MASTER DISPATCH
// ============================================================================
//
// SDD/TDD invariant: every code-change ticket needs at minimum a spec (product)
// and tests (qa). Pure-frontend or pure-backend tickets still go through both.
// The dispatch agent picks engineering specialists, but product+qa are forced.

const DISPATCH_INSTRUCTIONS = `You are Mesh's master agent. A human has classified a ticket as a code change. Your job is to decide WHICH specialist agents should work on this ticket and WHY.

You do NOT write the plan. You pick the right team.

Rules of the team:
- "product" is ALWAYS deployed. It owns the spec (acceptance criteria, contracts, non-goals).
- "qa" is ALWAYS deployed. It owns the test plan that verifies each acceptance criterion.
- "frontend" and "backend" are deployed selectively, based on which surfaces actually change.

Be aggressive about skipping the engineering specialists the ticket does not need. Examples:

- "change the pricing label in the checkout banner" → product + qa + frontend. Skip backend.
- "add refund flow for partial payments" → product + qa + backend. Add frontend only if UI changes.
- "should we charge per-seat or per-usage?" → product + qa only. No engineers yet.

After </thinking>, emit ONLY this JSON:

{
  "agents_to_deploy": ["product", "qa", "frontend", ...],
  "rationale": "1-3 sentences. Name at least one engineer you SKIPPED and why.",
  "instructions_per_agent": {
    "product": "specific instruction for the spec author tailored to this ticket",
    "qa": "...",
    "frontend": "..."
  }
}

Rules:
- agents_to_deploy MUST contain "product" and "qa".
- agents_to_deploy must only contain IDs from the roster.
- instructions_per_agent only includes agents you are deploying.
- Do NOT wrap the JSON in markdown fences.`;

export function buildMasterDispatchSystem(args: {
  memory: Memory;
  agents: Agent[];
}): string {
  return [
    DISPATCH_INSTRUCTIONS,
    "---",
    "AVAILABLE AGENTS:",
    renderAgentRoster(args.agents),
    "---",
    "CROSS-REPO MEMORY (authoritative context):",
    compactMemory(args.memory),
  ].join("\n\n");
}

export function buildMasterDispatchUser(args: {
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
    "Think through the dispatch between <thinking> tags, then emit the dispatch JSON.",
  ]
    .filter((s) => s.length > 0)
    .join("\n\n");
}

export const DispatchSchema = z
  .object({
    agents_to_deploy: z
      .array(z.enum(["frontend", "backend", "product", "qa"]))
      .min(1),
    rationale: z.string().min(1),
    instructions_per_agent: z.record(z.string()).default({}),
  })
  .superRefine((val, ctx) => {
    if (!val.agents_to_deploy.includes("product")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "product agent is mandatory under SDD/TDD pipeline",
      });
    }
    if (!val.agents_to_deploy.includes("qa")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "qa agent is mandatory under SDD/TDD pipeline",
      });
    }
  });
export type DispatchPayload = z.infer<typeof DispatchSchema>;

export function parseDispatchJson(raw: string): DispatchPayload {
  const stripped = stripFences(raw.trim());
  const body = extractJsonObject(stripped);
  const parsed = DispatchSchema.parse(JSON.parse(body));
  // Defensive: even if the model forgets, force product + qa.
  const set = new Set(parsed.agents_to_deploy);
  set.add("product");
  set.add("qa");
  return {
    ...parsed,
    agents_to_deploy: Array.from(set) as DispatchPayload["agents_to_deploy"],
  };
}

// ============================================================================
// SUB-AGENT CONTRACTS — discriminated by agent id
// ============================================================================
//
// Each agent owns a different lane of the SDD/TDD plan:
//   - product → spec contribution (user stories, acceptance criteria, contracts, non-goals)
//   - qa      → test contribution  (one test case per AC, with kind + initial state)
//   - frontend / backend → impl contribution (steps that turn each test green)
//
// All four still emit the shared envelope (perspective, risks, regression risks,
// edge_cases, verification_plan, scope_recommendation, metric_hooks). The new
// `contribution` field is what the synthesizer actually composes into PlanV2.

const SHARED_AGENT_INSTRUCTIONS = `After </thinking>, emit ONLY a JSON object. The envelope is shared by all agents:

{
  "agent": "<your-id>",
  "perspective": "2-3 sentences from your role's angle",
  "risks": ["..."],
  "open_questions": ["..."],
  "edge_cases": ["..."],
  "regression_risks": ["..."],
  "verification_plan": ["..."],
  "scope_recommendation": "concise in/out summary",
  "metric_hooks": ["..."],
  "contribution": { ... role-specific, see below ... }
}

Rules:
- Contribute only what YOUR role owns. Do not cross territory.
- Respect invariants from the skills context. Flag violations in risks; never propose a step that breaks one.
- Do NOT wrap the JSON in markdown fences.`;

const PRODUCT_CONTRIBUTION_INSTRUCTIONS = `YOUR CONTRIBUTION (product owns the SPEC):

"contribution": {
  "user_stories": ["As a <role>, I want <goal>, so that <outcome>", ...],
  "acceptance_criteria": [
    {
      "id": "AC-1",
      "given": "context / preconditions",
      "when": "the user / system action",
      "then": "the observable outcome"
    }
  ],
  "contracts": [
    {
      "id": "C-1",
      "kind": "http" | "function" | "data" | "event",
      "description": "1-2 sentence description",
      "shape": "optional typed sketch (TypeScript / OpenAPI fragment / SQL)"
    }
  ],
  "non_goals": ["explicitly out of scope for this ticket"]
}

- Number ACs starting at AC-1, no gaps.
- Each AC must be testable. If you cannot describe how to verify it, drop it.
- Surface non-goals — they are how scope discipline shows up in the plan.`;

const QA_CONTRIBUTION_INSTRUCTIONS = `YOUR CONTRIBUTION (qa owns the TEST PLAN):

"contribution": {
  "test_cases": [
    {
      "test_id": "T-1",
      "ac_ids": ["AC-1", "AC-2"],
      "test_kind": "unit" | "integration" | "e2e" | "contract" | "manual",
      "expected_initial_state": "fails" | "n/a-doc-or-config",
      "repo": "string (one of repos_touched)",
      "file": "string (repo-relative test file path)",
      "action": "edit" | "create",
      "rationale": "what this test asserts and which AC it pins down",
      "invariants_respected": ["invariant-id" | "no-invariant-applies"],
      "memory_citations": ["repo:path"]
    }
  ]
}

Rules:
- Read the product agent's acceptance criteria. Every AC must be covered by at least one test_case.
- Number tests T-1, T-2, ... no gaps.
- Default expected_initial_state is "fails" (TDD red). Use "n/a-doc-or-config" only when the change is purely declarative.
- Pick test_kind honestly: "unit" for pure logic, "integration" for service+db, "e2e" for full flow, "contract" for inter-service shape, "manual" only when no automated test is possible.
- Each test_case lives in the repo it verifies. Co-locate with the existing test suite of that repo.`;

const ENG_CONTRIBUTION_INSTRUCTIONS = `YOUR CONTRIBUTION (engineer owns IMPLEMENTATION steps that make the qa tests pass):

"contribution": {
  "impl_steps": [
    {
      "impl_id": "I-1",
      "test_ids": ["T-1"],
      "repo": "string (one of repos_touched)",
      "file": "string (repo-relative path)",
      "action": "edit" | "create",
      "rationale": "what this edit does and which tests it makes green",
      "invariants_respected": ["invariant-id" | "no-invariant-applies"],
      "memory_citations": ["repo:path"]
    }
  ]
}

Rules:
- Number impl steps I-1, I-2, ... no gaps.
- Read the qa agent's test_cases. Each impl_step must reference at least one test it makes green.
- Stay in your lane: frontend touches UI files, backend touches services / APIs / migrations. Do not propose impl steps outside your role.
- Cite at least one invariant per step (or the literal "no-invariant-applies").`;

const PRODUCT_IMPL_NOTE = `If a product-owned file (copy, config, feature flag) needs to change, you MAY also include impl_steps with agent="product". Otherwise leave impl_steps off.`;

function contributionInstructionsFor(agentId: AgentId): string {
  switch (agentId) {
    case "product":
      return [
        PRODUCT_CONTRIBUTION_INSTRUCTIONS,
        "",
        "OPTIONAL — product-owned files:",
        PRODUCT_IMPL_NOTE,
        "If you include impl_steps, use the same shape as the engineering contribution (see qa output for AC ids and test ids).",
      ].join("\n");
    case "qa":
      return QA_CONTRIBUTION_INSTRUCTIONS;
    case "frontend":
    case "backend":
      return ENG_CONTRIBUTION_INSTRUCTIONS;
    default:
      // Custom agents are not wired into the dispatch; build-pipeline filters
      // them out before this is reached. Throw to surface misuse loudly.
      throw new Error(`no contribution shape for agent: ${agentId}`);
  }
}

export function buildAgentSystem(args: {
  agent: Agent;
  memory: Memory;
  skillsContext: string;
  targetBranch: string;
}): string {
  const parts: string[] = [];
  parts.push(args.agent.body);
  parts.push("");
  parts.push("---");
  parts.push("");
  parts.push(SHARED_AGENT_INSTRUCTIONS);
  parts.push("");
  parts.push(contributionInstructionsFor(args.agent.id));
  parts.push("");
  parts.push(`TARGET BRANCH: ${args.targetBranch}`);
  parts.push("");
  if (args.skillsContext) {
    parts.push("---");
    parts.push("");
    parts.push(args.skillsContext);
    parts.push("");
  }
  parts.push("---");
  parts.push("");
  parts.push("CROSS-REPO MEMORY:");
  parts.push(compactMemory(args.memory));
  return parts.join("\n");
}

export function buildAgentUser(args: {
  ticket: string;
  reposTouched: string[];
  targetBranch: string;
  instructions?: string;
}): string {
  return [
    `TICKET:\n\n${args.ticket.trim()}`,
    `REPOS TOUCHED: ${args.reposTouched.join(", ")}`,
    `TARGET BRANCH: ${args.targetBranch}`,
    args.instructions
      ? `MASTER'S INSTRUCTION FOR YOU:\n${args.instructions}`
      : "",
    "",
    "Think between <thinking> tags, then emit your JSON output.",
  ]
    .filter((s) => s.length > 0)
    .join("\n\n");
}

// ---- Per-role contribution shapes (parsed from the agent's JSON envelope) ----

const ProductContributionSchema = z
  .object({
    user_stories: z.array(z.string()).default([]),
    acceptance_criteria: z
      .array(
        z.object({
          id: z.string(),
          given: z.string(),
          when: z.string(),
          then: z.string(),
        }),
      )
      .default([]),
    contracts: z
      .array(
        z.object({
          id: z.string(),
          kind: z.enum(["http", "function", "data", "event"]),
          description: z.string(),
          shape: z.string().optional(),
        }),
      )
      .default([]),
    non_goals: z.array(z.string()).default([]),
    impl_steps: z.array(z.unknown()).optional(),
  })
  .partial();

const QaContributionSchema = z
  .object({
    test_cases: z
      .array(
        z.object({
          test_id: z.string(),
          ac_ids: z.array(z.string()).default([]),
          test_kind: z.enum(["unit", "integration", "e2e", "contract", "manual"]),
          expected_initial_state: z
            .enum(["fails", "n/a-doc-or-config"])
            .default("fails"),
          repo: z.string(),
          file: z.string(),
          action: z.enum(["edit", "create"]),
          rationale: z.string().default(""),
          invariants_respected: z.array(z.string()).default([]),
          memory_citations: z.array(z.string()).default([]),
        }),
      )
      .default([]),
  })
  .partial();

const EngContributionSchema = z
  .object({
    impl_steps: z
      .array(
        z.object({
          impl_id: z.string(),
          test_ids: z.array(z.string()).default([]),
          repo: z.string(),
          file: z.string(),
          action: z.enum(["edit", "create"]),
          rationale: z.string().default(""),
          invariants_respected: z.array(z.string()).default([]),
          memory_citations: z.array(z.string()).default([]),
        }),
      )
      .default([]),
  })
  .partial();

export const AgentOutputSchema = z
  .object({
    agent: z.string(),
    perspective: z.string().default(""),
    risks: z.array(z.string()).default([]),
    open_questions: z.array(z.string()).default([]),
    edge_cases: z.array(z.string()).default([]),
    regression_risks: z.array(z.string()).default([]),
    verification_plan: z.array(z.string()).default([]),
    scope_recommendation: z.string().default(""),
    metric_hooks: z.array(z.string()).default([]),
    // Discriminated by agent id at parse time.
    contribution: z.unknown().optional(),
    // Legacy compat: older saved plans referenced plan_contributions on agent
    // outputs. We accept it on read but ignore it for synthesis.
    plan_contributions: z.array(z.unknown()).optional(),
  })
  .passthrough();
export type AgentOutput = z.infer<typeof AgentOutputSchema>;

export function parseAgentOutputJson(raw: string, agentId: AgentId): AgentOutput {
  const stripped = stripFences(raw.trim());
  const body = extractJsonObject(stripped);
  const envelope = AgentOutputSchema.parse(JSON.parse(body));
  // Validate the contribution shape against the agent's role. We keep the raw
  // contribution on the envelope (so the synthesizer can read it back), but we
  // throw if it's malformed so the runner retries.
  const c = envelope.contribution;
  switch (agentId) {
    case "product":
      ProductContributionSchema.parse(c ?? {});
      break;
    case "qa":
      QaContributionSchema.parse(c ?? {});
      break;
    case "frontend":
    case "backend":
      EngContributionSchema.parse(c ?? {});
      break;
    default:
      throw new Error(`no contribution shape for agent: ${agentId}`);
  }
  return { ...envelope, agent: agentId };
}

// ============================================================================
// SYNTHESIZER — composes per-agent contributions into a single PlanV2
// ============================================================================

const SYNTH_INSTRUCTIONS = `You are Mesh's master synthesizer. Your specialist agents have each contributed their lane:
  - product → SPEC (user stories, acceptance criteria, contracts, non-goals)
  - qa → TEST PLAN (one or more tests per acceptance criterion)
  - frontend / backend → IMPLEMENTATION steps (each makes one or more tests pass)

Your job: weld these into a single coherent SDD/TDD plan with full traceability AC → tests → implementation.

After </thinking>, emit ONLY this JSON:

{
  "schema_version": "2",
  "spec": {
    "summary": "1-2 sentence description of what we are building",
    "user_stories": ["..."],
    "acceptance_criteria": [
      { "id": "AC-1", "given": "...", "when": "...", "then": "..." }
    ],
    "contracts": [
      { "id": "C-1", "kind": "http"|"function"|"data"|"event", "description": "...", "shape": "..." }
    ],
    "non_goals": ["..."],
    "invariants_respected": ["invariant-id", ...]
  },
  "tests": [
    {
      "step": 1,
      "test_id": "T-1",
      "ac_ids": ["AC-1"],
      "test_kind": "unit"|"integration"|"e2e"|"contract"|"manual",
      "expected_initial_state": "fails"|"n/a-doc-or-config",
      "agent": "qa",
      "repo": "string", "file": "string", "action": "edit"|"create",
      "rationale": "string",
      "invariants_respected": ["..."],
      "memory_citations": ["repo:path"],
      "target_branch": "string"
    }
  ],
  "implementation": [
    {
      "step": 1,
      "impl_id": "I-1",
      "test_ids": ["T-1"],
      "agent": "frontend"|"backend"|"product",
      "repo": "string", "file": "string", "action": "edit"|"create",
      "rationale": "string",
      "invariants_respected": ["..."],
      "memory_citations": ["repo:path"],
      "target_branch": "string"
    }
  ],
  "sequencing": ["repo", "repo", ...],
  "blast_radius": "2-3 sentence assessment of what else could break",
  "traceability": {
    "ac_to_tests":  { "AC-1": ["T-1", "T-2"] },
    "test_to_impl": { "T-1": ["I-3", "I-4"] }
  }
}

Rules:
- Every AC MUST appear in traceability.ac_to_tests with at least one T-id.
- Every test (kind != "manual") MUST appear in traceability.test_to_impl with at least one I-id.
- Every step (test or impl) shares the same target_branch (provided in the user prompt).
- Each step cites at least one invariant ("no-invariant-applies" is allowed).
- Each step cites at least one memory_citation in "repo:path" format.
- "sequencing" orders repos so upstream changes land before downstream consumers.
- "step" numbers are local to the array (tests use 1..N over tests; implementation uses 1..M over impl).
- Resolve conflicts between agents. If frontend and backend propose incompatible shapes, pick one and name the loser in blast_radius.
- If the qa agent did not cover an AC, GENERATE a test for it. Do not silently drop the AC.
- Do NOT wrap JSON in markdown fences.`;

export function buildSynthesizerSystem(memory: Memory): string {
  return [
    SYNTH_INSTRUCTIONS,
    "---",
    "CROSS-REPO MEMORY:",
    compactMemory(memory),
  ].join("\n\n");
}

export function buildSynthesizerUser(args: {
  ticket: string;
  reposTouched: string[];
  targetBranch: string;
  dispatch: DispatchPayload;
  outputs: AgentOutput[];
}): string {
  const lines: string[] = [];
  lines.push(`TICKET:\n\n${args.ticket.trim()}`);
  lines.push("");
  lines.push(`REPOS TOUCHED: ${args.reposTouched.join(", ")}`);
  lines.push(`TARGET BRANCH: ${args.targetBranch}`);
  lines.push("");
  lines.push("DISPATCH RATIONALE:");
  lines.push(args.dispatch.rationale);
  lines.push("");
  lines.push("AGENT OUTPUTS:");
  for (const o of args.outputs) {
    lines.push("");
    lines.push(`## ${o.agent}`);
    lines.push(JSON.stringify(o, null, 2));
  }
  lines.push("");
  lines.push("Think between <thinking> tags, then emit the final v2 plan JSON.");
  return lines.join("\n");
}

export function parseSynthesizedPlan(raw: string): PlanV2 {
  const stripped = stripFences(raw.trim());
  const body = extractJsonObject(stripped);
  const plan = PlanV2Schema.parse(JSON.parse(body));
  const problems = validateTraceability(plan);
  if (problems.length > 0) {
    throw new Error(`traceability validation failed: ${problems.join("; ")}`);
  }
  return plan;
}

// ============================================================================
// utils
// ============================================================================

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
