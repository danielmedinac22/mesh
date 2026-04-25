import { spawn, type ChildProcess } from "node:child_process";
import { promises as fs } from "node:fs";
import net from "node:net";
import path from "node:path";
import { getRepoEnv } from "@/lib/mesh-state";

export type PreviewStatus =
  | "idle"
  | "installing"
  | "starting"
  | "ready"
  | "failed"
  | "stopped";

export type PreviewSession = {
  ticketId: string;
  repoName: string;
  cwd: string;
  pid: number;
  port: number;
  url: string;
  status: PreviewStatus;
  script: string;
  startedAt: string;
  logTail: string[];
  child?: ChildProcess;
};

const PORT_RANGE_START = 3100;
const PORT_RANGE_END = 3199;
const READY_REGEX =
  /(?:Local:|listening|started server on|ready - started server on|Server running|Listening on).{0,80}(?::(\d+)|http:\/\/[^:]+:(\d+))/i;
const LOG_TAIL_MAX = 200;

const sessions = new Map<string, PreviewSession>();

function key(ticketId: string, repoName: string): string {
  return `${ticketId}::${repoName}`;
}

export function getSession(
  ticketId: string,
  repoName: string,
): PreviewSession | null {
  return sessions.get(key(ticketId, repoName)) ?? null;
}

export function listSessions(): PreviewSession[] {
  return Array.from(sessions.values());
}

async function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net
      .createServer()
      .once("error", () => resolve(false))
      .once("listening", () => {
        srv.close(() => resolve(true));
      })
      .listen(port, "127.0.0.1");
  });
}

async function pickPort(): Promise<number> {
  const usedByPool = new Set(
    Array.from(sessions.values()).map((s) => s.port),
  );
  for (let p = PORT_RANGE_START; p <= PORT_RANGE_END; p += 1) {
    if (usedByPool.has(p)) continue;
    if (await isPortFree(p)) return p;
  }
  throw new Error(
    `no free preview port in ${PORT_RANGE_START}-${PORT_RANGE_END}`,
  );
}

async function readPackageScripts(
  cwd: string,
): Promise<Record<string, string>> {
  try {
    const raw = await fs.readFile(path.join(cwd, "package.json"), "utf8");
    const pkg = JSON.parse(raw) as { scripts?: Record<string, string> };
    return pkg.scripts ?? {};
  } catch {
    return {};
  }
}

function pickPreviewScript(scripts: Record<string, string>): string | null {
  const order = ["dev", "start:dev", "start", "preview", "serve"];
  for (const s of order) if (typeof scripts[s] === "string") return s;
  return null;
}

async function detectRunner(cwd: string): Promise<"pnpm" | "npm" | "yarn"> {
  const candidates: [string, "pnpm" | "npm" | "yarn"][] = [
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    ["package-lock.json", "npm"],
  ];
  for (const [file, runner] of candidates) {
    try {
      await fs.access(path.join(cwd, file));
      return runner;
    } catch {
      // continue
    }
  }
  return "pnpm";
}

async function hasNodeModules(cwd: string): Promise<boolean> {
  try {
    await fs.access(path.join(cwd, "node_modules"));
    return true;
  } catch {
    return false;
  }
}

function pushLog(session: PreviewSession, chunk: string): void {
  const lines = chunk.split(/\r?\n/);
  for (const line of lines) {
    if (!line) continue;
    session.logTail.push(line);
    if (session.logTail.length > LOG_TAIL_MAX) session.logTail.shift();
  }
}

function spawnChild(args: {
  cmd: string;
  cmdArgs: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}): ChildProcess {
  return spawn(args.cmd, args.cmdArgs, {
    cwd: args.cwd,
    env: args.env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });
}

export type StartArgs = {
  ticketId: string;
  repoName: string;
  cwd: string;
  onEvent?: (ev: PreviewEvent) => void;
};

export type PreviewEvent =
  | { type: "status"; status: PreviewStatus }
  | { type: "log"; chunk: string }
  | { type: "ready"; port: number; url: string }
  | { type: "failed"; reason: string };

