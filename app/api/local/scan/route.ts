import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseGithubRemote } from "@/lib/github";
import { safeRepoName } from "@/lib/mesh-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const execP = promisify(execFile);

const GIT_TIMEOUT_MS = 5_000;
const MAX_CONTAINER_ENTRIES = 200;
const MAX_BRANCHES = 200;

export type ScannedRepo = {
  path: string;
  name: string;
  isWorktree: boolean;
  currentBranch: string;
  branches: string[];
  isDirty: boolean;
  hasOrigin: boolean;
  githubOwner?: string;
  githubRepo?: string;
  warnings?: string[];
};

export type ScanResponse =
  | { type: "repo"; repo: ScannedRepo }
  | { type: "container"; root: string; repos: ScannedRepo[]; truncated?: boolean }
  | { type: "empty"; root: string }
  | { type: "error"; message: string };

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const raw = typeof body?.path === "string" ? body.path : "";
  const target = raw.trim();

  if (!target) {
    return NextResponse.json<ScanResponse>(
      { type: "error", message: "path is required" },
      { status: 400 },
    );
  }
  if (!path.isAbsolute(target)) {
    return NextResponse.json<ScanResponse>(
      { type: "error", message: "path must be absolute" },
      { status: 400 },
    );
  }

  try {
    const stat = await fs.stat(target);
    if (!stat.isDirectory()) {
      return NextResponse.json<ScanResponse>(
        { type: "error", message: `not a directory: ${target}` },
        { status: 400 },
      );
    }
  } catch {
    return NextResponse.json<ScanResponse>(
      { type: "error", message: `path not found: ${target}` },
      { status: 400 },
    );
  }

  // Case 1: folder itself is a git repo.
  if (await isGitRepo(target)) {
    const repo = await scanOne(target);
    return NextResponse.json<ScanResponse>({ type: "repo", repo });
  }

  // Case 2: scan immediate children for git repos.
  let entries: string[] = [];
  try {
    entries = await fs.readdir(target);
  } catch (err) {
    return NextResponse.json<ScanResponse>({
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    });
  }

  const truncated = entries.length > MAX_CONTAINER_ENTRIES;
  const slice = truncated ? entries.slice(0, MAX_CONTAINER_ENTRIES) : entries;

  const candidates: string[] = [];
  await Promise.all(
    slice.map(async (entry) => {
      if (entry.startsWith(".")) return; // skip dotfiles/dotdirs at top level
      const full = path.join(target, entry);
      try {
        const s = await fs.stat(full);
        if (!s.isDirectory()) return;
      } catch {
        return;
      }
      if (await isGitRepo(full)) candidates.push(full);
    }),
  );

  if (candidates.length === 0) {
    return NextResponse.json<ScanResponse>({ type: "empty", root: target });
  }

  candidates.sort((a, b) => a.localeCompare(b));
  const repos = await Promise.all(candidates.map((p) => scanOne(p)));

  return NextResponse.json<ScanResponse>({
    type: "container",
    root: target,
    repos,
    ...(truncated ? { truncated: true } : {}),
  });
}

async function isGitRepo(dir: string): Promise<boolean> {
  try {
    await execP("git", ["-C", dir, "rev-parse", "--git-dir"], {
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: 1 * 1024 * 1024,
    });
    return true;
  } catch {
    return false;
  }
}

async function scanOne(repoPath: string): Promise<ScannedRepo> {
  const warnings: string[] = [];
  const base = path.basename(repoPath);
  let name = safeRepoName(base) ? base : base.replace(/[^A-Za-z0-9._-]+/g, "-");
  if (!safeRepoName(name)) name = "repo";

  let isWorktree = false;
  try {
    const s = await fs.stat(path.join(repoPath, ".git"));
    isWorktree = s.isFile();
  } catch {
    // Some worktrees may have a bare .git resolution; leave false.
  }

  let currentBranch = "HEAD";
  try {
    const { stdout } = await execP(
      "git",
      ["-C", repoPath, "rev-parse", "--abbrev-ref", "HEAD"],
      { timeout: GIT_TIMEOUT_MS, maxBuffer: 1 * 1024 * 1024 },
    );
    currentBranch = stdout.trim() || "HEAD";
  } catch {
    warnings.push("could not resolve HEAD");
  }
  if (currentBranch === "HEAD") warnings.push("detached HEAD");

  let branches: string[] = [];
  try {
    const { stdout } = await execP(
      "git",
      [
        "-C",
        repoPath,
        "for-each-ref",
        "--format=%(refname:short)",
        "--sort=-committerdate",
        "refs/heads",
        "refs/remotes/origin",
      ],
      { timeout: GIT_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
    );
    const seen = new Set<string>();
    for (const raw of stdout.split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      // Skip origin/HEAD symbolic ref; normalize remote branches to their short form.
      if (line === "origin/HEAD" || line.endsWith("/HEAD")) continue;
      const normalized = line.startsWith("origin/") ? line.slice("origin/".length) : line;
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      branches.push(normalized);
      if (branches.length >= MAX_BRANCHES) break;
    }
  } catch {
    warnings.push("could not list branches");
  }

  // Guarantee the current branch is in the list so the UI dropdown can show it.
  if (currentBranch !== "HEAD" && !branches.includes(currentBranch)) {
    branches.unshift(currentBranch);
  }

  let isDirty = false;
  try {
    const { stdout } = await execP(
      "git",
      ["-C", repoPath, "status", "--porcelain"],
      { timeout: GIT_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
    );
    isDirty = stdout.trim().length > 0;
  } catch {
    warnings.push("could not read working tree status");
  }

  let githubOwner: string | undefined;
  let githubRepo: string | undefined;
  let hasOrigin = false;
  try {
    const { stdout } = await execP(
      "git",
      ["-C", repoPath, "remote", "get-url", "origin"],
      { timeout: GIT_TIMEOUT_MS, maxBuffer: 1 * 1024 * 1024 },
    );
    const url = stdout.trim();
    if (url) {
      hasOrigin = true;
      const parsed = parseGithubRemote(url);
      if (parsed) {
        githubOwner = parsed.owner;
        githubRepo = parsed.repo;
      }
    }
  } catch {
    // no origin — fine, stays hasOrigin=false
  }

  return {
    path: repoPath,
    name,
    isWorktree,
    currentBranch,
    branches,
    isDirty,
    hasOrigin,
    ...(githubOwner ? { githubOwner } : {}),
    ...(githubRepo ? { githubRepo } : {}),
    ...(warnings.length ? { warnings } : {}),
  };
}
