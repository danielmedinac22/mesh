import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

const DEFAULT_TIMEOUT = 30_000;

export class GhError extends Error {
  constructor(
    message: string,
    public readonly stderr: string,
    public readonly code: number | null,
  ) {
    super(message);
  }
}

export async function gh(
  args: string[],
  opts: { cwd?: string; timeout?: number } = {},
): Promise<string> {
  try {
    const { stdout } = await execFileP("gh", args, {
      cwd: opts.cwd,
      maxBuffer: 20 * 1024 * 1024,
      timeout: opts.timeout ?? DEFAULT_TIMEOUT,
    });
    return stdout;
  } catch (err) {
    const e = err as { stderr?: string; code?: number; message: string };
    const stderr = e.stderr ?? "";
    const msg = stderr.split("\n")[0] || e.message;
    throw new GhError(msg, stderr, e.code ?? null);
  }
}

export async function ghJson<T = unknown>(
  args: string[],
  opts?: { cwd?: string; timeout?: number },
): Promise<T> {
  const out = await gh(args, opts);
  return JSON.parse(out) as T;
}

export type GhAuthStatus =
  | { state: "signed-in"; user: string }
  | { state: "signed-out"; error: string }
  | { state: "not-installed"; error: string };

function isMissingBinary(err: unknown): boolean {
  const e = err as { code?: string; stderr?: string };
  if (e?.code === "ENOENT") return true;
  if (typeof e?.stderr === "string" && /command not found|not recognized/i.test(e.stderr)) {
    return true;
  }
  return false;
}

export async function ghInstalled(): Promise<boolean> {
  try {
    await gh(["--version"]);
    return true;
  } catch (err) {
    if (isMissingBinary(err)) return false;
    // If `gh --version` actually succeeded and failed for another reason, treat as installed.
    return true;
  }
}

export async function ghAuthStatus(): Promise<GhAuthStatus> {
  try {
    const login = (await gh(["api", "user", "--jq", ".login"])).trim();
    if (!login) return { state: "signed-out", error: "no login returned" };
    return { state: "signed-in", user: login };
  } catch (err) {
    if (isMissingBinary(err)) {
      return {
        state: "not-installed",
        error: "gh CLI not found on PATH",
      };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { state: "signed-out", error: msg };
  }
}

/**
 * Accepts any of:
 *   owner/repo
 *   https://github.com/owner/repo
 *   https://github.com/owner/repo.git
 *   https://github.com/owner/repo/tree/main/...
 *   git@github.com:owner/repo.git
 *   ssh://git@github.com/owner/repo.git
 * Returns null if it can't extract a valid owner/repo pair.
 */
export function parseGithubRef(
  input: string,
): { owner: string; repo: string } | null {
  const s = input.trim();
  if (!s) return null;
  const urlMatch = s.match(/github\.com[:/]+([A-Za-z0-9][\w.-]*)\/([A-Za-z0-9][\w.-]*?)(?:\.git|\/|$|#|\?)/);
  if (urlMatch) {
    return { owner: urlMatch[1], repo: urlMatch[2].replace(/\.git$/, "") };
  }
  const pairMatch = s.match(/^([A-Za-z0-9][\w.-]*)\/([A-Za-z0-9][\w.-]*)$/);
  if (pairMatch) {
    return { owner: pairMatch[1], repo: pairMatch[2].replace(/\.git$/, "") };
  }
  return null;
}

export async function ghToken(): Promise<string | null> {
  try {
    return (await gh(["auth", "token"])).trim() || null;
  } catch {
    return null;
  }
}