export async function startPreview(
  args: StartArgs,
): Promise<PreviewSession> {
  const k = key(args.ticketId, args.repoName);
  const existing = sessions.get(k);
  if (existing && existing.status === "ready") return existing;
  if (existing) await stopPreview(args.ticketId, args.repoName).catch(() => null);

  const scripts = await readPackageScripts(args.cwd);
  const script = pickPreviewScript(scripts);
  if (!script) throw new Error(`${args.repoName}: no dev/start script in package.json`);

  const port = await pickPort();
  const runner = await detectRunner(args.cwd);
  const repoEnv = await getRepoEnv(args.repoName).catch(() => ({}));

  const session: PreviewSession = {
    ticketId: args.ticketId,
    repoName: args.repoName,
    cwd: args.cwd,
    pid: 0,
    port,
    url: `http://localhost:${port}`,
    status: "idle",
    script,
    startedAt: new Date().toISOString(),
    logTail: [],
  };
  sessions.set(k, session);

  const baseEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...repoEnv,
    PORT: String(port),
    NODE_ENV: "development",
    FORCE_COLOR: "0",
    BROWSER: "none",
  };

  if (!(await hasNodeModules(args.cwd))) {
    session.status = "installing";
    args.onEvent?.({ type: "status", status: "installing" });
    pushLog(session, `[mesh] installing deps with ${runner}…\n`);
    args.onEvent?.({ type: "log", chunk: `[mesh] installing deps with ${runner}…\n` });
    const installCode = await new Promise<number | null>((resolve) => {
      const child = spawnChild({
        cmd: runner,
        cmdArgs: ["install"],
        cwd: args.cwd,
        env: baseEnv,
      });
      const to = setTimeout(() => {
        pushLog(session, `[mesh] install timeout — killing.\n`);
        args.onEvent?.({ type: "log", chunk: "[mesh] install timeout — killing.\n" });
        child.kill("SIGKILL");
      }, 120_000);
      child.stdout?.on("data", (d) => {
        const s = d.toString();
        pushLog(session, s);
        args.onEvent?.({ type: "log", chunk: s });
      });
      child.stderr?.on("data", (d) => {
        const s = d.toString();
        pushLog(session, s);
        args.onEvent?.({ type: "log", chunk: s });
      });
      child.on("close", (code) => {
        clearTimeout(to);
        resolve(code);
      });
      child.on("error", () => {
        clearTimeout(to);
        resolve(null);
      });
    });
    if (installCode !== 0) {
      session.status = "failed";
      args.onEvent?.({ type: "status", status: "failed" });
      args.onEvent?.({ type: "failed", reason: `install exit ${installCode}` });
      return session;
    }
  }

  session.status = "starting";
  args.onEvent?.({ type: "status", status: "starting" });
  pushLog(session, `[mesh] running ${runner} ${script} on :${port}\n`);
  args.onEvent?.({
    type: "log",
    chunk: `[mesh] running ${runner} ${script} on :${port}\n`,
  });

  const cmdArgs =
    runner === "npm" ? ["run", script] : [script];
  const child = spawnChild({
    cmd: runner,
    cmdArgs,
    cwd: args.cwd,
    env: baseEnv,
  });
  session.child = child;
  session.pid = child.pid ?? 0;

  const onChunk = (s: string) => {
    pushLog(session, s);
    args.onEvent?.({ type: "log", chunk: s });
    if (session.status === "starting" && READY_REGEX.test(s)) {
      session.status = "ready";
      args.onEvent?.({ type: "status", status: "ready" });
      args.onEvent?.({ type: "ready", port: session.port, url: session.url });
    }
  };
  child.stdout?.on("data", (d) => onChunk(d.toString()));
  child.stderr?.on("data", (d) => onChunk(d.toString()));
  child.on("close", (code) => {
    if (session.status === "ready") {
      session.status = "stopped";
      args.onEvent?.({ type: "status", status: "stopped" });
    } else if (session.status !== "stopped") {
      session.status = "failed";
      args.onEvent?.({ type: "status", status: "failed" });
      args.onEvent?.({
        type: "failed",
        reason: `process exited with code ${code}`,
      });
    }
  });
  child.on("error", (err) => {
    session.status = "failed";
    args.onEvent?.({ type: "status", status: "failed" });
    args.onEvent?.({ type: "failed", reason: err.message });
  });

  // Soft watchdog: if it hasn't logged a "ready" marker in 30s, mark ready
  // anyway. Most dev servers are up by then; this prevents the UI from
  // hanging on frameworks with non-standard startup logs.
  setTimeout(() => {
    if (session.status === "starting") {
      session.status = "ready";
      args.onEvent?.({ type: "status", status: "ready" });
      args.onEvent?.({ type: "ready", port: session.port, url: session.url });
    }
  }, 30_000);

  return session;
}

export async function stopPreview(
  ticketId: string,
  repoName: string,
): Promise<boolean> {
  const k = key(ticketId, repoName);
  const session = sessions.get(k);
  if (!session) return false;
  session.status = "stopped";
  if (session.child && !session.child.killed) {
    try {
      session.child.kill("SIGTERM");
      // Force-kill if it doesn't exit in 3s. Some dev servers (Next, Vite)
      // ignore SIGTERM under specific configs.
      setTimeout(() => {
        if (session.child && !session.child.killed) {
          try {
            session.child.kill("SIGKILL");
          } catch {
            // ignore
          }
        }
      }, 3000);
    } catch {
      // ignore
    }
  }
  sessions.delete(k);
  return true;
}

export async function stopAllForTicket(ticketId: string): Promise<number> {
  let n = 0;
  for (const s of Array.from(sessions.values())) {
    if (s.ticketId !== ticketId) continue;
    if (await stopPreview(s.ticketId, s.repoName)) n += 1;
  }
  return n;
}

// Best-effort cleanup on process exit. Next.js dev server keeps the parent
// alive across requests, so children would otherwise leak.
let exitHooked = false;
export function ensureExitCleanup(): void {
  if (exitHooked) return;
  exitHooked = true;
  const handler = () => {
    for (const s of sessions.values()) {
      try {
        s.child?.kill("SIGKILL");
      } catch {
        // ignore
      }
    }
  };
  process.on("exit", handler);
  process.on("SIGINT", () => {
    handler();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    handler();
    process.exit(0);
  });
}
