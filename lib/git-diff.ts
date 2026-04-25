import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

const DIFF_TIMEOUT = 15_000;
const DIFF_MAX_BUFFER = 8 * 1024 * 1024;

export type DiffHunk = {
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: { kind: "ctx" | "add" | "del"; text: string }[];
};

export type DiffFile = {
  path: string;
  oldPath?: string;
  status: "added" | "modified" | "deleted" | "renamed";
  additions: number;
  deletions: number;
  binary: boolean;
  hunks: DiffHunk[];
};

export type RepoDiff = {
  repo: string;
  branch: string;
  base: string;
  files: DiffFile[];
};

const REF_RE = /^[A-Za-z0-9._/\\-]+$/;

function safeRef(s: string): string {
  if (!REF_RE.test(s)) throw new Error(`unsafe git ref: ${s}`);
  return s;
}

async function git(
  cwd: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execFileP("git", args, {
      cwd,
      timeout: DIFF_TIMEOUT,
      maxBuffer: DIFF_MAX_BUFFER,
    });
  } catch (err) {
    const e = err as { stderr?: string; message: string };
    throw new Error(e.stderr?.trim() || e.message);
  }
}

// Returns a tree of file-level + hunk-level diff data between the feature
// branch (HEAD) and the base. Files are listed by name-status; bodies are
// fetched per file so binary files don't dump megabytes of garbage. The
// merge-base is used as the comparison anchor so commits that landed on the
// base after the branch was cut don't show up as local changes.
export async function repoDiffAgainstBase(
  cwd: string,
  base: string,
): Promise<RepoDiff> {
  const safeBase = safeRef(base);
  let mergeBase = safeBase;
  try {
    const { stdout } = await git(cwd, ["merge-base", "HEAD", safeBase]);
    const trimmed = stdout.trim();
    if (trimmed) mergeBase = trimmed;
  } catch {
    // base may not exist locally yet; fall back to the ref name.
  }

  const head = (await git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"])).stdout.trim();

  const nameStatus = await git(cwd, [
    "diff",
    "--name-status",
    "-M",
    `${mergeBase}...HEAD`,
  ]);
  const numstat = await git(cwd, ["diff", "--numstat", `${mergeBase}...HEAD`]);

  const numByPath = new Map<string, { additions: number; deletions: number; binary: boolean }>();
  for (const line of numstat.stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split("\t");
    if (parts.length < 3) continue;
    const [add, del, ...rest] = parts;
    const path = rest.join("\t");
    const binary = add === "-" || del === "-";
    numByPath.set(path, {
      additions: binary ? 0 : Number(add) || 0,
      deletions: binary ? 0 : Number(del) || 0,
      binary,
    });
  }

  const files: DiffFile[] = [];
  for (const line of nameStatus.stdout.split("\n")) {
    if (!line.trim()) continue;
    const cols = line.split("\t");
    const code = cols[0];
    let oldPath: string | undefined;
    let path: string;
    let status: DiffFile["status"];
    if (code.startsWith("R")) {
      oldPath = cols[1];
      path = cols[2];
      status = "renamed";
    } else if (code === "A") {
      path = cols[1];
      status = "added";
    } else if (code === "D") {
      path = cols[1];
      status = "deleted";
    } else {
      path = cols[1];
      status = "modified";
    }
    if (!path) continue;
    const num = numByPath.get(path) ??
      numByPath.get(`${oldPath ?? ""}\t${path}`) ?? {
        additions: 0,
        deletions: 0,
        binary: false,
      };
    files.push({
      path,
      oldPath,
      status,
      additions: num.additions,
      deletions: num.deletions,
      binary: num.binary,
      hunks: [],
    });
  }

  // Fetch hunks per file. Skip binary and deleted files (no useful body).
  for (const f of files) {
    if (f.binary) continue;
    if (f.status === "deleted") continue;
    try {
      const { stdout } = await git(cwd, [
        "diff",
        "--unified=3",
        `${mergeBase}...HEAD`,
        "--",
        f.path,
      ]);
      f.hunks = parseHunks(stdout);
    } catch {
      // leave hunks empty
    }
  }

  return {
    repo: head,
    branch: head,
    base,
    files,
  };
}

const HUNK_HEADER_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

function parseHunks(raw: string): DiffHunk[] {
  const lines = raw.split("\n");
  const hunks: DiffHunk[] = [];
  let cur: DiffHunk | null = null;
  let inBody = false;

  for (const line of lines) {
    if (line.startsWith("@@")) {
      const m = line.match(HUNK_HEADER_RE);
      if (!m) continue;
      cur = {
        header: line,
        oldStart: Number(m[1]),
        oldLines: m[2] ? Number(m[2]) : 1,
        newStart: Number(m[3]),
        newLines: m[4] ? Number(m[4]) : 1,
        lines: [],
      };
      hunks.push(cur);
      inBody = true;
      continue;
    }
    if (!inBody || !cur) continue;
    if (!line) {
      cur.lines.push({ kind: "ctx", text: "" });
      continue;
    }
    const c = line[0];
    const text = line.slice(1);
    if (c === "+") cur.lines.push({ kind: "add", text });
    else if (c === "-") cur.lines.push({ kind: "del", text });
    else if (c === " ") cur.lines.push({ kind: "ctx", text });
    // ignore "\ No newline at end of file" and other meta lines
  }
  return hunks;
}

// Force-delete a feature branch after switching to the repo's default base.
// Used by /api/ship/discard.
export async function discardBranch(
  cwd: string,
  branch: string,
  base: string,
): Promise<void> {
  const safeB = safeRef(branch);
  const safeBase = safeRef(base);
  // Move off the branch first; ignore failures (branch might already be gone).
  try {
    await git(cwd, ["checkout", safeBase]);
  } catch {
    // continue — the delete will fail loudly if the worktree is dirty.
  }
  await git(cwd, ["branch", "-D", safeB]);
}
