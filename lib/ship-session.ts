import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";

const SHIP_DIR = path.join(process.cwd(), ".mesh", "ship");

export const ShipInterceptionSchema = z.object({
  step: z.number().int().positive(),
  skill_id: z.string(),
  title: z.string(),
  message: z.string(),
  fix_hint: z.string(),
  resolved: z.boolean().default(false),
});
export type ShipInterception = z.infer<typeof ShipInterceptionSchema>;

export const ShipStepResultSchema = z.object({
  step: z.number().int().positive(),
  repo: z.string(),
  file: z.string(),
  action: z.enum(["edit", "create"]),
  attempts: z.number().int().nonnegative().default(1),
  commit_sha: z.string().optional(),
  thinking_chars: z.number().int().nonnegative().default(0),
  interceptions: z.array(ShipInterceptionSchema).default([]),
  skipped: z.boolean().default(false),
  error: z.string().optional(),
});
export type ShipStepResult = z.infer<typeof ShipStepResultSchema>;

export const ShipPrSchema = z.object({
  repo: z.string(),
  url: z.string(),
  title: z.string(),
  body: z.string().default(""),
  simulated: z.boolean().default(false),
  html_url: z.string().optional(),
  number: z.number().int().optional(),
});
export type ShipPr = z.infer<typeof ShipPrSchema>;

export const ShipSessionSchema = z.object({
  id: z.string(),
  plan_id: z.string(),
  created_at: z.string(),
  finished_at: z.string().optional(),
  status: z.enum(["running", "completed", "failed"]).default("running"),
  branch: z.string(),
  steps: z.array(ShipStepResultSchema).default([]),
  prs: z.array(ShipPrSchema).default([]),
  error: z.string().optional(),
});
export type ShipSession = z.infer<typeof ShipSessionSchema>;

async function ensure() {
  await fs.mkdir(SHIP_DIR, { recursive: true });
}

export async function createSession(input: {
  plan_id: string;
  branch: string;
}): Promise<ShipSession> {
  await ensure();
  const id = `${Date.now()}-${slug(input.branch)}`;
  const session: ShipSession = {
    id,
    plan_id: input.plan_id,
    created_at: new Date().toISOString(),
    branch: input.branch,
    status: "running",
    steps: [],
    prs: [],
  };
  await writeSession(session);
  return session;
}

export async function writeSession(session: ShipSession): Promise<void> {
  await ensure();
  ShipSessionSchema.parse(session);
  await fs.writeFile(
    path.join(SHIP_DIR, `${session.id}.json`),
    JSON.stringify(session, null, 2) + "\n",
    "utf8",
  );
}

export async function getSession(id: string): Promise<ShipSession | null> {
  try {
    const raw = await fs.readFile(path.join(SHIP_DIR, `${id}.json`), "utf8");
    return ShipSessionSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function listSessions(): Promise<ShipSession[]> {
  try {
    const entries = await fs.readdir(SHIP_DIR);
    const out: ShipSession[] = [];
    for (const e of entries) {
      if (!e.endsWith(".json")) continue;
      try {
        const raw = await fs.readFile(path.join(SHIP_DIR, e), "utf8");
        out.push(ShipSessionSchema.parse(JSON.parse(raw)));
      } catch {
        // skip malformed
      }
    }
    out.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    return out;
  } catch {
    return [];
  }
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}
