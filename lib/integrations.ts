import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { paths } from "./mesh-state";

const FILE_PATH = path.join(paths.root, "integrations.json");

export const IntegrationKindSchema = z.enum(["github", "granola", "jira", "linear"]);
export type IntegrationKind = z.infer<typeof IntegrationKindSchema>;

export const IntegrationStateSchema = z.object({
  kind: IntegrationKindSchema,
  connected: z.boolean().default(false),
  importedCount: z.number().int().nonnegative().default(0),
  lastImportAt: z.string().optional(),
  lastError: z.string().optional(),
});
export type IntegrationState = z.infer<typeof IntegrationStateSchema>;

export const IntegrationsFileSchema = z.object({
  states: z.array(IntegrationStateSchema).default([]),
});
export type IntegrationsFile = z.infer<typeof IntegrationsFileSchema>;

export const INTEGRATION_META: Record<
  IntegrationKind,
  {
    name: string;
    description: string;
    importVerb: string;
    bodyHint: string;
    defaultEntryKind: "note" | "meeting" | "ticket" | "link";
  }
> = {
  github: {
    name: "GitHub",
    description: "Repos, branches, and PRs. Connected via the gh CLI on this machine.",
    importVerb: "Connect",
    bodyHint: "",
    defaultEntryKind: "note",
  },
  granola: {
    name: "Granola",
    description: "Meeting transcripts and decisions. Imports become brain entries Mesh can recall during ticket planning.",
    importVerb: "Import meeting",
    bodyHint: "Paste the meeting transcript or summary. The first line is treated as the title.",
    defaultEntryKind: "meeting",
  },
  jira: {
    name: "Jira",
    description: "Tickets, epics, and rationale captured during refinement. Imported tickets enrich how Mesh routes related work.",
    importVerb: "Import ticket",
    bodyHint: "Paste the ticket body. Optionally provide the Jira key as a reference.",
    defaultEntryKind: "ticket",
  },
  linear: {
    name: "Linear",
    description: "Issues and project context. Imports become brain entries Mesh references across all projects.",
    importVerb: "Import issue",
    bodyHint: "Paste the issue body. Optionally provide the issue identifier as a reference.",
    defaultEntryKind: "ticket",
  },
};

async function read(): Promise<IntegrationsFile> {
  try {
    const raw = await fs.readFile(FILE_PATH, "utf8");
    return IntegrationsFileSchema.parse(JSON.parse(raw));
  } catch (err: unknown) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code?: string }).code === "ENOENT"
    ) {
      return { states: [] };
    }
    throw err;
  }
}

async function write(data: IntegrationsFile): Promise<void> {
  await fs.mkdir(path.dirname(FILE_PATH), { recursive: true });
  await fs.writeFile(FILE_PATH, JSON.stringify(data, null, 2) + "\n", "utf8");
}

export async function listIntegrations(): Promise<IntegrationState[]> {
  const file = await read();
  const byKind = new Map<IntegrationKind, IntegrationState>();
  for (const s of file.states) byKind.set(s.kind, s);
  return (Object.keys(INTEGRATION_META) as IntegrationKind[]).map((k) =>
    byKind.get(k) ?? {
      kind: k,
      connected: false,
      importedCount: 0,
    },
  );
}

export async function recordImport(
  kind: IntegrationKind,
  delta = 1,
): Promise<IntegrationState> {
  const file = await read();
  const idx = file.states.findIndex((s) => s.kind === kind);
  const now = new Date().toISOString();
  const base: IntegrationState =
    idx >= 0
      ? file.states[idx]
      : { kind, connected: false, importedCount: 0 };
  const next: IntegrationState = {
    ...base,
    connected: true,
    importedCount: base.importedCount + delta,
    lastImportAt: now,
    lastError: undefined,
  };
  if (idx >= 0) file.states[idx] = next;
  else file.states.push(next);
  await write(file);
  return next;
}

export async function disconnect(kind: IntegrationKind): Promise<IntegrationState> {
  const file = await read();
  const idx = file.states.findIndex((s) => s.kind === kind);
  const next: IntegrationState = {
    kind,
    connected: false,
    importedCount: 0,
  };
  if (idx >= 0) file.states[idx] = next;
  else file.states.push(next);
  await write(file);
  return next;
}
