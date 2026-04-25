import { promises as fs } from "node:fs";
import path from "node:path";

const ROOT = path.join(process.cwd(), ".mesh");
const PLANS_DIR = path.join(ROOT, "plans");
const SHIP_DIR = path.join(ROOT, "ship");
const ARCHIVE_DIR = path.join(ROOT, "archive");

export type ArchiveMode = "compact" | "reset";

export type ArchiveResult = {
  archivedTo: string;
  movedPlans: number;
  movedShipSessions: number;
  briefPath?: string;
};

async function listJsonFiles(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir);
    return entries.filter((e) => e.endsWith(".json"));
  } catch (err: unknown) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code?: string }).code === "ENOENT"
    ) {
      return [];
    }
    throw err;
  }
}

async function moveFile(src: string, dst: string): Promise<void> {
  await fs.mkdir(path.dirname(dst), { recursive: true });
  try {
    await fs.rename(src, dst);
  } catch {
    // Cross-device or permission — fall back to copy + unlink
    await fs.copyFile(src, dst);
    await fs.unlink(src);
  }
}

function isoStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export async function archiveSession(
  mode: ArchiveMode,
): Promise<ArchiveResult> {
  const stamp = isoStamp();
  const archiveRoot = path.join(ARCHIVE_DIR, stamp);
  const archivePlans = path.join(archiveRoot, "plans");
  const archiveShip = path.join(archiveRoot, "ship");

  const planFiles = (await listJsonFiles(PLANS_DIR)).sort();
  const shipFiles = (await listJsonFiles(SHIP_DIR)).sort();

  // Plan store uses `${Date.now()}-<slug>.json`, so lexical sort puts newest last.
  const latestPlan = planFiles.length > 0 ? planFiles[planFiles.length - 1] : null;

  let movedPlans = 0;
  for (const file of planFiles) {
    if (mode === "compact" && file === latestPlan) continue;
    await moveFile(path.join(PLANS_DIR, file), path.join(archivePlans, file));
    movedPlans++;
  }

  let movedShipSessions = 0;
  for (const file of shipFiles) {
    await moveFile(path.join(SHIP_DIR, file), path.join(archiveShip, file));
    movedShipSessions++;
  }

  const result: ArchiveResult = {
    archivedTo: archiveRoot,
    movedPlans,
    movedShipSessions,
  };

  if (mode === "compact" && latestPlan) {
    result.briefPath = path.join(PLANS_DIR, latestPlan);
  }

  // Write a tiny manifest so archives are self-describing.
  if (movedPlans > 0 || movedShipSessions > 0) {
    await fs.mkdir(archiveRoot, { recursive: true });
    await fs.writeFile(
      path.join(archiveRoot, "manifest.json"),
      JSON.stringify(
        {
          archived_at: new Date().toISOString(),
          mode,
          plans: movedPlans,
          ship_sessions: movedShipSessions,
          brief: mode === "compact" ? latestPlan : null,
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );
  }

  return result;
}
