import type { IngestResult } from "@/lib/repo-ingest";
import { renderIngestAsSystemBlock } from "@/lib/repo-ingest";

const CONNECT_INSTRUCTIONS = `You are Mesh's Connect agent. You received N repositories of an organization that together form a single product. Your job: emit a cross-repo memory JSON.

For each repo:
- symbol_count: rough count of exported functions/classes/components you can see in the dump
- invariants: rules the code enforces with concrete file+line evidence (e.g. "all API routes call withTenant()", "money fields are integers in cents"). Every invariant MUST cite at least 2 files of evidence across the same repo or multiple repos.
- adrs: architecture decisions discovered in docs/decisions if present.

Cross-repo flows: identify request paths that traverse multiple repos (e.g. "checkout: web -> api -> analytics -> content"). For each flow name the sequence of repos and the specific entry point (route, handler, job).

Call graph: cross-repo function/endpoint usages you can identify from imports or URL patterns.

Emit this schema exactly:

{
  "repos": [
    {
      "name": "string",
      "symbol_count": number,
      "invariants": [
        {
          "id": "short-kebab-case",
          "statement": "string",
          "evidence": [
            { "repo": "string", "path": "string", "line": number }
          ]
        }
      ],
      "adrs": [ { "path": "string", "title": "string" } ]
    }
  ],
  "cross_repo_flows": [
    {
      "id": "short-kebab-case",
      "name": "string",
      "repos": ["string"],
      "entry": { "repo": "string", "path": "string" }
    }
  ],
  "invariants": [
    {
      "id": "short-kebab-case",
      "statement": "string",
      "evidence": [
        { "repo": "string", "path": "string", "line": number }
      ]
    }
  ],
  "call_graph": [
    {
      "from": { "repo": "string", "symbol": "string" },
      "to": { "repo": "string", "symbol": "string" }
    }
  ]
}

Rules:
- Every invariant needs at least 2 evidence entries.
- \`line\` must be your best estimate from the file content (1-indexed). If unknown, use 1.
- Output ONLY the JSON object. No markdown fence, no prose, no commentary before or after. Reason internally before writing the JSON — do not narrate your reasoning in the output.`;

export function buildConnectSystemPrompt(ingest: IngestResult): string {
  const dump = renderIngestAsSystemBlock(ingest);
  return `${CONNECT_INSTRUCTIONS}\n\n---\n\n${dump}`;
}

export const CONNECT_USER_PROMPT = "Begin analysis. Emit the memory JSON.";
