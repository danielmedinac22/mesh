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
const LOG_TAIL_MAX = 500;

// Patterns the dev-server log might emit. We try them in order on each
// chunk; first match wins. Each returns `{ port, scheme }` if it can
// pin down a bound port. Scheme is "http" unless explicitly HTTPS.
const URL_PATTERNS: Array<{
  re: RegExp;
  pick: (m: RegExpMatchArray) => { port: number; scheme: "http" | "https" };
}> = [
  // Explicit URL — Vite, Rsbuild, Next.js, etc.
  {
    re: /(https?):\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{2,5})/i,
    pick: (m) => ({
      port: parseInt(m[2], 10),
      scheme: m[1].toLowerCase() === "https" ? "https" : "http",
    }),
  },
  // Rsbuild fallback message: `info port 3000 is in use, using port 3014.`
  {
    re: /\busing port (\d{2,5})\b/i,
    pick: (m) => ({ port: parseInt(m[1], 10), scheme: "http" }),
  },
  // Express / Fastify / generic: `Listening on port 3000` / `Server running on :3000`
  {
    re: /(?:listening|started server|ready|Server running)[\s\S]{0,40}?(?:port\s+|:)(\d{4,5})/i,
    pick: (m) => ({ port: parseInt(m[1], 10), scheme: "http" }),
  },
];

function detectBoundUrl(
  chunk: string,
): { port: number; scheme: "http" | "https" } | null {
  for (const { re, pick } of URL_PATTERNS) {
    const m = chunk.match(re);
    if (m) return pick(m);
  }
  return null;
}

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

export type ComposeMode = "full" | "deps-only";

export type StartArgs = {
  ticketId: string;
  repoName: string;
  cwd: string;
  // For repos that run via docker-compose: "deps-only" runs ONLY services
  // without a `build:` directive (db, redis, etc. that pull public images).
  // Useful when the buildable services need creds/network the user lacks.
  composeMode?: ComposeMode;
  onEvent?: (ev: PreviewEvent) => void;
};

export type FailKind =
  | "no-script"
  | "install"
  | "start"
  | "ready-timeout"
  | "docker-not-running"
  | "docker-compose-failed";

export type PreviewEvent =
  | { type: "status"; status: PreviewStatus }
  | { type: "log"; chunk: string }
  | { type: "ready"; port: number; url: string }
  | { type: "failed"; reason: string; failKind?: FailKind };

async function findComposeFile(cwd: string): Promise<string | null> {
  for (const f of ["docker-compose.yml", "docker-compose.yaml", "compose.yml"]) {
    try {
      await fs.access(path.join(cwd, f));
      return f;
    } catch {
      // continue
    }
  }
  return null;
}

type ComposeService = { name: string; hasBuild: boolean };

async function parseComposeServices(
  cwd: string,
  composeFile: string,
): Promise<ComposeService[]> {
  const raw = await fs
    .readFile(path.join(cwd, composeFile), "utf8")
    .catch(() => "");
  const services: ComposeService[] = [];
  const lines = raw.split(/\r?\n/);
  let inServices = false;
  let current: ComposeService | null = null;
  for (const line of lines) {
    if (/^services:\s*$/.test(line)) {
      inServices = true;
      continue;
    }
    if (!inServices) continue;
    if (/^\S/.test(line) && line.length > 0) break;
    const svcMatch = line.match(/^ {2}([A-Za-z0-9_.-]+):\s*$/);
    if (svcMatch) {
      if (current) services.push(current);
      current = { name: svcMatch[1], hasBuild: false };
      continue;
    }
    if (!current) continue;
    if (/^ {4}build:\s*(\S.*)?$/.test(line)) {
      current.hasBuild = true;
    }
  }
  if (current) services.push(current);
  return services;
}

