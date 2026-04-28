import { promises as fs } from "node:fs";
import path from "node:path";
import { detectRequiredEnvVars, type EnvDetectResult } from "@/lib/env-detect";

export type PackageManager = "pnpm" | "npm" | "yarn" | "bun";

export type FederationHint = {
  kind: "module-federation" | "vite-federation" | "single-spa";
  file: string;
  remotes?: string[]; // hostnames or remote names referenced
};

export type MonorepoHint = {
  tool: "nx" | "turbo" | "lerna" | "pnpm-workspace";
  file: string;
};

export type DockerComposeService = {
  name: string;
  // True when the service has a `build:` directive — those need a working
  // build context (Dockerfile, possibly with private-registry creds, etc.)
  // and frequently fail in restricted environments. Mesh splits compose
  // into "deps-only" (no build) and "full" runs based on this flag.
  hasBuild: boolean;
  image?: string; // pulled when hasBuild=false
};

export type DockerComposeHint = {
  file: string;
  // Backwards-compat: list of service names. New consumers should prefer
  // `serviceList` which carries the `hasBuild` flag.
  services: string[];
  serviceList: DockerComposeService[];
};

export type RepoRunPlan = {
  packageManager: PackageManager | null;
  // Recognized lifecycle scripts found in package.json
  scripts: { name: string; cmd: string }[];
  // Best guess for the dev/serve script (key name only)
  recommendedScript: string | null;
  env: {
    required: string[];
    source: EnvDetectResult["source"];
    exampleFile?: string;
  };
  federation: FederationHint[];
  monorepo: MonorepoHint | null;
  dockerCompose: DockerComposeHint | null;
  readmeExcerpt: string | null;
  // Repo-relative paths that the detector inspected (for transparency)
  inspected: string[];
};

const RUN_SCRIPT_PRIORITY = [
  "dev",
  "develop",
  "start:dev",
  "serve",
  "start",
  "preview",
];

const FEDERATION_NEEDLES = [
  { needle: "ModuleFederationPlugin", kind: "module-federation" as const },
  { needle: "@module-federation/", kind: "module-federation" as const },
  { needle: "@originjs/vite-plugin-federation", kind: "vite-federation" as const },
  { needle: "single-spa", kind: "single-spa" as const },
];

