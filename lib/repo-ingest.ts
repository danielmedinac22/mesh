import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import ignore from "ignore";

const execFileP = promisify(execFile);

export const INGEST_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".json",
  ".md",
  ".prisma",
  ".sql",
  ".yaml",
  ".yml",
  ".toml",
]);

const PRIORITY_EXTENSIONS = new Set([".ts", ".tsx", ".prisma", ".md"]);

const PER_FILE_LOC_CAP = 8_000;
const DEFAULT_TOKEN_BUDGET = 800_000;

// Always-ignored paths even if .gitignore doesn't list them.
const HARD_IGNORES = [
  "node_modules",
  ".next",
  ".git",
  "dist",
  "build",
  "out",
  ".turbo",
  ".vercel",
  ".cache",
  ".mesh",
  "coverage",
];

export type IngestedFile = {
  path: string;
  content: string;
  lines: number;
  truncated: boolean;
  ext: string;
};

export type IngestedRepo = {
  name: string;
  localPath: string;
  files: IngestedFile[];
  skippedByExtension: number;
  skippedCount: number;
  gitLog: string;
  adrs: { path: string; content: string }[];
};

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function estimateRepoTokens(repo: IngestedRepo): number {
  let chars = 0;
  for (const f of repo.files) chars += f.content.length;
  chars += repo.gitLog.length;
  for (const a of repo.adrs) chars += a.content.length;
  return Math.ceil(chars / 4);
}

async function loadIgnore(repoPath: string) {
  const ig = ignore();
  ig.add(HARD_IGNORES);
  try {
    const raw = await fs.readFile(path.join(repoPath, ".gitignore"), "utf8");
    ig.add(raw);
  } catch {
    // no .gitignore — fall back to hard ignores only
  }
  return ig;
}

