import type { Memory } from "@/lib/memory";
import { compactMemory } from "@/lib/prompts/classify";
import type { SavedPlan } from "@/lib/plan-store";
import type { UnifiedStep } from "@/lib/prompts/plan";

const INSTRUCTIONS = `You are Mesh's Ship agent. You receive an approved cross-repo plan and execute it step-by-step. The plan follows Test-Driven Development: TEST steps come first (they are expected to fail against the current code), then IMPLEMENTATION steps land code that turns those tests green.

For every step you must produce:

1) <thinking>...</thinking> — short chain of thought (1-3 paragraphs). Decide the minimum edit, name the invariants that must hold, predict which skill would fire if you got this wrong. For TEST steps, also state which assertions you are writing and what they will check.

2) Exactly one fenced code block tagged with the filename, containing the COMPLETE new file contents (not a diff):

\`\`\`path=<repo-relative-file-path>
<full file content>
\`\`\`

Rules:
- Always emit the full file, not a patch. The reader will diff against the current state.
- Respect the invariants named in the plan step. Do not invent new files unless action==create.
- Keep your edits minimal and targeted to the ticket. Do not refactor surrounding code.
- If the previous content exists and the step says action==edit, preserve existing structure, imports, and types.
- For TEST steps: write the test such that it fails against current main and will pass once the linked impl steps land. Use the existing test framework of the repo (read CURRENT FILE if it exists; otherwise mirror the convention of nearby tests).
- For IMPL steps: write the minimum code that makes the linked tests pass. Do not over-implement.
- No markdown outside the one fenced code block. Chain of thought lives inside <thinking>...</thinking> only.`;

export function buildShipSystem(memory: Memory): string {
  return `${INSTRUCTIONS}\n\n---\n\nCROSS-REPO MEMORY (authoritative context):\n\n${compactMemory(memory)}`;
}

export function buildShipStepUser(args: {
  saved: SavedPlan;
  step: UnifiedStep;
  totalSteps: number;
  currentContent: string | null;
  attempt: number;
  previousDraft?: string | null;
  violation?: { title: string; message: string; fix_hint: string } | null;
  // When true for attempt 1, omit invariant reminders from the user prompt
  // so the model is more likely to write a naive first draft that skills
  // can intercept. Per ROADMAP Day 3: the 2 interception moments are core
  // to the demo's "wow of depth". Subsequent attempts always include full
  // invariant context.
  loosen?: boolean;
}): string {
  const { step } = args;
  const parts: string[] = [];
  const isFirstAttempt = args.attempt === 1;
  const loosen = !!args.loosen && isFirstAttempt && !args.violation;

  parts.push(`TICKET:\n${args.saved.ticket.trim()}`);

  // High-level spec context — the agent sees what the test/impl is verifying.
  if (
    args.saved.plan &&
    "schema_version" in args.saved.plan &&
    args.saved.plan.schema_version === "2"
  ) {
    const v2 = args.saved.plan;
    parts.push(`SPEC SUMMARY: ${v2.spec.summary}`);
    parts.push(
      `SEQUENCING: ${v2.sequencing.length > 0 ? v2.sequencing.join(" -> ") : "(unspecified)"}`,
    );
    if (step.kind === "test") {
      const acs = v2.spec.acceptance_criteria.filter((a) =>
        step.ac_ids.includes(a.id),
      );
      if (acs.length > 0) {
        parts.push(
          `THIS TEST VERIFIES:\n${acs
            .map(
              (a) =>
                `  - ${a.id}: GIVEN ${a.given} WHEN ${a.when} THEN ${a.then}`,
            )
            .join("\n")}`,
        );
      }
      parts.push(
        `EXPECTED INITIAL STATE: ${step.expected_initial_state}${
          step.expected_initial_state === "fails"
            ? " (this test must fail against current main, then pass after the linked impl lands)"
            : ""
        }`,
      );
    } else {
      const tests = v2.tests.filter((t) => step.test_ids.includes(t.test_id));
      if (tests.length > 0) {
        parts.push(
          `THIS IMPLEMENTATION TURNS THESE TESTS GREEN:\n${tests
            .map((t) => `  - ${t.test_id} (${t.test_kind}) at ${t.repo}:${t.file}`)
            .join("\n")}`,
        );
      }
    }
  }

  const stepLabel =
    step.kind === "test"
      ? `TEST ${step.test_id}`
      : `IMPL ${step.impl_id}`;
  parts.push(
    `CURRENT STEP ${step.step}/${args.totalSteps} — ${stepLabel}: ${step.action} ${step.repo}:${step.file}`,
  );
  parts.push(`AGENT: ${step.agent}`);
  parts.push(`RATIONALE: ${step.rationale}`);
  if (!loosen && step.invariants_respected.length > 0) {
    parts.push(`INVARIANTS_RESPECTED: ${step.invariants_respected.join(", ")}`);
  }
  if (!loosen && step.memory_citations.length > 0) {
    parts.push(`MEMORY_CITATIONS: ${step.memory_citations.join(", ")}`);
  }

  if (args.currentContent === null) {
    parts.push(`CURRENT FILE: (does not exist — you are creating it)`);
  } else {
    // Cap very large files: show head + tail with a marker.
    const capped = capContent(args.currentContent, 12_000);
    parts.push(`CURRENT FILE CONTENT:\n\n\`\`\`\n${capped}\n\`\`\``);
  }

  if (args.violation && args.previousDraft) {
    parts.push(
      `YOUR PREVIOUS DRAFT VIOLATED A SKILL: ${args.violation.title}\n\n${args.violation.message}\n\nHOW TO FIX: ${args.violation.fix_hint}\n\nREWRITE the file so the violation is gone. Keep the ticket intent intact.`,
    );
    parts.push(
      `PREVIOUS DRAFT (that violated the skill):\n\n\`\`\`\n${capContent(args.previousDraft, 6_000)}\n\`\`\``,
    );
  }

  parts.push(
    `Emit <thinking>...</thinking> then the single fenced block with path=${step.file}. Use path=${step.file} exactly.`,
  );

  return parts.join("\n\n");
}

