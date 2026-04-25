import type { Memory } from "@/lib/memory";

// Compact memory summary used as system-prompt context for skill/agent
// generation and improvement. Keeps the per-call payload small enough to fit
// inside the cached system prefix while preserving the most actionable
// signals: invariant ids/statements, evidence file paths, cross-repo flows.
export function summarizeMemoryForPrompt(memory: Memory): string {
  const lines: string[] = [];
  lines.push("Repos:");
  for (const r of memory.repos) {
    lines.push(`- ${r.name} (${r.symbol_count} symbols)`);
    for (const inv of r.invariants.slice(0, 3)) {
      lines.push(`  - invariant ${inv.id}: ${inv.statement.slice(0, 140)}`);
      for (const e of inv.evidence.slice(0, 2)) {
        lines.push(`    evidence: ${e.repo}:${e.path}`);
      }
    }
  }
  lines.push("Global invariants:");
  for (const inv of memory.invariants.slice(0, 6)) {
    lines.push(`- ${inv.id}: ${inv.statement.slice(0, 140)}`);
  }
  lines.push("Flows:");
  for (const f of memory.cross_repo_flows.slice(0, 6)) {
    lines.push(`- ${f.id}: ${f.repos.join(" -> ")}`);
  }
  return lines.join("\n");
}
