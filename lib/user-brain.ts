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

// ── Profile (structured personal context) ────────────────────────────────
//
// The profile is the role-aware "what Mesh knows about you" snapshot that
// gets injected into Build / Ship prompts. Fields are filled by a mix of:
// imports (granola / linear / jira / github), explicit user answers in
// the onboarding chat, and inline edits on the Brain page. Each filled
// field carries a ProvenanceRef so the UI can show "from 12 meetings",
// "you said", etc.

export const RoleSchema = z.enum([
  "ceo",
  "founder",
  "pm",
  "designer",
  "engineer",
  "other",
]);
export type Role = z.infer<typeof RoleSchema>;

export const ProvenanceSourceSchema = z.enum([
  "user",
  "granola",
  "linear",
  "jira",
  "github",
  "upload",
  "synthesized",
]);
export type ProvenanceSource = z.infer<typeof ProvenanceSourceSchema>;

export const ProvenanceRefSchema = z.object({
  source: ProvenanceSourceSchema,
  ref: z.string().optional(),
  count: z.number().int().nonnegative().optional(),
  at: z.string().optional(),
});
export type ProvenanceRef = z.infer<typeof ProvenanceRefSchema>;

export const PROFILE_DIMENSIONS = [
  "who",
  "focus",
  "decisions",
  "people",
  "sources",
  "comms",
] as const;
export type ProfileDimension = (typeof PROFILE_DIMENSIONS)[number];

export const BrainProfileSchema = z.object({
  who: z
    .object({
      role: RoleSchema.optional(),
      roleLabel: z.string().optional(),
      name: z.string().optional(),
      company: z.string().optional(),
      team: z.string().optional(),
      bio: z.string().optional(),
      provenance: z.array(ProvenanceRefSchema).default([]),
    })
    .optional(),
  focus: z
    .object({
      summary: z.string().optional(),
      areas: z.array(z.string()).default([]),
      activeInitiatives: z
        .array(z.object({ title: z.string(), note: z.string().optional() }))
        .default([]),
      provenance: z.array(ProvenanceRefSchema).default([]),
    })
    .optional(),
  decisions: z
    .object({
      rules: z
        .array(
          z.object({
            rule: z.string(),
            why: z.string().optional(),
            source: ProvenanceRefSchema.optional(),
          }),
        )
        .default([]),
      provenance: z.array(ProvenanceRefSchema).default([]),
    })
    .optional(),
  people: z
    .object({
      stakeholders: z.array(z.string()).default([]),
      escalation: z.string().optional(),
      reviewers: z.array(z.string()).default([]),
      provenance: z.array(ProvenanceRefSchema).default([]),
    })
    .optional(),
  sources: z
    .object({
      connected: z.array(z.string()).default([]),
      preferred: z.array(z.string()).default([]),
      lives: z.string().optional(),
      provenance: z.array(ProvenanceRefSchema).default([]),
    })
    .optional(),
  comms: z
    .object({
      style: z.enum(["terse", "detailed", "balanced"]).optional(),
      lang: z.enum(["es", "en"]).optional(),
      logTo: z.string().optional(),
      format: z.string().optional(),
      provenance: z.array(ProvenanceRefSchema).default([]),
    })
    .optional(),
  confidence: z
    .object({
      who: z.number().min(0).max(1).default(0),
      focus: z.number().min(0).max(1).default(0),
      decisions: z.number().min(0).max(1).default(0),
      people: z.number().min(0).max(1).default(0),
      sources: z.number().min(0).max(1).default(0),
      comms: z.number().min(0).max(1).default(0),
    })
    .default({
      who: 0,
      focus: 0,
      decisions: 0,
      people: 0,
      sources: 0,
      comms: 0,
    }),
  updatedAt: z.string().default(""),
});
export type BrainProfile = z.infer<typeof BrainProfileSchema>;

const EMPTY_PROFILE: BrainProfile = BrainProfileSchema.parse({});

export const UserBrainSchema = z.object({
  entries: z.array(BrainEntrySchema).default([]),
  profile: BrainProfileSchema.default(EMPTY_PROFILE),
  updatedAt: z.string().default(""),
});
export type UserBrain = z.infer<typeof UserBrainSchema>;

const EMPTY_BRAIN: UserBrain = {
  entries: [],
  profile: EMPTY_PROFILE,
  updatedAt: "",
};

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
  await writeBrain({
    entries: [],
    profile: EMPTY_PROFILE,
    updatedAt: new Date().toISOString(),
  });
}

