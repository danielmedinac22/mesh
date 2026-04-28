import path from "node:path";
import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { getEngine } from "@/lib/engine";

const execFileP = promisify(execFile);

const ROOT = process.cwd();
const ERRORS_DIR = path.join(ROOT, ".mesh", "errors");
const HEAL_LOG = path.join(ROOT, ".mesh", "heal-log.json");

// Self-heal can only modify files inside this allowlist. Anything else is
// considered core and is rewritten manually by humans (lib/engine.ts and
// friends are explicitly off-limits per CLAUDE.md).
const ALLOWLIST: RegExp[] = [
  /^app\/api\/(?!heal\b)[^/]+(\/[^/]+)*\/route\.ts$/,
  /^app\/[^/]+\/page\.tsx$/,
];

const BLOCKLIST: RegExp[] = [
  /^lib\//,
  /^\.claude\//,
  /^\.mesh\//,
  /^app\/api\/heal\//,
  /^package\.json$/,
  /^pnpm-lock\.yaml$/,
  /^tsconfig\.json$/,
  /^next\.config\./,
];

export interface ErrorContext {
  requestSummary?: Record<string, unknown>;
  recentEvents?: unknown[];
}

export interface ErrorPayload extends ErrorContext {
  id: string;
  createdAt: string;
  endpoint: string;
  errorMessage: string;
  errorStack?: string;
}

export type HealStatus =
  | "auto-applied"
  | "applied"
  | "proposal"
  | "skipped"
  | "failed";

const AUTO_APPLY_ENV = "MESH_SELF_HEAL_AUTO_APPLY";

function isAutoApplyEnabled(): boolean {
  const v = process.env[AUTO_APPLY_ENV];
  return v === "1" || v === "true";
}

export interface HealLogEntry {
  id: string;
  errorId: string;
  endpoint: string;
  status: HealStatus;
  rootCause: string;
  filesChanged: string[];
  commit?: string;
  reason?: string;
  createdAt: string;
}

/**
 * Fire-and-forget wrapper: capture the error, then run the heal loop in the
 * background. Use from any endpoint's catch block — it never throws and never
 * blocks the response. The result lands in `.mesh/heal-log.json`.
 */
export function triggerSelfHeal(
  endpoint: string,
  error: unknown,
  context: ErrorContext = {},
): void {
  // Avoid recursion: never self-heal failures of the heal subsystem itself.
  if (endpoint.startsWith("/api/heal")) return;
  void captureError(endpoint, error, context)
    .then((id) => runSelfHeal(id))
    .catch(() => {
      // self-heal must never throw into the request lifecycle
    });
}

/**
 * Wrap an SSE-style async iterable so that any `{ type: "error" }` event or
 * thrown exception fires self-heal in the background while the events still
 * stream to the client unchanged. Designed for endpoints that just plumb a
 * pipeline through `pipelineToSSE`.
 */
export function withSelfHealOnSse<
  T extends { type: string; message?: string },
>(
  iter: AsyncIterable<T>,
  endpoint: string,
  contextSnapshotter?: () => ErrorContext,
): AsyncIterable<T> {
  return (async function* () {
    const recent: T[] = [];
    let triggered = false;
    const ctx = (): ErrorContext => ({
      ...(contextSnapshotter?.() ?? {}),
      recentEvents: [...recent],
    });
    try {
      for await (const ev of iter) {
        recent.push(ev);
        if (recent.length > 30) recent.shift();
        yield ev;
        if (!triggered && ev.type === "error") {
          triggered = true;
          triggerSelfHeal(
            endpoint,
            new Error(ev.message ?? "unknown error"),
            ctx(),
          );
        }
      }
    } catch (err) {
      if (!triggered) {
        triggered = true;
        triggerSelfHeal(endpoint, err, ctx());
      }
      throw err;
    }
  })();
}

export async function captureError(
  endpoint: string,
  error: unknown,
  context: ErrorContext = {},
): Promise<string> {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const payload: ErrorPayload = {
    id,
    createdAt: new Date().toISOString(),
    endpoint,
    errorMessage: error instanceof Error ? error.message : String(error),
    errorStack: error instanceof Error ? error.stack : undefined,
    requestSummary: context.requestSummary,
    recentEvents: context.recentEvents,
  };
  await fs.mkdir(ERRORS_DIR, { recursive: true });
  await fs.writeFile(
    path.join(ERRORS_DIR, `${id}.json`),
    JSON.stringify(payload, null, 2),
    "utf8",
  );
  return id;
}

const HealResponseSchema = z.object({
  rootCause: z.string(),
  files: z
    .array(z.object({ path: z.string(), contents: z.string() }))
    .nullable()
    .optional(),
  commitMessage: z.string().optional(),
  reason: z.string().optional(),
});

