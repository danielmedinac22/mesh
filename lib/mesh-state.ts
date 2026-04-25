import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { z } from "zod";

const ROOT = path.join(process.cwd(), ".mesh");
const CONFIG_PATH = path.join(ROOT, "config.json");
const REPOS_PATH = path.join(ROOT, "repos.json");
const PROJECTS_PATH = path.join(ROOT, "projects.json");
const PROJECTS_ROOT = path.join(ROOT, "projects");

export const EngineModeSchema = z.enum(["raw", "agent"]);
export type EngineMode = z.infer<typeof EngineModeSchema>;

export const ConfigSchema = z.object({
  engineMode: EngineModeSchema.default("raw"),
  workspaceRoot: z.string().optional(),
  currentProjectId: z.string().optional(),
});
export type MeshConfig = z.infer<typeof ConfigSchema>;

export const RepoRecordSchema = z.object({
  name: z.string().min(1),
  localPath: z.string().min(1),
  githubOwner: z.string().optional(),
  githubRepo: z.string().optional(),
  defaultBranch: z.string().default("main"),
  projectId: z.string().optional(),
  connectedAt: z.string(),
  filesIndexed: z.number().int().nonnegative().optional(),
  tokensEst: z.number().nonnegative().optional(),
  ingestedAt: z.string().optional(),
});
export type RepoRecord = z.infer<typeof RepoRecordSchema>;

export const ProjectColorSchema = z.enum([
  "amber",
  "violet",
  "blue",
  "green",
  "red",
  "slate",
]);
export type ProjectColor = z.infer<typeof ProjectColorSchema>;

export const ProjectOnboardingSchema = z.object({
  dismissed: z.boolean().default(false),
  stepsSeen: z.array(z.string()).default([]),
});
export type ProjectOnboarding = z.infer<typeof ProjectOnboardingSchema>;

export const ProjectRecordSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  label: z.string().optional(),
  color: ProjectColorSchema.default("amber"),
  description: z.string().optional(),
  repos: z.array(z.string()).default([]),
  onboarding: ProjectOnboardingSchema.optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ProjectRecord = z.infer<typeof ProjectRecordSchema>;

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

export async function setWorkspaceRoot(root: string | null): Promise<MeshConfig> {
  const cur = await loadConfig();
  const next: MeshConfig = { ...cur };
  if (root && root.trim()) next.workspaceRoot = root;
  else delete next.workspaceRoot;
  await saveConfig(next);
  return next;
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

export function projectSlug(name: string): string {
  const s = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return s || "project";
}

function projectRoot(id: string): string {
  return path.join(PROJECTS_ROOT, id);
}

function projectMemoryPath(id: string): string {
  return path.join(projectRoot(id), "memory.json");
}

function projectSkillsRoot(id: string): string {
  return path.join(projectRoot(id), "skills");
}

export async function listProjects(): Promise<ProjectRecord[]> {
  return readJson(PROJECTS_PATH, z.array(ProjectRecordSchema), []);
}

export async function getProject(id: string): Promise<ProjectRecord | null> {
  const list = await listProjects();
  return list.find((p) => p.id === id) ?? null;
}

export async function addProject(p: ProjectRecord): Promise<ProjectRecord[]> {
  const parsed = ProjectRecordSchema.parse(p);
  const list = await listProjects();
  const existing = list.findIndex((x) => x.id === parsed.id);
  if (existing >= 0) list[existing] = parsed;
  else list.push(parsed);
  await writeJson(PROJECTS_PATH, list);
  await fs.mkdir(projectRoot(parsed.id), { recursive: true });
  return list;
}

export async function updateProject(
  id: string,
  patch: Partial<Omit<ProjectRecord, "id" | "createdAt">>,
): Promise<ProjectRecord | null> {
  const list = await listProjects();
  const idx = list.findIndex((p) => p.id === id);
  if (idx < 0) return null;
  const next: ProjectRecord = ProjectRecordSchema.parse({
    ...list[idx],
    ...patch,
    id: list[idx].id,
    createdAt: list[idx].createdAt,
    updatedAt: new Date().toISOString(),
  });
  list[idx] = next;
  await writeJson(PROJECTS_PATH, list);
  return next;
}

export async function removeProject(id: string): Promise<ProjectRecord[]> {
  const list = await listProjects();
  const next = list.filter((p) => p.id !== id);
  await writeJson(PROJECTS_PATH, next);
  return next;
}

export async function setCurrentProject(
  id: string | null,
): Promise<MeshConfig> {
  const cur = await loadConfig();
  const next: MeshConfig = { ...cur };
  if (id) next.currentProjectId = id;
  else delete next.currentProjectId;
  await saveConfig(next);
  return next;
}

export async function getCurrentProjectId(): Promise<string | null> {
  const cfg = await loadConfig();
  if (cfg.currentProjectId) {
    const exists = await getProject(cfg.currentProjectId);
    if (exists) return exists.id;
  }
  const list = await listProjects();
  return list[0]?.id ?? null;
}

export async function getReposForProject(id: string): Promise<RepoRecord[]> {
  const repos = await listRepos();
  return repos.filter((r) => r.projectId === id);
}

export const paths = {
  root: ROOT,
  config: CONFIG_PATH,
  repos: REPOS_PATH,
  projects: PROJECTS_PATH,
  projectsRoot: PROJECTS_ROOT,
  projectRoot,
  projectMemory: projectMemoryPath,
  projectSkills: projectSkillsRoot,
  env: envPath,
};