async function dockerIsRunning(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("docker", ["info"], { stdio: "ignore" });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

export async function startPreview(
  args: StartArgs,
): Promise<PreviewSession> {
  const k = key(args.ticketId, args.repoName);
  const existing = sessions.get(k);
  if (existing && existing.status === "ready") return existing;
  if (existing) await stopPreview(args.ticketId, args.repoName).catch(() => null);

  const scripts = await readPackageScripts(args.cwd);
  const script = pickPreviewScript(scripts);
  const composeFile = await findComposeFile(args.cwd);

  // Dispatch by runner kind: prefer Node script when present, fall back to
  // docker-compose when only a compose file exists. If neither, fail with
  // a clear actionable message.
  if (!script && composeFile) {
    return startComposePreview(args, composeFile);
  }
  if (!script) {
    const session = makeSession(args, 0);
    sessions.set(k, session);
    session.status = "failed";
    args.onEvent?.({ type: "status", status: "failed" });
    args.onEvent?.({
      type: "failed",
      failKind: "no-script",
      reason:
        "no dev/start script in package.json and no docker-compose file detected",
    });
    return session;
  }

  const port = await pickPort();
  const runner = await detectRunner(args.cwd);
  const repoEnv = await getRepoEnv(args.repoName).catch(() => ({}));

  const session = makeSession(args, port, script);
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
      args.onEvent?.({
        type: "failed",
        failKind: "install",
        reason: `install exit ${installCode}`,
      });
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
    if (session.status !== "starting") return;
    const hit = detectBoundUrl(s);
    if (!hit) return;
    // Many dev servers (Vite, webpack, rsbuild, express…) ignore PORT and
    // bind whatever their config says. Trust the log line over the port
    // we assigned so the URL we surface is the one the user can hit.
    if (hit.port !== session.port || hit.scheme === "https") {
      pushLog(
        session,
        `[mesh] dev server bound to ${hit.scheme}://localhost:${hit.port} (we asked for :${session.port}). using ${hit.scheme}://localhost:${hit.port}.\n`,
      );
      args.onEvent?.({
        type: "log",
        chunk: `[mesh] dev server bound to ${hit.scheme}://localhost:${hit.port}.\n`,
      });
    }
    session.port = hit.port;
    session.url = `${hit.scheme}://localhost:${hit.port}`;
    session.status = "ready";
    args.onEvent?.({ type: "status", status: "ready" });
    args.onEvent?.({ type: "ready", port: session.port, url: session.url });
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
        failKind: "start",
        reason: `process exited with code ${code}`,
      });
    }
  });
  child.on("error", (err) => {
    session.status = "failed";
    args.onEvent?.({ type: "status", status: "failed" });
    args.onEvent?.({ type: "failed", failKind: "start", reason: err.message });
  });

  // Soft watchdog: if it hasn't logged a "ready" marker in 60s, only mark
  // ready if SOMETHING bound a port in our range. Otherwise leave as
  // starting — the user shouldn't see "ready" with a dead URL.
  setTimeout(async () => {
    if (session.status !== "starting") return;
    const ourFree = await isPortFree(session.port);
    if (!ourFree) {
      // Our assigned port is bound — likely by this child.
      session.status = "ready";
      args.onEvent?.({ type: "status", status: "ready" });
      args.onEvent?.({ type: "ready", port: session.port, url: session.url });
      return;
    }
    // Try to find ANY port the child bound to in 3000-3199 (covers
    // hardcoded MFE configs that ignore PORT).
    for (let p = 3000; p <= 3199; p += 1) {
      if (p === session.port) continue;
      if (Array.from(sessions.values()).some((s) => s.port === p)) continue;
      if (!(await isPortFree(p))) {
        pushLog(
          session,
          `[mesh] watchdog detected a bound port at :${p} (we asked for :${session.port}). using :${p}.\n`,
        );
        args.onEvent?.({
          type: "log",
          chunk: `[mesh] watchdog detected a bound port at :${p}. using :${p}.\n`,
        });
        session.port = p;
        session.url = `http://localhost:${p}`;
        session.status = "ready";
        args.onEvent?.({ type: "status", status: "ready" });
        args.onEvent?.({ type: "ready", port: p, url: session.url });
        return;
      }
    }
    // Nothing bound yet — keep waiting. The user can stop manually if
    // the process is genuinely stuck.
    pushLog(
      session,
      `[mesh] watchdog: no bound port detected after 60s. process is still starting.\n`,
    );
    args.onEvent?.({
      type: "log",
      chunk: `[mesh] watchdog: no bound port detected after 60s. process is still starting.\n`,
    });
  }, 60_000);

  return session;
}

function makeSession(
  args: StartArgs,
  port: number,
  script: string = "",
): PreviewSession {
  return {
    ticketId: args.ticketId,
    repoName: args.repoName,
    cwd: args.cwd,
    pid: 0,
    port,
    url: port > 0 ? `http://localhost:${port}` : "",
    status: "idle",
    script,
    startedAt: new Date().toISOString(),
    logTail: [],
  };
}

