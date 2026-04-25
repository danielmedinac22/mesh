import { promises as fs } from "node:fs";
import path from "node:path";
import {
  addProject,
  listProjects,
  listRepos,
  paths as meshPaths,
  projectSlug,
  setCurrentProject,
  type ProjectRecord,
  type RepoRecord,
  RepoRecordSchema,
} from "@/lib/mesh-state";

let bootstrapRan = false;

// Idempotent: called at the top of any handler that touches projects/repos/memory.
// On first run with legacy state (repos.json populated but no projects.json),
// creates a default "Flarebill" project, assigns all repos to it, and moves
// the global memory.json into the project folder.
export async function bootstrapProjects(): Promise<void> {
  if (bootstrapRan) return;
  bootstrapRan = true;

  const existingProjects = await listProjects();
  if (existingProjects.length > 0) return;

  const repos = await listRepos();
  if (repos.length === 0) return;

  const now = new Date().toISOString();
  const defaultName = inferProjectName(repos);
  const defaultId = projectSlug(defaultName);

  const project: ProjectRecord = {
    id: defaultId,
    name: defaultName,
    label: defaultName === "Flarebill" ? "SaaS billing" : undefined,
    color: "amber",
    repos: repos.map((r) => r.name),
    createdAt: now,
    updatedAt: now,
  };
  await addProject(project);

  // Stamp projectId on existing repos
  const updated: RepoRecord[] = repos.map((r) =>
    RepoRecordSchema.parse({ ...r, projectId: defaultId }),
  );
  await fs.writeFile(
    meshPaths.repos,
    JSON.stringify(updated, null, 2) + "\n",
    "utf8",
  );

  // Move legacy .mesh/memory.json into the project folder
  const legacyMemory = path.join(meshPaths.root, "memory.json");
  try {
    const raw = await fs.readFile(legacyMemory, "utf8");
    const target = meshPaths.projectMemory(defaultId);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, raw, "utf8");
    await fs.unlink(legacyMemory).catch(() => undefined);
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code && code !== "ENOENT") throw err;
  }

  await setCurrentProject(defaultId);
}

function inferProjectName(repos: RepoRecord[]): string {
  // Find a common prefix like "flarebill-" across repo names.
  const names = repos.map((r) => r.name);
  if (names.length === 0) return "Project";
  const first = names[0];
  let prefixLen = first.length;
  for (const n of names) {
    let i = 0;
    while (i < prefixLen && i < n.length && first[i] === n[i]) i += 1;
    prefixLen = i;
  }
  const raw = first.slice(0, prefixLen).replace(/[-_]+$/, "");
  if (raw.length >= 3) return raw.charAt(0).toUpperCase() + raw.slice(1);
  return "Flarebill";
}
