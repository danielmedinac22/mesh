import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { paths } from "./mesh-state";

const BRAIN_DIR = path.join(paths.root, "user");
const BRAIN_PATH = path.join(BRAIN_DIR, "brain.json");

export const BrainEntryKindSchema = z.enum(["note", "meeting", "ticket", "link"]);
export type BrainEntryKind = z.infer<typeof BrainEntryKindSchema>;

export const BrainEntrySchema = z.object({
  id: z.string().min(1),
  kind: BrainEntryKindSchema,
  body: z.string().default(""),
  title: z.string().optional(),
  source: z.string().optional(),
  ref: z.string().optional(),
  url: z.string().optional(),
  tags: z.array(z.string()).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type BrainEntry = z.infer<typeof BrainEntrySchema>;

export const UserBrainSchema = z.object({
  entries: z.array(BrainEntrySchema).default([]),
  updatedAt: z.string().default(""),
});
export type UserBrain = z.infer<typeof UserBrainSchema>;

const EMPTY_BRAIN: UserBrain = { entries: [], updatedAt: "" };

async function readBrain(): Promise<UserBrain> {
  try {
    const raw = await fs.readFile(BRAIN_PATH, "utf8");
    return UserBrainSchema.parse(JSON.parse(raw));
  } catch (err: unknown) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code?: string }).code === "ENOENT"
    ) {
      return EMPTY_BRAIN;
    }
    throw err;
  }
}

async function writeBrain(brain: UserBrain): Promise<void> {
  await fs.mkdir(BRAIN_DIR, { recursive: true });
  await fs.writeFile(BRAIN_PATH, JSON.stringify(brain, null, 2) + "\n", "utf8");
}

export async function loadBrain(): Promise<UserBrain> {
  return readBrain();
}

export async function appendBrainEntry(
  input: Omit<BrainEntry, "id" | "createdAt" | "updatedAt"> &
    Partial<Pick<BrainEntry, "id">>,
): Promise<BrainEntry> {
  const brain = await readBrain();
  const now = new Date().toISOString();
  const entry: BrainEntry = BrainEntrySchema.parse({
    id: input.id ?? `b_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    kind: input.kind,
    body: input.body ?? "",
    title: input.title,
    source: input.source,
    ref: input.ref,
    url: input.url,
    tags: input.tags ?? [],
    createdAt: now,
    updatedAt: now,
  });
  brain.entries.unshift(entry);
  brain.updatedAt = now;
  await writeBrain(brain);
  return entry;
}

export async function removeBrainEntry(id: string): Promise<UserBrain> {
  const brain = await readBrain();
  brain.entries = brain.entries.filter((e) => e.id !== id);
  brain.updatedAt = new Date().toISOString();
  await writeBrain(brain);
  return brain;
}

export async function clearBrain(): Promise<void> {
  await writeBrain({ entries: [], updatedAt: new Date().toISOString() });
}

const PROMPT_DEFAULT_LIMIT = 50;
const PROMPT_BODY_CAP = 1200;

export type BrainPromptOptions = {
  limit?: number;
  bodyCap?: number;
};

// Compact, deterministic brain rendering for system prompts. Token budget is
// bounded by limit * bodyCap; defaults give ~60K chars worst case which fits
// in cache. The block is appended after project memory and shares the same
// cache_control:ephemeral wrapper at the engine layer.
export async function loadBrainForPrompt(
  opts: BrainPromptOptions = {},
): Promise<string> {
  const brain = await readBrain();
  if (brain.entries.length === 0) return "";
  const limit = opts.limit ?? PROMPT_DEFAULT_LIMIT;
  const cap = opts.bodyCap ?? PROMPT_BODY_CAP;
  const slice = brain.entries.slice(0, limit);
  const lines: string[] = [];
  for (const e of slice) {
    const head = [`#${e.id}`, e.kind, e.source ? `via:${e.source}` : null]
      .filter(Boolean)
      .join(" ");
    const titleLine = e.title ? `  title: ${e.title}` : null;
    const refLine = e.ref ? `  ref: ${e.ref}` : null;
    const urlLine = e.url ? `  url: ${e.url}` : null;
    const tagLine = e.tags.length ? `  tags: ${e.tags.join(", ")}` : null;
    const body = e.body.length > cap ? `${e.body.slice(0, cap)}…` : e.body;
    lines.push(head);
    for (const l of [titleLine, refLine, urlLine, tagLine]) if (l) lines.push(l);
    if (body.trim()) {
      lines.push("  body:");
      for (const ln of body.split("\n")) lines.push(`    ${ln}`);
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

export const brainPaths = {
  dir: BRAIN_DIR,
  file: BRAIN_PATH,
};
