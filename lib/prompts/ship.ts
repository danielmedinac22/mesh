import type { Memory } from "@/lib/memory";
import { compactMemory } from "@/lib/prompts/classify";
import type { SavedPlan } from "@/lib/plan-store";

const INSTRUCTIONS = `You are Mesh's Ship agent. You receive an approved cross-repo plan and you execute it step-by-step. For each step you emit ONE file edit.

For every step you must produce:

1) <thinking>...</thinking> — short chain of thought (1-3 paragraphs). Decide the minimum edit, name the invariants that must hold, predict which skill would fire if you got this wrong.

2) Exactly one fenced code block tagged with the filename, containing the COMPLETE new file contents (not a diff):

\`\`\`path=<repo-relative-file-path>
<full file content>
\`\`\`

Rules:
- Always emit the full file, not a patch. The reader will diff against the current state.
- Respect the invariants named in the plan step. Do not invent new files unless action==create.
- Keep your edits minimal and targeted to the ticket. Do not refactor surrounding code.
- If the previous content exists and the step says action==edit, preserve existing structure, imports, and types.
- No markdown outside the one fenced code block. Chain of thought lives inside <thinking>...</thinking> only.`;

export function buildShipSystem(memory: Memory): string {
  return `${INSTRUCTIONS}\n\n---\n\nCROSS-REPO MEMORY (authoritative context):\n\n${compactMemory(memory)}`;
}

export function buildShipStepUser(args: {
  saved: SavedPlan;
  stepIndex: number;
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
  const step = args.saved.plan.plan[args.stepIndex];
  if (!step) throw new Error(`step ${args.stepIndex} out of range`);
  const parts: string[] = [];
  const isFirstAttempt = args.attempt === 1;
  const loosen = !!args.loosen && isFirstAttempt && !args.violation;

  parts.push(`TICKET:\n${args.saved.ticket.trim()}`);
  parts.push(`PLAN SEQUENCING: ${args.saved.plan.sequencing.join(" -> ")}`);
  parts.push(
    `CURRENT STEP ${step.step}/${args.saved.plan.plan.length}: ${step.action} ${step.repo}:${step.file}`,
  );
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
    `Emit <thinking>...</thinking> then the single fenced block with path=${step.repo === "mesh" ? step.file : step.file}. Use path=${step.file} exactly.`,
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