// ── Profile helpers ─────────────────────────────────────────────────────

export async function loadProfile(): Promise<BrainProfile> {
  const brain = await readBrain();
  return brain.profile ?? EMPTY_PROFILE;
}

// Deep-merge a profile patch. Arrays in the patch replace arrays in the
// base (callers explicitly compute the next array). `undefined` in the
// patch leaves the base untouched. Confidence values in the patch
// override per-dimension scalars.
export async function mergeProfile(
  patch: Partial<BrainProfile>,
): Promise<BrainProfile> {
  const brain = await readBrain();
  const base = brain.profile ?? EMPTY_PROFILE;
  const next: BrainProfile = {
    ...base,
    ...patch,
    confidence: { ...base.confidence, ...(patch.confidence ?? {}) },
    updatedAt: new Date().toISOString(),
  };
  // Re-validate (drops unknown keys, applies defaults)
  const parsed = BrainProfileSchema.parse(next);
  brain.profile = parsed;
  brain.updatedAt = parsed.updatedAt;
  await writeBrain(brain);
  return parsed;
}

export async function setProfileDimension<D extends ProfileDimension>(
  dim: D,
  value: BrainProfile[D],
  confidence?: number,
): Promise<BrainProfile> {
  const patch: Partial<BrainProfile> = { [dim]: value } as Partial<BrainProfile>;
  if (typeof confidence === "number") {
    patch.confidence = { [dim]: confidence } as BrainProfile["confidence"];
  }
  return mergeProfile(patch);
}

export async function clearProfile(): Promise<BrainProfile> {
  const brain = await readBrain();
  brain.profile = EMPTY_PROFILE;
  brain.updatedAt = new Date().toISOString();
  await writeBrain(brain);
  return EMPTY_PROFILE;
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
  const profileBlock = renderProfileForPrompt(brain.profile);
  if (brain.entries.length === 0 && !profileBlock) return "";
  const limit = opts.limit ?? PROMPT_DEFAULT_LIMIT;
  const cap = opts.bodyCap ?? PROMPT_BODY_CAP;
  const slice = brain.entries.slice(0, limit);
  const lines: string[] = [];
  if (profileBlock) {
    lines.push(profileBlock);
    if (slice.length > 0) lines.push("");
  }
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

function renderProfileForPrompt(profile: BrainProfile | undefined): string {
  if (!profile) return "";
  const parts: string[] = [];
  const { who, focus, decisions, people, sources, comms } = profile;

  if (who && (who.role || who.name || who.company || who.bio)) {
    const ident = [who.name, who.roleLabel ?? who.role, who.company, who.team]
      .filter(Boolean)
      .join(" · ");
    if (ident) parts.push(`  identity: ${ident}`);
    if (who.bio) parts.push(`  bio: ${who.bio}`);
  }
  if (focus) {
    if (focus.summary) parts.push(`  focus: ${focus.summary}`);
    if (focus.areas.length) parts.push(`  areas: ${focus.areas.join(", ")}`);
    if (focus.activeInitiatives.length) {
      parts.push("  initiatives:");
      for (const i of focus.activeInitiatives) {
        parts.push(`    - ${i.title}${i.note ? ` — ${i.note}` : ""}`);
      }
    }
  }
  if (decisions && decisions.rules.length) {
    parts.push("  standing decisions (do NOT violate):");
    for (const r of decisions.rules) {
      parts.push(`    - ${r.rule}${r.why ? ` (why: ${r.why})` : ""}`);
    }
  }
  if (people) {
    if (people.stakeholders.length)
      parts.push(`  stakeholders: ${people.stakeholders.join(", ")}`);
    if (people.reviewers.length)
      parts.push(`  reviewers: ${people.reviewers.join(", ")}`);
    if (people.escalation) parts.push(`  escalation: ${people.escalation}`);
  }
  if (sources) {
    if (sources.connected.length)
      parts.push(`  connected sources: ${sources.connected.join(", ")}`);
    if (sources.lives) parts.push(`  context lives in: ${sources.lives}`);
  }
  if (comms) {
    const c = [
      comms.style ? `style:${comms.style}` : null,
      comms.lang ? `lang:${comms.lang}` : null,
      comms.format ? `format:${comms.format}` : null,
      comms.logTo ? `log-to:${comms.logTo}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    if (c) parts.push(`  comms: ${c}`);
  }

  if (parts.length === 0) return "";
  return ["[user profile]", ...parts].join("\n");
}

export const brainPaths = {
  dir: BRAIN_DIR,
  file: BRAIN_PATH,
};
