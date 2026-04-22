import { exec, spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { promisify } from "node:util";
import path from "node:path";

const execP = promisify(exec);

function runWithStdin(
  cmd: string,
  args: string[],
  opts: { cwd: string; stdin: string; timeout?: number },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const to = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`timeout: ${cmd} ${args.join(" ")}`));
    }, opts.timeout ?? 15_000);
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (err) => {
      clearTimeout(to);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(to);
      if (code === 0) resolve({ stdout, stderr });
      else
        reject(
          new Error(
            `${cmd} ${args.join(" ")} failed (code ${code}): ${stderr || stdout}`,
          ),
        );
    });
    child.stdin.write(opts.stdin);
    child.stdin.end();
  });
}

export type BranchStatus = {
  repoName: string;
  repoPath: string;
  currentBranch: string;
  branches: string[];
  changedFiles: number;
  staged: number;
  ahead: number;
  behind: number;
  clean: boolean;
  error?: string;
};

async function run(
  cmd: string,
  cwd: string,
  opts: { timeout?: number } = {},
): Promise<{ stdout: string; stderr: string }> {
  return execP(cmd, {
    cwd,
    timeout: opts.timeout ?? 10_000,
    maxBuffer: 4 * 1024 * 1024,
  });
}

export async function getCurrentBranch(repoPath: string): Promise<string> {
  const { stdout } = await run("git rev-parse --abbrev-ref HEAD", repoPath);
  return stdout.trim();
}

export async function listBranches(repoPath: string): Promise<string[]> {
  const { stdout } = await run(
    "git for-each-ref --format='%(refname:short)' refs/heads",
    repoPath,
  );
  return stdout
    .split("\n")
    .map((l) => l.replace(/^'|'$/g, "").trim())
    .filter(Boolean);
}

export async function getStatus(
  repoPath: string,
  repoName: string,
): Promise<BranchStatus> {
  try {
    const [currentBranch, branches, porcelain, aheadBehind] = await Promise.all(
      [
        getCurrentBranch(repoPath),
        listBranches(repoPath),
        run("git status --porcelain", repoPath).then((r) => r.stdout),
        run("git rev-list --left-right --count HEAD...@{u} 2>/dev/null || echo 0\t0", repoPath)
          .then((r) => r.stdout.trim())
          .catch(() => "0\t0"),
      ],
    );

    const lines = porcelain.split("\n").filter((l) => l.length > 0);
    const changedFiles = lines.length;
    const staged = lines.filter((l) => l[0] !== " " && l[0] !== "?").length;
    const [aheadStr, behindStr] = aheadBehind.split(/\s+/);
    const ahead = Number(aheadStr) || 0;
    const behind = Number(behindStr) || 0;

    return {
      repoName,
      repoPath,
      currentBranch,
      branches,
      changedFiles,
      staged,
      ahead,
      behind,
      clean: changedFiles === 0,
    };
  } catch (err) {
    return {
      repoName,
      repoPath,
      currentBranch: "unknown",
      branches: [],
      changedFiles: 0,
      staged: 0,
      ahead: 0,
      behind: 0,
      clean: true,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function createBranch(
  repoPath: string,
  branchName: string,
  fromBranch?: string,
): Promise<void> {
  const existing = await listBranches(repoPath);
  if (existing.includes(branchName)) {
    await run(`git checkout ${shell(branchName)}`, repoPath);
    return;
  }
  const base = fromBranch
    ? ` ${shell(fromBranch)}`
    : "";
  await run(`git checkout -b ${shell(branchName)}${base}`, repoPath);
}

export function shell(s: string): string {
  if (!/^[A-Za-z0-9._/\\-]+$/.test(s)) {
    throw new Error(`unsafe git ref: ${s}`);
  }
  return s;
}

export function slugifyBranch(raw: string): string {
  const base = raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return `mesh/${base.slice(0, 60) || "change"}`;
}

export function resolveRepoPath(repo: {
  localPath: string;
}): string {
  return path.resolve(repo.localPath);
}

export async function readRepoFile(
  repoPath: string,
  relFile: string,
): Promise<string | null> {
  try {
    const abs = path.join(repoPath, relFile);
    if (!abs.startsWith(path.resolve(repoPath) + path.sep)) {
      throw new Error(`path escapes repo: ${relFile}`);
    }
    return await fs.readFile(abs, "utf8");
  } catch (err: unknown) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code?: string }).code === "ENOENT"
    ) {
      return null;
    }
    throw err;
  }
}

export async function writeRepoFile(
  repoPath: string,
  relFile: string,
  content: string,
): Promise<void> {
  const abs = path.join(repoPath, relFile);
  if (!abs.startsWith(path.resolve(repoPath) + path.sep)) {
    throw new Error(`path escapes repo: ${relFile}`);
  }
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, "utf8");
}

export async function stageFile(
  repoPath: string,
  relFile: string,
): Promise<void> {
  await run(`git add -- ${shell(relFile)}`, repoPath);
}

export async function commitAll(
  repoPath: string,
  message: string,
): Promise<string> {
  // Pass commit message via stdin (git commit -F -) to avoid any shell
  // quoting issues with backticks, quotes, or newlines in the rationale.
  await runWithStdin("git", ["commit", "-F", "-"], {
    cwd: repoPath,
    stdin: message,
  });
  const { stdout } = await run("git rev-parse HEAD", repoPath);
  return stdout.trim();
}

export async function hasUnstagedChanges(repoPath: string): Promise<boolean> {
  const { stdout } = await run("git status --porcelain", repoPath);
  return stdout.trim().length > 0;
}

export async function pushCurrentBranch(
  repoPath: string,
): Promise<{ pushed: boolean; reason?: string }> {
  try {
    await run("git remote get-url origin", repoPath);
  } catch {
    return { pushed: false, reason: "no origin remote" };
  }
  try {
    await run("git push -u origin HEAD", repoPath, { timeout: 60_000 });
    return { pushed: true };
  } catch (err) {
    return {
      pushed: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function getRemoteOwnerRepo(
  repoPath: string,
): Promise<{ owner: string; repo: string } | null> {
  try {
    const { stdout } = await run("git remote get-url origin", repoPath);
    return parseGithubRemote(stdout.trim());
  } catch {
    return null;
  }
}

export function parseGithubRemote(
  url: string,
): { owner: string; repo: string } | null {
  // Supports git@github.com:owner/repo(.git) and https://github.com/owner/repo(.git)
  const ssh = url.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (ssh) return { owner: ssh[1], repo: ssh[2] };
  const https = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/)?$/);
  if (https) return { owner: https[1], repo: https[2] };
  return null;
}