type HealResponse = z.infer<typeof HealResponseSchema>;

export async function runSelfHeal(errorId: string): Promise<HealLogEntry> {
  const payload = await readPayload(errorId);

  // Gate 1: classifier — skip transient errors before spending tokens.
  const transientReason = classifyTransient(payload.errorMessage);
  if (transientReason) {
    return appendLog({
      errorId,
      endpoint: payload.endpoint,
      status: "skipped",
      rootCause: payload.errorMessage,
      filesChanged: [],
      reason: `transient: ${transientReason}`,
    });
  }

  let parsed: HealResponse;
  try {
    const ctx = await loadCandidateFiles(payload.endpoint);
    const system = buildSelfHealSystemPrompt();
    const prompt = buildSelfHealUserPrompt(payload, ctx);
    const raw = await callEngineForJson(system, prompt);
    parsed = HealResponseSchema.parse(JSON.parse(extractJsonObject(raw)));
  } catch (err) {
    return appendLog({
      errorId,
      endpoint: payload.endpoint,
      status: "failed",
      rootCause: payload.errorMessage,
      filesChanged: [],
      reason: `self-heal engine call failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  const files = parsed.files ?? [];
  if (files.length === 0) {
    return appendLog({
      errorId,
      endpoint: payload.endpoint,
      status: "skipped",
      rootCause: parsed.rootCause,
      filesChanged: [],
      reason: parsed.reason ?? "no fix proposed",
    });
  }

  // Gate 2: every proposed file must pass the allowlist.
  const offending = files.find((f) => !isAllowed(normalizePath(f.path)));
  if (offending) {
    await writeProposalArtifact(errorId, parsed);
    return appendLog({
      errorId,
      endpoint: payload.endpoint,
      status: "proposal",
      rootCause: parsed.rootCause,
      filesChanged: files.map((f) => f.path),
      reason: `out of allowlist: ${offending.path}`,
    });
  }

  await writeProposalArtifact(errorId, parsed);

  // Default behaviour is proposal-first: write the artifact, log it, and
  // wait for an explicit user action (button click → /api/heal/apply/<id>).
  // Auto-apply is opt-in via the env var so a user only flips it on once
  // they trust the pipeline.
  if (!isAutoApplyEnabled()) {
    return appendLog({
      errorId,
      endpoint: payload.endpoint,
      status: "proposal",
      rootCause: parsed.rootCause,
      filesChanged: files.map((f) => f.path),
      reason: `proposal-first (set ${AUTO_APPLY_ENV}=1 to auto-apply)`,
    });
  }

  return applyProposalCore(errorId, payload, parsed, "auto-applied");
}

/**
 * Apply a stored proposal — invoked by the heal API when the user clicks
 * "apply" in the UI. Reuses every gate from the auto-apply path.
 */
export async function applyProposal(errorId: string): Promise<HealLogEntry> {
  const payload = await readPayload(errorId);
  const proposal = await readProposalArtifact(errorId);
  if (!proposal) {
    return appendLog({
      errorId,
      endpoint: payload.endpoint,
      status: "failed",
      rootCause: payload.errorMessage,
      filesChanged: [],
      reason: "no proposal on disk for this error id",
    });
  }
  return applyProposalCore(errorId, payload, proposal, "applied");
}

async function applyProposalCore(
  errorId: string,
  payload: ErrorPayload,
  parsed: HealResponse,
  successStatus: "auto-applied" | "applied",
): Promise<HealLogEntry> {
  const files = parsed.files ?? [];

  if (files.length !== 1) {
    return appendLog({
      errorId,
      endpoint: payload.endpoint,
      status: "proposal",
      rootCause: parsed.rootCause,
      filesChanged: files.map((f) => f.path),
      reason: "multi-file change → proposal only",
    });
  }

  // Re-validate the path at apply time. The proposal artifact lives on disk
  // and could (in theory) be tampered with between heal and apply.
  const offending = files.find((f) => !isAllowed(normalizePath(f.path)));
  if (offending) {
    return appendLog({
      errorId,
      endpoint: payload.endpoint,
      status: "failed",
      rootCause: parsed.rootCause,
      filesChanged: files.map((f) => f.path),
      reason: `out of allowlist on apply: ${offending.path}`,
    });
  }

  const target = files[0];
  const targetRel = normalizePath(target.path);
  const targetAbs = path.join(ROOT, targetRel);

  if (await isPathDirty(targetRel)) {
    return appendLog({
      errorId,
      endpoint: payload.endpoint,
      status: "proposal",
      rootCause: parsed.rootCause,
      filesChanged: [targetRel],
      reason: "target has uncommitted changes; not applying",
    });
  }

  let backup: string;
  try {
    backup = await fs.readFile(targetAbs, "utf8");
  } catch {
    return appendLog({
      errorId,
      endpoint: payload.endpoint,
      status: "skipped",
      rootCause: parsed.rootCause,
      filesChanged: [targetRel],
      reason: `target file missing: ${targetRel}`,
    });
  }

  if (backup === target.contents) {
    return appendLog({
      errorId,
      endpoint: payload.endpoint,
      status: "skipped",
      rootCause: parsed.rootCause,
      filesChanged: [targetRel],
      reason: "no-op (proposed contents identical)",
    });
  }

  await fs.writeFile(targetAbs, target.contents, "utf8");

  const tc = await runTypecheck();
  if (!tc.ok) {
    await fs.writeFile(targetAbs, backup, "utf8");
    return appendLog({
      errorId,
      endpoint: payload.endpoint,
      status: "proposal",
      rootCause: parsed.rootCause,
      filesChanged: [targetRel],
      reason: `typecheck failed; reverted. tail:\n${tc.tail}`,
    });
  }

  const subject = (parsed.commitMessage?.trim() ||
    `fix(self-heal): patch ${payload.endpoint}`).split("\n")[0].slice(0, 100);
  let commit: string | undefined;
  try {
    commit = await commitChange(targetRel, subject);
  } catch (err) {
    await fs.writeFile(targetAbs, backup, "utf8");
    return appendLog({
      errorId,
      endpoint: payload.endpoint,
      status: "failed",
      rootCause: parsed.rootCause,
      filesChanged: [targetRel],
      reason: `commit failed; reverted. ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  return appendLog({
    errorId,
    endpoint: payload.endpoint,
    status: successStatus,
    rootCause: parsed.rootCause,
    filesChanged: [targetRel],
    commit,
  });
}

export async function readProposalArtifact(
  errorId: string,
): Promise<HealResponse | null> {
  try {
    const raw = await fs.readFile(
      path.join(ERRORS_DIR, `${errorId}.proposal.json`),
      "utf8",
    );
    return HealResponseSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

function classifyTransient(message: string): string | null {
  const lc = message.toLowerCase();
  if (/\b(429|rate.?limit|too many requests)\b/.test(lc))
    return "rate limit — retry";
  if (/\b(5\d\d|service unavailable|bad gateway|gateway timeout)\b/.test(lc))
    return "upstream 5xx — retry";
  if (/\b(econnreset|enotfound|etimedout|fetch failed|network)\b/.test(lc))
    return "network blip — retry";
  if (/\boverloaded\b/.test(lc)) return "model overloaded — retry";
  return null;
}

function isAllowed(p: string): boolean {
  if (BLOCKLIST.some((re) => re.test(p))) return false;
  return ALLOWLIST.some((re) => re.test(p));
}

function normalizePath(p: string): string {
  return p.replace(/^\.?\/+/, "").replace(/\\/g, "/");
}

async function isPathDirty(rel: string): Promise<boolean> {
  try {
    const { stdout } = await execFileP(
      "git",
      ["status", "--porcelain", "--", rel],
      { cwd: ROOT, timeout: 5_000 },
    );
    return stdout.trim().length > 0;
  } catch {
    return true;
  }
}

async function readPayload(errorId: string): Promise<ErrorPayload> {
  const raw = await fs.readFile(
    path.join(ERRORS_DIR, `${errorId}.json`),
    "utf8",
  );
  return JSON.parse(raw) as ErrorPayload;
}

async function loadCandidateFiles(endpoint: string): Promise<string> {
  const candidates: string[] = [];
  const apiMatch = endpoint.match(/^\/api\/(.+?)\/?$/);
  if (apiMatch) candidates.push(`app/api/${apiMatch[1]}/route.ts`);
  const pageMatch = endpoint.match(/^\/([^/?#]+)\/?$/);
  if (pageMatch && !apiMatch) candidates.push(`app/${pageMatch[1]}/page.tsx`);

  let out = "";
  for (const rel of candidates) {
    try {
      const contents = await fs.readFile(path.join(ROOT, rel), "utf8");
      out += `\n=== FILE: ${rel} ===\n${contents}\n`;
    } catch {
      // file may not exist — skip silently
    }
  }
  return out || "(no candidate files found)";
}

function buildSelfHealSystemPrompt(): string {
  return `You are Mesh's self-healing agent. Mesh is a Next.js app that runs locally on a developer's machine; it is a poly-repo governance layer over Claude.

An error was caught in a running endpoint. Your job: identify the root cause and produce the SMALLEST possible code change that fixes it.

OUTPUT (a single JSON object, no prose, no markdown fences):
{
  "rootCause": "<one-sentence explanation>",
  "files": [{ "path": "<repo-relative path>", "contents": "<FULL file contents AFTER your edit>" }] | null,
  "commitMessage": "fix(self-heal): <imperative subject, English, <=72 chars>",
  "reason": "<if files is null: explain why you cannot fix it here>"
}

STRICT CONSTRAINTS:
1. You MAY only modify files matching:
   - app/api/<feature>/route.ts (NOT app/api/heal/**)
   - app/<feature>/page.tsx
2. You MUST NOT touch lib/**, .claude/**, .mesh/**, package.json, pnpm-lock.yaml, tsconfig.json, next.config.*. These are core.
3. If the fix requires touching anything off-limits, set files: null and explain in reason.
4. Smallest viable fix. No refactors, no "while I'm here" cleanup, no new comments unless documenting a non-obvious WHY.
5. Transient errors (429, 5xx, ECONNRESET, network timeouts, "overloaded"): set files: null, reason: "transient — retry, no code fix".
6. If you cannot reproduce the root cause from the provided context with confidence, set files: null and explain.
7. Return the FULL contents of each changed file (not a diff). Preserve existing imports, exports, and unrelated code verbatim.
8. Output JSON only. Do not call any tools. Do not use Edit, Write, or Bash.`;
}

function buildSelfHealUserPrompt(
  payload: ErrorPayload,
  candidateFiles: string,
): string {
  const events = JSON.stringify(payload.recentEvents ?? [], null, 2);
  const reqSummary = JSON.stringify(payload.requestSummary ?? {}, null, 2);
  return `ERROR
=====
Endpoint: ${payload.endpoint}
Message: ${payload.errorMessage}
${payload.errorStack ? `Stack:\n${payload.errorStack}\n` : ""}

RECENT SSE EVENTS (oldest -> newest, truncated)
==============================================
${events.slice(0, 4000)}

REQUEST SUMMARY
===============
${reqSummary.slice(0, 2000)}

CANDIDATE FILES (read these carefully before proposing a fix)
=============================================================
${candidateFiles}

Produce the JSON response now.`;
}

async function callEngineForJson(
  system: string,
  prompt: string,
): Promise<string> {
  // Raw mode is deterministic and has no file-system tools, so the model
  // cannot bypass our allowlist by writing files directly during the call.
  const engine = getEngine("raw");
  let out = "";
  let engineError: string | null = null;
  for await (const ev of engine.run({ prompt, system, wrapThinking: false })) {
    if (ev.type === "text") out += ev.delta;
    else if (ev.type === "error") engineError = ev.message;
  }
  if (engineError && out.trim() === "") {
    throw new Error(`engine error: ${engineError}`);
  }
  return out;
}

function extractJsonObject(s: string): string {
  const trimmed = s.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/, "$1");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return trimmed;
  return trimmed.slice(start, end + 1);
}

async function runTypecheck(): Promise<{ ok: boolean; tail: string }> {
  try {
    const { stdout, stderr } = await execFileP("pnpm", ["typecheck"], {
      cwd: ROOT,
      maxBuffer: 10 * 1024 * 1024,
      timeout: 240_000,
    });
    return { ok: true, tail: (stdout + stderr).slice(-1500) };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    const tail = (
      (e.stdout ?? "") +
      (e.stderr ?? "") ||
      e.message ||
      ""
    ).slice(-1500);
    return { ok: false, tail };
  }
}

async function commitChange(rel: string, message: string): Promise<string> {
  await execFileP("git", ["add", "--", rel], { cwd: ROOT, timeout: 10_000 });
  await execFileP("git", ["commit", "-m", message], {
    cwd: ROOT,
    timeout: 15_000,
  });
  const { stdout } = await execFileP("git", ["rev-parse", "HEAD"], {
    cwd: ROOT,
    timeout: 5_000,
  });
  return stdout.trim();
}

async function writeProposalArtifact(
  errorId: string,
  resp: HealResponse,
): Promise<void> {
  const p = path.join(ERRORS_DIR, `${errorId}.proposal.json`);
  await fs.writeFile(p, JSON.stringify(resp, null, 2), "utf8");
}

async function appendLog(
  entry: Omit<HealLogEntry, "id" | "createdAt">,
): Promise<HealLogEntry> {
  const full: HealLogEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    ...entry,
  };
  let log: HealLogEntry[] = [];
  try {
    const raw = await fs.readFile(HEAL_LOG, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) log = parsed as HealLogEntry[];
  } catch {
    // fresh log
  }
  log.unshift(full);
  await fs.mkdir(path.dirname(HEAL_LOG), { recursive: true });
  await fs.writeFile(
    HEAL_LOG,
    JSON.stringify(log.slice(0, 200), null, 2),
    "utf8",
  );
  return full;
}

export async function readHealLog(limit = 50): Promise<HealLogEntry[]> {
  try {
    const raw = await fs.readFile(HEAL_LOG, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return (parsed as HealLogEntry[]).slice(0, limit);
  } catch {
    return [];
  }
}