const MONOREPO_FILES: { file: string; tool: MonorepoHint["tool"] }[] = [
  { file: "nx.json", tool: "nx" },
  { file: "turbo.json", tool: "turbo" },
  { file: "lerna.json", tool: "lerna" },
  { file: "pnpm-workspace.yaml", tool: "pnpm-workspace" },
];

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function readJsonSafe<T = unknown>(p: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(p, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function detectPackageManager(
  repoPath: string,
  pkg: { packageManager?: string } | null,
): Promise<PackageManager | null> {
  if (pkg?.packageManager) {
    const tag = pkg.packageManager.toLowerCase();
    if (tag.startsWith("pnpm")) return "pnpm";
    if (tag.startsWith("yarn")) return "yarn";
    if (tag.startsWith("bun")) return "bun";
    if (tag.startsWith("npm")) return "npm";
  }
  if (await fileExists(path.join(repoPath, "pnpm-lock.yaml"))) return "pnpm";
  if (await fileExists(path.join(repoPath, "yarn.lock"))) return "yarn";
  if (await fileExists(path.join(repoPath, "bun.lockb"))) return "bun";
  if (await fileExists(path.join(repoPath, "package-lock.json"))) return "npm";
  return null;
}

async function detectMonorepo(repoPath: string): Promise<MonorepoHint | null> {
  for (const m of MONOREPO_FILES) {
    if (await fileExists(path.join(repoPath, m.file))) {
      return { tool: m.tool, file: m.file };
    }
  }
  return null;
}

async function detectDockerCompose(
  repoPath: string,
): Promise<DockerComposeHint | null> {
  for (const f of ["docker-compose.yml", "docker-compose.yaml", "compose.yml"]) {
    const full = path.join(repoPath, f);
    if (!(await fileExists(full))) continue;
    const raw = await fs.readFile(full, "utf8").catch(() => "");
    // Cheap parse — top-level `services:` block, then 2-space indented keys.
    // For each service, walk its 4-space-indented children to find `build:`
    // and `image:` so we can flag which need a build context.
    const services: DockerComposeService[] = [];
    const lines = raw.split(/\r?\n/);
    let inServices = false;
    let current: DockerComposeService | null = null;
    for (const line of lines) {
      if (/^services:\s*$/.test(line)) {
        inServices = true;
        continue;
      }
      if (!inServices) continue;
      if (/^\S/.test(line) && line.length > 0) break; // left services block
      const svcMatch = line.match(/^ {2}([A-Za-z0-9_.-]+):\s*$/);
      if (svcMatch) {
        if (current) services.push(current);
        current = { name: svcMatch[1], hasBuild: false };
        continue;
      }
      if (!current) continue;
      // build: can be an inline string (`build: .`) or a block
      if (/^ {4}build:\s*(\S.*)?$/.test(line)) {
        current.hasBuild = true;
        continue;
      }
      const imgMatch = line.match(/^ {4}image:\s*(\S.+?)\s*$/);
      if (imgMatch) {
        current.image = imgMatch[1].replace(/^["']|["']$/g, "");
      }
    }
    if (current) services.push(current);
    return {
      file: f,
      services: services.map((s) => s.name),
      serviceList: services,
    };
  }
  return null;
}

async function detectFederation(
  repoPath: string,
): Promise<FederationHint[]> {
  const candidates = [
    "module-federation.config.js",
    "module-federation.config.ts",
    "module-federation.config.cjs",
    "module-federation.config.mjs",
    "webpack.config.js",
    "webpack.config.ts",
    "vite.config.js",
    "vite.config.ts",
    "rspack.config.js",
    "rspack.config.ts",
  ];
  const hits: FederationHint[] = [];
  for (const c of candidates) {
    const full = path.join(repoPath, c);
    if (!(await fileExists(full))) continue;
    const text = await fs.readFile(full, "utf8").catch(() => "");
    if (!text) continue;
    for (const { needle, kind } of FEDERATION_NEEDLES) {
      if (!text.includes(needle)) continue;
      const remotes = extractRemotes(text);
      hits.push({ kind, file: c, remotes });
      break; // one hint per file
    }
  }
  return hits;
}

function extractRemotes(text: string): string[] | undefined {
  // Best-effort: find a `remotes` object literal and return its keys.
  // Looks for things like `remotes: { foo: "host@http://..." }`.
  const m = text.match(/remotes\s*:\s*{([\s\S]*?)}/);
  if (!m) return undefined;
  const block = m[1];
  const keys: string[] = [];
  const re = /(?:^|,|\n)\s*([A-Za-z0-9_$-]+)\s*:/g;
  let mm: RegExpExecArray | null;
  while ((mm = re.exec(block)) !== null) keys.push(mm[1]);
  return keys.length > 0 ? keys : undefined;
}

async function detectReadmeExcerpt(
  repoPath: string,
): Promise<string | null> {
  for (const f of ["README.md", "README", "Readme.md", "readme.md"]) {
    const full = path.join(repoPath, f);
    if (!(await fileExists(full))) continue;
    const raw = await fs.readFile(full, "utf8").catch(() => "");
    if (!raw) return null;
    // Trim to roughly the first ~800 chars, ending on a paragraph boundary.
    const cap = 800;
    if (raw.length <= cap) return raw.trim();
    const slice = raw.slice(0, cap);
    const lastBreak = Math.max(
      slice.lastIndexOf("\n\n"),
      slice.lastIndexOf(". "),
    );
    return (lastBreak > 200 ? slice.slice(0, lastBreak) : slice).trim() + "…";
  }
  return null;
}

export async function detectRunPlan(repoPath: string): Promise<RepoRunPlan> {
  const inspected: string[] = [];
  const pkgPath = path.join(repoPath, "package.json");
  const pkg = await readJsonSafe<{
    scripts?: Record<string, string>;
    packageManager?: string;
  }>(pkgPath);
  if (pkg) inspected.push("package.json");

  const packageManager = await detectPackageManager(repoPath, pkg);

  const allScripts = pkg?.scripts ?? {};
  const recognized = RUN_SCRIPT_PRIORITY.filter((k) => allScripts[k]).map(
    (k) => ({ name: k, cmd: allScripts[k] }),
  );
  const recommendedScript = recognized[0]?.name ?? null;

  const envDetect = await detectRequiredEnvVars(repoPath);
  if (envDetect.exampleFile) inspected.push(envDetect.exampleFile);

  const federation = await detectFederation(repoPath);
  for (const f of federation) inspected.push(f.file);

  const monorepo = await detectMonorepo(repoPath);
  if (monorepo) inspected.push(monorepo.file);

  const dockerCompose = await detectDockerCompose(repoPath);
  if (dockerCompose) inspected.push(dockerCompose.file);

  const readmeExcerpt = await detectReadmeExcerpt(repoPath);
  if (readmeExcerpt) inspected.push("README");

  return {
    packageManager,
    scripts: recognized,
    recommendedScript,
    env: {
      required: envDetect.required,
      source: envDetect.source,
      exampleFile: envDetect.exampleFile,
    },
    federation,
    monorepo,
    dockerCompose,
    readmeExcerpt,
    inspected,
  };
}