async function walk(repoPath: string): Promise<string[]> {
  const ig = await loadIgnore(repoPath);
  const out: string[] = [];

  async function visit(rel: string) {
    const abs = path.join(repoPath, rel);
    let entries;
    try {
      entries = await fs.readdir(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const childRel = rel ? path.posix.join(rel, entry.name) : entry.name;
      const testPath = entry.isDirectory() ? `${childRel}/` : childRel;
      if (ig.ignores(testPath)) continue;
      if (entry.isDirectory()) {
        await visit(childRel);
      } else if (entry.isFile()) {
        out.push(childRel);
      }
    }
  }

  await visit("");
  return out;
}

async function readFileCapped(
  abs: string,
  cap: number,
): Promise<{ content: string; lines: number; truncated: boolean }> {
  const raw = await fs.readFile(abs, "utf8");
  const lines = raw.split("\n");
  if (lines.length <= cap) {
    return { content: raw, lines: lines.length, truncated: false };
  }
  const truncated =
    lines.slice(0, cap).join("\n") +
    `\n/* ... [truncated ${lines.length - cap} lines beyond ${cap} LOC cap] ... */\n`;
  return { content: truncated, lines: lines.length, truncated: true };
}

async function readGitLog(repoPath: string): Promise<string> {
  try {
    const { stdout } = await execFileP(
      "git",
      ["log", "--pretty=format:%h|%ad|%s", "--date=short", "-n", "40"],
      { cwd: repoPath, maxBuffer: 2 * 1024 * 1024 },
    );
    return stdout.trim();
  } catch {
    return "";
  }
}

async function readAdrs(
  repoPath: string,
): Promise<{ path: string; content: string }[]> {
  const dir = path.join(repoPath, "docs", "decisions");
  try {
    const entries = await fs.readdir(dir);
    const out: { path: string; content: string }[] = [];
    for (const name of entries) {
      if (!name.endsWith(".md")) continue;
      const abs = path.join(dir, name);
      const content = await fs.readFile(abs, "utf8");
      out.push({ path: path.posix.join("docs/decisions", name), content });
    }
    return out;
  } catch {
    return [];
  }
}

type IngestOptions = {
  priorityOnly?: boolean;
  perFileLocCap?: number;
};

async function ingestOne(
  repoPath: string,
  opts: IngestOptions = {},
): Promise<IngestedRepo> {
  const abs = path.resolve(repoPath);
  const stat = await fs.stat(abs).catch(() => null);
  if (!stat || !stat.isDirectory()) {
    throw new Error(`Repo path not found or not a directory: ${repoPath}`);
  }

  const paths = await walk(abs);
  const cap = opts.perFileLocCap ?? PER_FILE_LOC_CAP;
  const files: IngestedFile[] = [];
  let skippedByExtension = 0;

  for (const rel of paths) {
    const ext = path.extname(rel).toLowerCase();
    if (!INGEST_EXTENSIONS.has(ext)) {
      skippedByExtension++;
      continue;
    }
    if (opts.priorityOnly && !PRIORITY_EXTENSIONS.has(ext)) {
      skippedByExtension++;
      continue;
    }
    try {
      const { content, lines, truncated } = await readFileCapped(
        path.join(abs, rel),
        cap,
      );
      files.push({ path: rel, content, lines, truncated, ext });
    } catch {
      // skip unreadable
    }
  }

  const [gitLog, adrs] = await Promise.all([readGitLog(abs), readAdrs(abs)]);

  return {
    name: path.basename(abs),
    localPath: abs,
    files,
    skippedByExtension,
    skippedCount: skippedByExtension,
    gitLog,
    adrs,
  };
}

export async function ingestRepo(
  repoPath: string,
  opts: IngestOptions = {},
): Promise<IngestedRepo> {
  return ingestOne(repoPath, opts);
}

export type IngestResult = {
  repos: IngestedRepo[];
  totalTokens: number;
  degraded: boolean;
};

// Ingest every repo path. If the total exceeds `budget` tokens, re-ingest
// with priorityOnly=true (dropping JS/JSON/SQL/YAML/TOML) and a tighter
// LOC cap. Consumers cache the memory so this only runs once per Connect.
export async function ingestRepos(
  repoPaths: string[],
  budget: number = DEFAULT_TOKEN_BUDGET,
): Promise<IngestResult> {
  const repos = await Promise.all(repoPaths.map((p) => ingestOne(p)));
  const total = repos.reduce((sum, r) => sum + estimateRepoTokens(r), 0);
  if (total <= budget) {
    return { repos, totalTokens: total, degraded: false };
  }
  const degraded = await Promise.all(
    repoPaths.map((p) =>
      ingestOne(p, { priorityOnly: true, perFileLocCap: 2_000 }),
    ),
  );
  const degradedTotal = degraded.reduce(
    (sum, r) => sum + estimateRepoTokens(r),
    0,
  );
  return {
    repos: degraded,
    totalTokens: degradedTotal,
    degraded: true,
  };
}

// Render the ingest result into a single text blob suitable for placing
// in a cache_control: ephemeral system block. Each file is prefixed with
// its repo + relative path; long separators make it grep-able for the
// model when it wants to cite evidence.
export function renderIngestAsSystemBlock(result: IngestResult): string {
  const parts: string[] = [];
  parts.push(
    `# Mesh ingest dump — ${result.repos.length} repo(s), ~${result.totalTokens.toLocaleString()} tokens${
      result.degraded ? " (degraded: priority extensions only)" : ""
    }`,
  );
  for (const repo of result.repos) {
    parts.push("");
    parts.push(`==================== REPO: ${repo.name} ====================`);
    parts.push(`localPath: ${repo.localPath}`);
    parts.push(
      `files: ${repo.files.length} included · ${repo.skippedByExtension} skipped by extension`,
    );
    if (repo.gitLog) {
      parts.push("");
      parts.push(`--- git log (last 40) ---`);
      parts.push(repo.gitLog);
    }
    if (repo.adrs.length > 0) {
      parts.push("");
      parts.push(`--- ADRs (${repo.adrs.length}) ---`);
      for (const a of repo.adrs) {
        parts.push(`### ${a.path}`);
        parts.push(a.content);
      }
    }
    for (const f of repo.files) {
      parts.push("");
      parts.push(`----- ${repo.name}/${f.path}${f.truncated ? " [TRUNCATED]" : ""} -----`);
      parts.push(f.content);
    }
  }
  return parts.join("\n");
}
