import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { z } from "zod";

const ROOT = path.join(process.cwd(), ".mesh");
const CONFIG_PATH = path.join(ROOT, "config.json");
const REPOS_PATH = path.join(ROOT, "repos.json");

export const EngineModeSchema = z.enum(["raw", "agent"]);
export type EngineMode = z.infer<typeof EngineModeSchema>;

export const ConfigSchema = z.object({
  engineMode: EngineModeSchema.default("raw"),
});
export type MeshConfig = z.infer<typeof ConfigSchema>;

export const RepoRecordSchema = z.object({
  name: z.string().min(1),
  localPath: z.string().min(1),
  githubOwner: z.string().optional(),
  githubRepo: z.string().optional(),
  defaultBranch: z.string().default("main"),
  connectedAt: z.string(),
});
export type RepoRecord = z.infer<typeof RepoRecordSchema>;

export const RepoEnvSchema = z.record(z.string());
export type RepoEnv = z.infer<typeof RepoEnvSchema>;

async function ensureRoot() {
  await fs.mkdir(ROOT, { recursive: true });
}

async function readJson<S extends z.ZodTypeAny>(
  p: string,
  schema: S,
  fallback: z.output<S>,
): Promise<z.output<S>> {
  try {
    const raw = await fs.readFile(p, "utf8");
    const parsed = JSON.parse(raw);
    return schema.parse(parsed) as z.output<S>;
  } catch (err: unknown) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code?: string }).code === "ENOENT"
    ) {
      return fallback;
    }
    throw err;
  }
}

async function writeJson(p: string, data: unknown) {
  await ensureRoot();
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(data, null, 2) + "\n", "utf8");
}

export async function loadConfig(): Promise<MeshConfig> {
  return readJson(CONFIG_PATH, ConfigSchema, { engineMode: "raw" });
}

export async function saveConfig(cfg: MeshConfig): Promise<void> {
  ConfigSchema.parse(cfg);
  await writeJson(CONFIG_PATH, cfg);
}

export async function listRepos(): Promise<RepoRecord[]> {
  return readJson(REPOS_PATH, z.array(RepoRecordSchema), []);
}

export async function getRepo(name: string): Promise<RepoRecord | null> {
  const repos = await listRepos();
  return repos.find((r) => r.name === name) ?? null;
}

export async function addRepo(repo: RepoRecord): Promise<RepoRecord[]> {
  const parsed = RepoRecordSchema.parse(repo);
  const repos = await listRepos();
  const existing = repos.findIndex((r) => r.name === parsed.name);
  if (existing >= 0) repos[existing] = parsed;
  else repos.push(parsed);
  await writeJson(REPOS_PATH, repos);
  return repos;
}

export async function removeRepo(name: string): Promise<RepoRecord[]> {
  const repos = await listRepos();
  const next = repos.filter((r) => r.name !== name);
  await writeJson(REPOS_PATH, next);
  return next;
}

function envPath(name: string) {
  return path.join(ROOT, "repos", name, ".env.json");
}

export async function getRepoEnv(name: string): Promise<RepoEnv> {
  return readJson(envPath(name), RepoEnvSchema, {});
}

export async function setRepoEnv(
  name: string,
  kv: RepoEnv,
): Promise<RepoEnv> {
  const parsed = RepoEnvSchema.parse(kv);
  await writeJson(envPath(name), parsed);
  return parsed;
}

export async function detectClaudeCode(): Promise<boolean> {
  const candidate = path.join(os.homedir(), ".claude", "settings.json");
  try {
    await fs.access(candidate);
    return true;
  } catch {
    return false;
  }
}

export function safeRepoName(name: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(name);
}

export const paths = {
  root: ROOT,
  config: CONFIG_PATH,
  repos: REPOS_PATH,
  env: envPath,
};
