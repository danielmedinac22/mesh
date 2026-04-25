import type { Memory } from "@/lib/memory";

const INSTRUCTIONS = `You are Mesh's Classifier. You receive a ticket written by a non-technical human (PM, CEO, ops) and the cross-repo memory of a product. You decide what kind of work this ticket requires and which repos it touches.

Emit ONLY this JSON object (no markdown fences, no prose):

{
  "type": "code_change" | "config" | "faq" | "issue_comment",
  "repos_touched": ["string"],
  "target_branch": "mesh/<kebab-case-summary>",
  "confidence": number between 0 and 1,
  "summary": "one-sentence restatement of intent",
  "reasoning": "2-4 sentences why you picked this type and these repos, citing invariant ids or flow ids from memory if relevant"
}

Rules:
- "type" = "code_change" when behavior changes in source. "config" when only environment/feature flags move. "faq" when it is a knowledge question with no change. "issue_comment" when it is clarification that belongs on an existing PR/issue.
- "repos_touched" must be a subset of the memory's known repos. Be conservative — if there is real doubt, include the repo.
- "target_branch" must start with "mesh/" and be short (<= 60 chars total). Kebab-case, no spaces.
- If you cite invariants/flows in "reasoning", reference them by id (e.g. "touches flow checkout-flow, must respect invariant pricing-single-source").`;

export function buildClassifySystem(memory: Memory, brain?: string): string {
  const memBlock = compactMemory(memory);
  const parts = [
    INSTRUCTIONS,
    "---",
    `CROSS-REPO MEMORY (authoritative context):\n\n${memBlock}`,
  ];
  if (brain && brain.trim()) {
    parts.push("---");
    parts.push(`PERSONAL BRAIN (user-level context — notes, meetings, tickets, links the user has captured across projects; use to disambiguate intent and respect prior decisions, but never override the cross-repo memory):\n\n${brain}`);
  }
  return parts.join("\n\n");
}

export function buildClassifyUser(ticket: string): string {
  return `TICKET:\n\n${ticket.trim()}\n\nEmit the classification JSON.`;
}

// The raw memory.json is ~17KB. For classification we compact it to only
// the fields the classifier needs: repo names, invariant ids+statements,
// and flow ids+names+repo sequences. Call graph + evidence line numbers
// are not needed to route a ticket.
export function compactMemory(memory: Memory): string {
  const shape = {
    repos: memory.repos.map((r) => ({
      name: r.name,
      symbol_count: r.symbol_count,
      invariants: r.invariants.map((inv) => ({
        id: inv.id,
        statement: inv.statement,
      })),
    })),
    cross_repo_flows: memory.cross_repo_flows.map((f) => ({
      id: f.id,
      name: f.name,
      repos: f.repos,
      entry: f.entry,
    })),
    invariants: memory.invariants.map((inv) => ({
      id: inv.id,
      statement: inv.statement,
      evidence_paths: inv.evidence.map((e) => `${e.repo}:${e.path}`),
    })),
  };
  return JSON.stringify(shape, null, 2);
}