function capContent(s: string, maxChars: number): string {
  if (s.length <= maxChars) return s;
  const head = s.slice(0, Math.floor(maxChars * 0.6));
  const tail = s.slice(-Math.floor(maxChars * 0.4));
  return `${head}\n\n/* ...${s.length - maxChars} chars elided... */\n\n${tail}`;
}

// Parse the fenced block tagged with path=... from model text output.
// Returns { path, content } or null if the block can't be found.
export function extractShipEdit(
  text: string,
): { path: string; content: string } | null {
  // Match ```path=<path> ... ``` (tolerate whitespace + alt tags)
  const re = /```\s*path=([^\s`]+)\s*\n([\s\S]*?)```/;
  const m = text.match(re);
  if (!m) return null;
  const path = m[1].trim();
  const content = m[2].replace(/\s+$/, "") + "\n";
  if (!path || !content) return null;
  return { path, content };
}

// Build the conventional-commit-style message used when staging a step. The
// trace ids (T-x, I-x, AC-x) survive in `git log` so reviewers can audit which
// test verifies which acceptance criterion without reopening the plan UI.
export function buildShipCommitMessage(args: {
  step: UnifiedStep;
  totalSteps: number;
  acIds?: string[];
}): string {
  const prefix = args.step.kind === "test" ? "test" : "feat";
  const scope = args.step.repo;
  const traceParts: string[] = [];
  if (args.step.kind === "test") {
    traceParts.push(args.step.test_id);
    if (args.step.ac_ids.length > 0) traceParts.push(args.step.ac_ids.join(","));
  } else {
    traceParts.push(args.step.impl_id);
    if (args.step.test_ids.length > 0)
      traceParts.push(`green:${args.step.test_ids.join(",")}`);
    if (args.acIds && args.acIds.length > 0)
      traceParts.push(args.acIds.join(","));
  }
  const trace = traceParts.length > 0 ? ` [${traceParts.join(" · ")}]` : "";
  const summary = args.step.rationale.split("\n")[0]?.slice(0, 64) ?? "";
  return `${prefix}(${scope}): ${summary}${trace} (mesh ${args.step.step}/${args.totalSteps})`;
}
