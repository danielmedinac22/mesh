import type { Memory } from "@/lib/memory";
import { compactMemory } from "@/lib/prompts/classify";

const INSTRUCTIONS = `You are Mesh's Adjust agent. A ticket already has an open draft PR with commits on a feature branch. The user has reviewed the diff and wants you to make a targeted addendum on top of the existing branch — NOT regenerate the whole change.

For every adjustment you must produce:

1) <thinking>...</thinking> — short chain of thought (1-3 paragraphs). Restate the intent of the addendum, decide which file(s) you must touch, name the invariants that must still hold, predict which skill would fire if you got this wrong.

2) One or more fenced code blocks tagged with the filename. Emit one block per file you touch, containing the COMPLETE new file contents (not a diff):

\`\`\`path=<repo-relative-file-path>
<full file content>
\`\`\`

Rules:
- Always emit the full file, not a patch. The reader will diff against the current state on the branch.
- This is an ADDENDUM. Do not undo prior commits or restructure unrelated code. Build on top of what's already on the branch.
- Respect the invariants from the original plan and from cross-repo memory.
- Keep the addendum minimal: only the files needed to satisfy the user's instruction.
- If the instruction is genuinely impossible without breaking prior work, emit a single thinking block explaining why and NO file blocks. The runner will surface that as an error.
- No markdown outside the fenced code block(s). Chain of thought lives inside <thinking>...</thinking> only.`;

export function buildAdjustSystem(memory: Memory): string {
  return `${INSTRUCTIONS}\n\n---\n\nCROSS-REPO MEMORY (authoritative context):\n\n${compactMemory(memory)}`;
}

export function buildAdjustUser(args: {
  ticketTitle: string;
  ticketBody: string;
  planSummary: string;
  branch: string;
  base: string;
  repo: string;
  instruction: string;
  changedFiles: { path: string; status: string; additions: number; deletions: number }[];
  recentCommits: { sha: string; message: string }[];
  fileSnapshots: { path: string; content: string | null }[];
}): string {
  const parts: string[] = [];
  parts.push(`TICKET: ${args.ticketTitle}`);
  if (args.ticketBody.trim()) {
    parts.push(`TICKET BODY:\n${args.ticketBody.trim().slice(0, 1200)}`);
  }
  parts.push(`PLAN SUMMARY: ${args.planSummary}`);
  parts.push(`REPO: ${args.repo}`);
  parts.push(`BRANCH: ${args.branch} (base: ${args.base})`);

  if (args.recentCommits.length > 0) {
    parts.push(
      `COMMITS ALREADY ON THE BRANCH:\n${args.recentCommits
        .map((c) => `  ${c.sha.slice(0, 7)}  ${c.message.split("\n")[0]}`)
        .join("\n")}`,
    );
  }

  if (args.changedFiles.length > 0) {
    parts.push(
      `FILES CHANGED VS ${args.base}:\n${args.changedFiles
        .map(
          (f) =>
            `  ${f.status.padEnd(3)} ${f.path}  (+${f.additions} −${f.deletions})`,
        )
        .join("\n")}`,
    );
  }

  if (args.fileSnapshots.length > 0) {
    parts.push("CURRENT CONTENTS OF FILES MOST LIKELY RELEVANT:");
    for (const snap of args.fileSnapshots) {
      const trimmed = trimContent(snap.content ?? "");
      parts.push(
        `--- ${snap.path}\n\`\`\`\n${trimmed}\n\`\`\``,
      );
    }
  }

  parts.push(`USER ADJUSTMENT INSTRUCTION:\n${args.instruction.trim()}`);
  parts.push(
    "Produce <thinking> + the file blocks needed to satisfy this addendum. Touch as few files as possible.",
  );

  return parts.join("\n\n");
}

function trimContent(s: string, maxChars = 6000): string {
  if (s.length <= maxChars) return s;
  const head = s.slice(0, Math.floor(maxChars * 0.6));
  const tail = s.slice(-Math.floor(maxChars * 0.4));
  return `${head}\n\n/* ...${s.length - maxChars} chars elided... */\n\n${tail}`;
}

// Multi-block extractor: pulls every \`\`\`path=... block from Claude's text.
// Returns them in order; an empty array means Claude declined the addendum.
export function extractAdjustEdits(
  text: string,
): { path: string; content: string }[] {
  const re = /```\s*path=([^\s`]+)\s*\n([\s\S]*?)```/g;
  const out: { path: string; content: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const path = m[1].trim();
    const content = m[2].replace(/\s+$/, "") + "\n";
    if (path && content) out.push({ path, content });
  }
  return out;
}

export function buildAdjustCommitMessage(args: {
  repo: string;
  instruction: string;
  filesChanged: number;
  ticketId?: string;
}): string {
  const summary = args.instruction.split("\n")[0]?.slice(0, 64) ?? "addendum";
  const ticketTrace = args.ticketId ? ` [${args.ticketId}]` : "";
  return `chore(${args.repo}): ${summary}${ticketTrace} (mesh adjust · ${args.filesChanged} file${
    args.filesChanged === 1 ? "" : "s"
  })`;
}
