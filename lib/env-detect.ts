import { promises as fs } from "node:fs";
import path from "node:path";

const EXAMPLE_FILES = [
  ".env.example",
  ".env.sample",
  ".env.template",
  ".env.local.example",
] as const;

const PUBLIC_PREFIXES = [
  "NEXT_PUBLIC_",
  "VITE_",
  "REACT_APP_",
  "EXPO_PUBLIC_",
  "PUBLIC_",
];

const ALWAYS_OK = new Set([
  "PORT",
  "NODE_ENV",
  "FORCE_COLOR",
  "BROWSER",
  "PATH",
  "HOME",
  "USER",
]);

export type EnvDetectSource = "env-example" | "code-scan" | "none";

export type EnvDetectResult = {
  required: string[];
  source: EnvDetectSource;
  exampleFile?: string;
  scannedFiles?: number;
};

export async function detectRequiredEnvVars(
  repoPath: string,
): Promise<EnvDetectResult> {
  const fromExample = await readEnvExample(repoPath);
  if (fromExample) {
    return {
      required: dedupe(fromExample.keys),
      source: "env-example",
      exampleFile: fromExample.file,
    };
  }
  const scanned = await scanCodeForEnvKeys(repoPath);
  if (scanned.keys.length > 0) {
    return {
      required: dedupe(scanned.keys),
      source: "code-scan",
      scannedFiles: scanned.files,
    };
  }
  return { required: [], source: "none" };
}

async function readEnvExample(
  repoPath: string,
): Promise<{ file: string; keys: string[] } | null> {
  for (const candidate of EXAMPLE_FILES) {
    const full = path.join(repoPath, candidate);
    try {
      const txt = await fs.readFile(full, "utf8");
      const keys = parseEnvKeys(txt);
      if (keys.length > 0) return { file: candidate, keys };
    } catch {
      // try next
    }
  }
  return null;
}

function parseEnvKeys(txt: string): string[] {
  const out: string[] = [];
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim().replace(/^export\s+/, "");
    if (!/^[A-Z_][A-Z0-9_]*$/i.test(key)) continue;
    if (ALWAYS_OK.has(key)) continue;
    out.push(key);
  }
  return out;
}

const ENV_PATTERNS = [
  /process\.env\.([A-Z_][A-Z0-9_]*)/g,
  /process\.env\[["']([A-Z_][A-Z0-9_]*)["']\]/g,
  /import\.meta\.env\.([A-Z_][A-Z0-9_]*)/g,
  /Deno\.env\.get\(["']([A-Z_][A-Z0-9_]*)["']\)/g,
  /os\.environ\.get\(["']([A-Z_][A-Z0-9_]*)["']\)/g,
  /os\.environ\[["']([A-Z_][A-Z0-9_]*)["']\]/g,
];

const SCAN_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".rb",
  ".go",
]);

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  "out",
  ".turbo",
  "coverage",
  ".vercel",
  ".pnpm-store",
  "__pycache__",
  ".venv",
  "venv",
]);

const MAX_FILES = 400;
const MAX_BYTES_PER_FILE = 256 * 1024;

async function scanCodeForEnvKeys(
  repoPath: string,
): Promise<{ keys: string[]; files: number }> {
  const found = new Set<string>();
  let filesScanned = 0;
  await walk(repoPath, async (file) => {
    if (filesScanned >= MAX_FILES) return;
    const ext = path.extname(file);
    if (!SCAN_EXTENSIONS.has(ext)) return;
    let txt: string;
    try {
      const stat = await fs.stat(file);
      if (stat.size > MAX_BYTES_PER_FILE) return;
      txt = await fs.readFile(file, "utf8");
    } catch {
      return;
    }
    filesScanned++;
    for (const pat of ENV_PATTERNS) {
      pat.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = pat.exec(txt)) !== null) {
        const key = m[1];
        if (!key || ALWAYS_OK.has(key)) continue;
        found.add(key);
      }
    }
  });
  return { keys: Array.from(found), files: filesScanned };
}

async function walk(
  dir: string,
  onFile: (file: string) => Promise<void>,
): Promise<void> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== ".env.example") {
      // Skip hidden dirs/files except those we explicitly handle (already done above).
      if (entry.isDirectory()) continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await walk(full, onFile);
    } else if (entry.isFile()) {
      await onFile(full);
    }
  }
}

function dedupe(keys: string[]): string[] {
  return Array.from(new Set(keys)).sort();
}

export function isLikelyOptional(key: string): boolean {
  // Public/client-side env vars are typically optional for dev (they default
  // to empty string and the app boots). Only flag them when explicitly
  // declared in .env.example.
  return PUBLIC_PREFIXES.some((p) => key.startsWith(p));
}

export function classifyMissing(
  required: string[],
  current: Record<string, string | undefined>,
): { hardMissing: string[]; softMissing: string[] } {
  const hard: string[] = [];
  const soft: string[] = [];
  for (const k of required) {
    const v = current[k];
    if (v && v.length > 0) continue;
    if (isLikelyOptional(k)) soft.push(k);
    else hard.push(k);
  }
  return { hardMissing: hard, softMissing: soft };
}
