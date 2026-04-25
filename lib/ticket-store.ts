import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";

const ROOT = path.join(process.cwd(), ".mesh");
const TICKETS_DIR = path.join(ROOT, "tickets");
const INDEX_PATH = path.join(TICKETS_DIR, "index.json");

export const TicketStatusSchema = z.enum([
  "inbox",
  "drafted",
  "in_process",
  "for_review",
]);
export type TicketStatus = z.infer<typeof TicketStatusSchema>;

export const TicketPrioritySchema = z.enum(["low", "med", "high"]);
export type TicketPriority = z.infer<typeof TicketPrioritySchema>;

export const TicketSourceHintSchema = z.enum([
  "mesh",
  "slack",
  "linear",
  "github",
]);
export type TicketSourceHint = z.infer<typeof TicketSourceHintSchema>;

export const DraftingPhaseSchema = z.enum([
  "classifying",
  "planning",
  "synthesizing",
]);
export type DraftingPhase = z.infer<typeof DraftingPhaseSchema>;

export const TicketAdjustmentSchema = z.object({
  at: z.string(),
  instruction: z.string(),
  previous_plan_id: z.string(),
});
export type TicketAdjustment = z.infer<typeof TicketAdjustmentSchema>;

export const TicketPrRefSchema = z.object({
  repo: z.string(),
  url: z.string(),
  simulated: z.boolean().default(false),
  number: z.number().int().optional(),
  html_url: z.string().optional(),
});
export type TicketPrRef = z.infer<typeof TicketPrRefSchema>;

export const TicketRecordSchema = z.object({
  id: z.string(),
  projectId: z.string().optional(),
  title: z.string().min(1),
  description: z.string().default(""),
  priority: TicketPrioritySchema.default("med"),
  labels: z.array(z.string()).default([]),
  source_hint: TicketSourceHintSchema.default("mesh"),
  author: z.string().default("you"),
  created_at: z.string(),
  updated_at: z.string(),
  status: TicketStatusSchema.default("inbox"),
  plan_id: z.string().optional(),
  drafting: z
    .object({
      phase: DraftingPhaseSchema,
      ttft_ms: z.number().optional(),
      started_at: z.string(),
    })
    .optional(),
  ship_session: z
    .object({
      id: z.string(),
      started_at: z.string(),
      steps_total: z.number().int().nonnegative(),
      steps_done: z.number().int().nonnegative().default(0),
    })
    .optional(),
  prs: z.array(TicketPrRefSchema).default([]),
  adjustments: z.array(TicketAdjustmentSchema).default([]),
});
export type TicketRecord = z.infer<typeof TicketRecordSchema>;

export const TicketIndexEntrySchema = z.object({
  id: z.string(),
  projectId: z.string().optional(),
  title: z.string(),
  status: TicketStatusSchema,
  priority: TicketPrioritySchema,
  labels: z.array(z.string()).default([]),
  source_hint: TicketSourceHintSchema,
  author: z.string().default("you"),
  created_at: z.string(),
  updated_at: z.string(),
  plan_id: z.string().optional(),
  ship: z
    .object({ steps_total: z.number(), steps_done: z.number() })
    .optional(),
  prs_count: z.number().int().nonnegative().default(0),
  drafting_phase: DraftingPhaseSchema.optional(),
});
export type TicketIndexEntry = z.infer<typeof TicketIndexEntrySchema>;

export const TicketIndexSchema = z.object({
  next_number: z.number().int().positive().default(1),
  entries: z.array(TicketIndexEntrySchema).default([]),
});
export type TicketIndex = z.infer<typeof TicketIndexSchema>;

async function ensureDir() {
  await fs.mkdir(TICKETS_DIR, { recursive: true });
}

async function readIndex(): Promise<TicketIndex> {
  try {
    const raw = await fs.readFile(INDEX_PATH, "utf8");
    return TicketIndexSchema.parse(JSON.parse(raw));
  } catch (err: unknown) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code?: string }).code === "ENOENT"
    ) {
      return { next_number: 1, entries: [] };
    }
    throw err;
  }
}

async function writeIndex(ix: TicketIndex): Promise<void> {
  await ensureDir();
  TicketIndexSchema.parse(ix);
  await fs.writeFile(INDEX_PATH, JSON.stringify(ix, null, 2) + "\n", "utf8");
}

function ticketPath(id: string): string {
  return path.join(TICKETS_DIR, `${id}.json`);
}

