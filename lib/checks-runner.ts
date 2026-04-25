import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

export type CheckEvent =
  | { type: "check-start"; script: string }
  | { type: "check-output"; script: string; chunk: string }
  | {
      type: "check-done";
      script: string;
      status: "ok" | "fail" | "skipped";
      code: number | null;
      duration_ms: number;
    };

const TARGET_SCRIPTS = ["typecheck", "lint"] as const;
export type CheckScript = (typeof TARGET_SCRIPTS)[number];

const DEFAULT_TIMEOUT = 90_000;

async function readPackageScripts(
  cwd: string,
): Promise<Record<string, string> | null> {
  try {
    const raw = await fs.readFile(path.join(cwd, "package.json"), "utf8");
    const pkg = JSON.parse(raw) as { scripts?: Record<string, string> };
    return pkg.scripts ?? {};
  } catch {
    return null;
  }
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

export async function listAvailableChecks(cwd: string): Promise<CheckScript[]> {
  const scripts = await readPackageScripts(cwd);
  if (!scripts) return [];
  return TARGET_SCRIPTS.filter((s) => typeof scripts[s] === "string");
}

// Run typecheck + lint in series, streaming each event to onEvent. Stops at
// the first failure? — no: we run both so the user sees full picture.
export async function runRepoChecks(args: {
  cwd: string;
  onEvent: (ev: CheckEvent) => void;
  timeoutMs?: number;
}): Promise<void> {
  const scripts = await readPackageScripts(args.cwd);
  if (!scripts) {
    for (const s of TARGET_SCRIPTS) {
      args.onEvent({
        type: "check-done",
        script: s,
        status: "skipped",
        code: null,
        duration_ms: 0,
      });
    }
    return;
  }

  const runner = await detectRunner(args.cwd);

  for (const script of TARGET_SCRIPTS) {
    if (typeof scripts[script] !== "string") {
      args.onEvent({
        type: "check-done",
        script,
        status: "skipped",
        code: null,
        duration_ms: 0,
      });
      continue;
    }

    args.onEvent({ type: "check-start", script });
    const startedAt = Date.now();
    try {
      const code = await runScript({
        runner,
        script,
        cwd: args.cwd,
        onChunk: (chunk) =>
          args.onEvent({ type: "check-output", script, chunk }),
        timeoutMs: args.timeoutMs ?? DEFAULT_TIMEOUT,
      });
      args.onEvent({
        type: "check-done",
        script,
        status: code === 0 ? "ok" : "fail",
        code,
        duration_ms: Date.now() - startedAt,
      });
    } catch (err) {
      args.onEvent({
        type: "check-output",
        script,
        chunk: `\n[mesh] check crashed: ${
          err instanceof Error ? err.message : String(err)
        }\n`,
      });
      args.onEvent({
        type: "check-done",
        script,
        status: "fail",
        code: null,
        duration_ms: Date.now() - startedAt,
      });
    }
  }
}

function runScript(args: {
  runner: "pnpm" | "npm" | "yarn";
  script: string;
  cwd: string;
  onChunk: (chunk: string) => void;
  timeoutMs: number;
}): Promise<number | null> {
  const cmdArgs =
    args.runner === "npm" ? ["run", args.script] : [args.script];
  return new Promise((resolve) => {
    const child = spawn(args.runner, cmdArgs, {
      cwd: args.cwd,
      env: { ...process.env, CI: "1", FORCE_COLOR: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const to = setTimeout(() => {
      args.onChunk(`\n[mesh] timeout after ${args.timeoutMs}ms — killing.\n`);
      child.kill("SIGKILL");
    }, args.timeoutMs);
    child.stdout.on("data", (d) => args.onChunk(d.toString()));
    child.stderr.on("data", (d) => args.onChunk(d.toString()));
    child.on("close", (code) => {
      clearTimeout(to);
      resolve(code);
    });
    child.on("error", (err) => {
      clearTimeout(to);
      args.onChunk(`\n[mesh] spawn error: ${err.message}\n`);
      resolve(null);
    });
  });
}
