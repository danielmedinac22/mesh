// Deterministic skill checks complement the natural interception the
// Claude Agent SDK performs from `.claude/skills/`. The alpha ships with
// no built-in invariants — judges author their own skills against their
// own repos and the agent loop enforces them.

export type SkillViolation = {
  skill_id: string;
  title: string;
  message: string;
  fix_hint: string;
};

export type SkillCheckInput = {
  repo: string;
  file: string;
  content: string;
  previous?: string | null;
  ticket?: string;
};

export function runSkillChecks(_input: SkillCheckInput): SkillViolation[] {
  return [];
}