// ────────────────────────────────────────────────────────────────────────
// docker-compose runner
// Used when a repo has no Node script but defines docker-compose.{yml,yaml}.
// We run `docker compose up -d` (services daemonize), mark ready when up
// exits 0, and stream logs via `docker compose logs -f --tail=100` in the
// background. Stop runs `docker compose down`.
// Caveats: ports are defined inside compose; we don't pick one — `url` stays
// empty. If Docker isn't running, fail fast with a clear message.
// ────────────────────────────────────────────────────────────────────────

async function startComposePreview(
  args: StartArgs,
  composeFile: string,
): Promise<PreviewSession> {
  const k = key(args.ticketId, args.repoName);
  const session = makeSession(args, 0, `docker compose -f ${composeFile} up`);
  sessions.set(k, session);

  args.onEvent?.({ type: "status", status: "starting" });

  if (!(await dockerIsRunning())) {
    session.status = "failed";
    args.onEvent?.({ type: "status", status: "failed" });
    args.onEvent?.({
      type: "failed",
      failKind: "docker-not-running",
      reason:
        "docker daemon is not running. Start Docker Desktop and click Start again.",
    });
    return session;
  }

  const repoEnv = await getRepoEnv(args.repoName).catch(() => ({}));
  const baseEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...repoEnv,
    FORCE_COLOR: "0",
    // Force plaintext build output so real RUN/COPY errors land in the
    // tail instead of BuildKit's TTY-style progress bar that mostly emits
    // unicode/ANSI noise we can't parse.
    BUILDKIT_PROGRESS: "plain",
    DOCKER_BUILDKIT: "1",
  };

  // docker-compose's `env_file:` directive reads a `.env` from disk inside
  // the repo. Mesh stores env vars in `.mesh/repos/<name>/.env.json` so we
  // need to materialize them as a real file before `compose up`. We only
  // write if `.env` is missing (don't clobber the user's real file). The
  // file is removed during stopPreview if we created it.
  const envPath = path.join(args.cwd, ".env");
  let wroteEnvFile = false;
  if (Object.keys(repoEnv).length > 0) {
    let envExists = true;
    try {
      await fs.access(envPath);
    } catch {
      envExists = false;
    }
    if (!envExists) {
      // Compose interpolates `${VAR}` from this .env file. Conventionally
      // those are UPPERCASE, but users sometimes import vars in mixed
      // case (e.g. from ~/.aws/credentials). For each lowercase key, add
      // an uppercase alias if one doesn't already exist — so compose
      // build args like `${AWS_ACCESS_KEY_ID}` resolve.
      const merged: Record<string, string> = { ...repoEnv };
      let aliased = 0;
      for (const [k, v] of Object.entries(repoEnv)) {
        const upper = k.toUpperCase();
        if (upper !== k && !(upper in merged)) {
          merged[upper] = v;
          aliased += 1;
        }
      }
      const lines = Object.entries(merged).map(
        ([k, v]) => `${k}=${String(v).replace(/\n/g, "\\n")}`,
      );
      await fs.writeFile(envPath, lines.join("\n") + "\n", "utf8");
      wroteEnvFile = true;
      pushLog(
        session,
        `[mesh] wrote ${lines.length} env vars to .env${aliased > 0 ? ` (+${aliased} uppercase aliases for compose interpolation)` : ""}.\n`,
      );
      args.onEvent?.({
        type: "log",
        chunk: `[mesh] wrote ${lines.length} env vars to .env${aliased > 0 ? ` (+${aliased} uppercase aliases)` : ""}.\n`,
      });
    }
  }
  // Track whether mesh created the .env so we know to clean it up later.
  (session as PreviewSession & { meshWroteEnv?: boolean }).meshWroteEnv =
    wroteEnvFile;

  // Build the set of services to bring up. In "deps-only" mode we skip
  // anything with a `build:` directive (typically the user's app code,
  // which often needs private-registry creds the user might not have).
  // What's left are public-image services like postgres/redis — usually
  // enough to do local dev iteration with the repo running outside docker.
  const allServices = await parseComposeServices(args.cwd, composeFile);
  const mode: ComposeMode = args.composeMode ?? "full";
  const targetServices =
    mode === "deps-only"
      ? allServices.filter((s) => !s.hasBuild).map((s) => s.name)
      : [];
  if (mode === "deps-only" && targetServices.length === 0) {
    session.status = "failed";
    args.onEvent?.({ type: "status", status: "failed" });
    args.onEvent?.({
      type: "failed",
      failKind: "docker-compose-failed",
      reason:
        "deps-only requested but no services without `build:` were found in compose.",
    });
    return session;
  }

  const targetSummary =
    mode === "deps-only" ? ` ${targetServices.join(" ")}` : "";
  pushLog(
    session,
    `[mesh] docker compose -f ${composeFile} up -d${targetSummary} (mode=${mode})\n`,
  );
  args.onEvent?.({
    type: "log",
    chunk: `[mesh] docker compose -f ${composeFile} up -d${targetSummary} (mode=${mode})\n`,
  });

  const upCode = await new Promise<number | null>((resolve) => {
    // --progress=plain forces line-oriented output (BuildKit otherwise
    // emits TTY progress that scrolls past the failing RUN/COPY step).
    // --build rebuilds images so the user's local code is reflected and
    // any Dockerfile errors surface immediately rather than silently
    // running a stale image.
    // Note: `--progress=plain` is rejected by some compose-plugin versions
    // on `up`. We rely on the BUILDKIT_PROGRESS=plain env var (set in
    // baseEnv) to achieve the same effect via BuildKit directly.
    const cmdArgs = [
      "compose",
      "-f",
      composeFile,
      "up",
      "-d",
      "--build",
      ...targetServices,
    ];
    const child = spawnChild({
      cmd: "docker",
      cmdArgs,
      cwd: args.cwd,
      env: baseEnv,
    });
    const to = setTimeout(() => {
      pushLog(session, `[mesh] docker compose up timeout — sending SIGKILL.\n`);
      args.onEvent?.({
        type: "log",
        chunk: "[mesh] docker compose up timeout — sending SIGKILL.\n",
      });
      child.kill("SIGKILL");
    }, 180_000);
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

  if (upCode !== 0) {
    session.status = "failed";
    args.onEvent?.({ type: "status", status: "failed" });
    args.onEvent?.({
      type: "failed",
      failKind: "docker-compose-failed",
      reason: `docker compose up exit ${upCode}`,
    });
    return session;
  }

  session.status = "ready";
  args.onEvent?.({ type: "status", status: "ready" });
  args.onEvent?.({ type: "ready", port: 0, url: "" });

  // Tail logs in the background so the UI stays live. The child handle on
  // session.child is for the `logs -f` process; stop will kill it AND run
  // `docker compose down`.
  const logsChild = spawnChild({
    cmd: "docker",
    cmdArgs: ["compose", "-f", composeFile, "logs", "-f", "--tail=100"],
    cwd: args.cwd,
    env: baseEnv,
  });
  session.child = logsChild;
  session.pid = logsChild.pid ?? 0;
  logsChild.stdout?.on("data", (d) => {
    const s = d.toString();
    pushLog(session, s);
    args.onEvent?.({ type: "log", chunk: s });
  });
  logsChild.stderr?.on("data", (d) => {
    const s = d.toString();
    pushLog(session, s);
    args.onEvent?.({ type: "log", chunk: s });
  });

  return session;
}

// Tear compose stack down when the user stops a docker-compose session.
async function teardownCompose(cwd: string, composeFile: string): Promise<void> {
  await new Promise<void>((resolve) => {
    const child = spawn(
      "docker",
      ["compose", "-f", composeFile, "down"],
      { cwd, stdio: "ignore" },
    );
    child.on("close", () => resolve());
    child.on("error", () => resolve());
  });
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
  // Compose sessions also need `docker compose down` to release containers,
  // ports and volumes — killing the `logs -f` child only stops streaming.
  if (session.script.startsWith("docker compose")) {
    const composeFile = await findComposeFile(session.cwd);
    if (composeFile) {
      await teardownCompose(session.cwd, composeFile).catch(() => null);
    }
    // Remove the .env file Mesh wrote (we don't touch user-owned ones).
    const meta = session as PreviewSession & { meshWroteEnv?: boolean };
    if (meta.meshWroteEnv) {
      await fs
        .unlink(path.join(session.cwd, ".env"))
        .catch(() => null);
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