function toIndexEntry(t: TicketRecord): TicketIndexEntry {
  return {
    id: t.id,
    projectId: t.projectId,
    title: t.title,
    status: t.status,
    priority: t.priority,
    labels: t.labels,
    source_hint: t.source_hint,
    author: t.author,
    created_at: t.created_at,
    updated_at: t.updated_at,
    plan_id: t.plan_id,
    ship: t.ship_session
      ? {
          steps_total: t.ship_session.steps_total,
          steps_done: t.ship_session.steps_done,
        }
      : undefined,
    prs_count: t.prs.length,
    drafting_phase: t.drafting?.phase,
  };
}

export async function listTickets(opts?: {
  projectId?: string | null;
}): Promise<TicketIndexEntry[]> {
  const ix = await readIndex();
  if (opts?.projectId === undefined) return ix.entries;
  if (opts.projectId === null) return ix.entries.filter((e) => !e.projectId);
  return ix.entries.filter((e) => e.projectId === opts.projectId);
}

export async function getTicket(id: string): Promise<TicketRecord | null> {
  try {
    const raw = await fs.readFile(ticketPath(id), "utf8");
    return TicketRecordSchema.parse(JSON.parse(raw));
  } catch (err: unknown) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code?: string }).code === "ENOENT"
    ) {
      return null;
    }
    throw err;
  }
}

async function writeTicket(t: TicketRecord): Promise<void> {
  await ensureDir();
  TicketRecordSchema.parse(t);
  await fs.writeFile(
    ticketPath(t.id),
    JSON.stringify(t, null, 2) + "\n",
    "utf8",
  );
}

export async function createTicket(input: {
  title: string;
  description?: string;
  priority?: TicketPriority;
  labels?: string[];
  source_hint?: TicketSourceHint;
  author?: string;
  projectId?: string;
}): Promise<TicketRecord> {
  const ix = await readIndex();
  const id = `MSH-${String(ix.next_number).padStart(3, "0")}`;
  const now = new Date().toISOString();
  const ticket: TicketRecord = TicketRecordSchema.parse({
    id,
    projectId: input.projectId,
    title: input.title.trim(),
    description: (input.description ?? "").trim(),
    priority: input.priority ?? "med",
    labels: input.labels ?? [],
    source_hint: input.source_hint ?? "mesh",
    author: input.author ?? "you",
    created_at: now,
    updated_at: now,
    status: "inbox",
    prs: [],
    adjustments: [],
  });
  await writeTicket(ticket);

  const nextIx: TicketIndex = {
    next_number: ix.next_number + 1,
    entries: [toIndexEntry(ticket), ...ix.entries],
  };
  await writeIndex(nextIx);
  return ticket;
}

export async function updateTicket(
  id: string,
  patch: Partial<Omit<TicketRecord, "id" | "created_at">>,
): Promise<TicketRecord | null> {
  const cur = await getTicket(id);
  if (!cur) return null;
  const next: TicketRecord = TicketRecordSchema.parse({
    ...cur,
    ...patch,
    id: cur.id,
    created_at: cur.created_at,
    updated_at: new Date().toISOString(),
  });
  await writeTicket(next);

  const ix = await readIndex();
  const entry = toIndexEntry(next);
  const idx = ix.entries.findIndex((e) => e.id === id);
  if (idx >= 0) ix.entries[idx] = entry;
  else ix.entries.unshift(entry);
  // Re-sort: newest updated first within each status.
  ix.entries.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
  await writeIndex(ix);
  return next;
}

export async function deleteTicket(id: string): Promise<boolean> {
  const cur = await getTicket(id);
  if (!cur) return false;
  try {
    await fs.unlink(ticketPath(id));
  } catch {
    // ignore
  }
  const ix = await readIndex();
  ix.entries = ix.entries.filter((e) => e.id !== id);
  await writeIndex(ix);
  return true;
}

export const paths = {
  dir: TICKETS_DIR,
  index: INDEX_PATH,
  ticket: ticketPath,
};

// Tickets that live in the Ship workspace. A ticket reaches `for_review`
// only after the ship session has staged commits on the feature branch and
// opened a draft PR — that's where the user validates (diff, checks,
// preview), optionally adjusts via addenda, and finally marks the PR ready.
export async function listReadyForShip(opts?: {
  projectId?: string | null;
}): Promise<TicketIndexEntry[]> {
  const all = await listTickets(opts);
  return all.filter((t) => t.status === "for_review" && !!t.plan_id);
}
