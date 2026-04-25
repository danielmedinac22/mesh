import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
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

// ── gh auth login flows ────────────────────────────────────────────────────

export type DeviceFlowEvent =
  | { kind: "code"; code: string; verifyUrl: string }
  | { kind: "log"; line: string }
  | { kind: "done" }
  | { kind: "error"; message: string };

export type DeviceFlowHandle = {
  events: AsyncIterable<DeviceFlowEvent>;
  cancel: () => void;
};

// Singleton: only one device flow at a time. Cancels any prior in-flight.
let activeFlow: ChildProcessWithoutNullStreams | null = null;

export function cancelDeviceFlow() {
  if (activeFlow && !activeFlow.killed) {
    try {
      activeFlow.kill("SIGTERM");
    } catch {
      /* ignore */
    }
  }
  activeFlow = null;
}

/**
 * Spawns `gh auth login --web` and exposes parsed device-flow events.
 * Caller MUST consume `events` and call `cancel()` when the consumer disconnects.
 *
 * Strategy:
 *   - Pre-feeds `\n` to stdin so the "Press Enter to open in browser" prompt
 *     resolves immediately even without a TTY.
 *   - Watches stderr for the XXXX-XXXX one-time code; emits {kind:"code"}.
 *   - On exit(0) emits {kind:"done"}; on non-zero exit emits {kind:"error"}.
 *   - 10-minute hard timeout; kills the child and emits an error event.
 */
export function startDeviceFlow(): DeviceFlowHandle {
  cancelDeviceFlow();

  const child = spawn(
    "gh",
    [
      "auth",
      "login",
      "--web",
      "--hostname",
      "github.com",
      "--git-protocol",
      "https",
    ],
    {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, NO_COLOR: "1", BROWSER: "" },
    },
  );
  activeFlow = child;

  // Push to consumers via async iterator backed by a queue.
  const queue: DeviceFlowEvent[] = [];
  let resolver:
    | ((r: IteratorResult<DeviceFlowEvent>) => void)
    | null = null;
  let finished = false;
  let codeEmitted = false;

  function push(ev: DeviceFlowEvent) {
    if (finished) return;
    if (resolver) {
      const r = resolver;
      resolver = null;
      r({ value: ev, done: false });
    } else {
      queue.push(ev);
    }
  }

  function finish() {
    if (finished) return;
    finished = true;
    if (resolver) {
      const r = resolver;
      resolver = null;
      r({ value: undefined as unknown as DeviceFlowEvent, done: true });
    }
    if (activeFlow === child) activeFlow = null;
  }

  // Feed Enter so the "press enter to open in browser" prompt resolves.
  try {
    child.stdin.write("\n");
    // Keep stdin open in case gh asks again, but write a few extra newlines.
    child.stdin.write("\n");
  } catch {
    /* ignore */
  }

  const codeRe = /\b([A-Z0-9]{4}-[A-Z0-9]{4})\b/;
  const urlRe = /(https?:\/\/[^\s]+)/;

  function handleChunk(buf: Buffer) {
    const text = buf.toString();
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
      push({ kind: "log", line });
      if (!codeEmitted) {
        const m = line.match(codeRe);
        if (m) {
          const urlMatch = text.match(urlRe);
          const verifyUrl = urlMatch
            ? urlMatch[1]
            : "https://github.com/login/device";
          codeEmitted = true;
          push({ kind: "code", code: m[1], verifyUrl });
        }
      }
    }
  }

  child.stdout.on("data", handleChunk);
  child.stderr.on("data", handleChunk);

  child.on("error", (err) => {
    push({ kind: "error", message: err.message });
    finish();
  });

  child.on("exit", (code) => {
    if (code === 0) push({ kind: "done" });
    else
      push({
        kind: "error",
        message: `gh exited with code ${code ?? "null"}`,
      });
    finish();
  });

  const timeout = setTimeout(
    () => {
      if (!finished) {
        push({ kind: "error", message: "device flow timed out after 10m" });
        try {
          child.kill("SIGTERM");
        } catch {
          /* ignore */
        }
        finish();
      }
    },
    10 * 60 * 1000,
  );

  child.on("exit", () => clearTimeout(timeout));

  const events: AsyncIterable<DeviceFlowEvent> = {
    [Symbol.asyncIterator]() {
      return {
        next(): Promise<IteratorResult<DeviceFlowEvent>> {
          if (queue.length > 0) {
            return Promise.resolve({ value: queue.shift()!, done: false });
          }
          if (finished) {
            return Promise.resolve({
              value: undefined as unknown as DeviceFlowEvent,
              done: true,
            });
          }
          return new Promise((res) => {
            resolver = res;
          });
        },
        return(): Promise<IteratorResult<DeviceFlowEvent>> {
          // Consumer disconnected — cancel.
          if (!finished) {
            try {
              child.kill("SIGTERM");
            } catch {
              /* ignore */
            }
          }
          finish();
          return Promise.resolve({
            value: undefined as unknown as DeviceFlowEvent,
            done: true,
          });
        },
      };
    },
  };

  return {
    events,
    cancel: () => {
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
      finish();
    },
  };
}

/** Login non-interactively with a Personal Access Token via stdin. */
export async function loginWithToken(token: string): Promise<void> {
  if (!token.trim()) throw new Error("token is empty");
  const trimmed = token.trim();
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      "gh",
      ["auth", "login", "--with-token", "--hostname", "github.com"],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    let stderr = "";
    child.stderr.on("data", (b) => (stderr += b.toString()));
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new GhError(`gh login failed (${code})`, stderr, code));
    });
    child.stdin.write(trimmed + "\n");
    child.stdin.end();
  });
}

export async function ghLogout(): Promise<void> {
  // `gh auth logout --hostname github.com` requires confirm; -y suppresses it.
  await gh(["auth", "logout", "--hostname", "github.com"]).catch(async (err) => {
    // Older gh versions may not support confirm prompt; try fallback flag.
    if (err instanceof GhError && /confirm/i.test(err.stderr)) {
      await gh(["auth", "logout", "--hostname", "github.com", "-y"]);
      return;
    }
    throw err;
  });
}
