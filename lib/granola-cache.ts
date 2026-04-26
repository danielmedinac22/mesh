import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import type { GranolaMeeting } from "./granola-mcp";

// Granola Desktop persists every meeting it has access to in a local
// JSON cache. This is what community MCP servers (proofgeist, etc.)
// use under the hood, and what we read here as the primary source —
// the public MCP requires its own OAuth flow which we don't run.

const CACHE_PATHS: Record<NodeJS.Platform, string[]> = {
  darwin: [
    path.join(os.homedir(), "Library/Application Support/Granola/cache-v6.json"),
    path.join(os.homedir(), "Library/Application Support/Granola/cache-v5.json"),
    path.join(os.homedir(), "Library/Application Support/Granola/cache-v4.json"),
  ],
  linux: [
    path.join(os.homedir(), ".config/Granola/cache-v6.json"),
    path.join(os.homedir(), ".config/Granola/cache-v5.json"),
  ],
  win32: [
    path.join(os.homedir(), "AppData/Roaming/Granola/cache-v6.json"),
    path.join(os.homedir(), "AppData/Roaming/Granola/cache-v5.json"),
  ],
  aix: [],
  android: [],
  freebsd: [],
  haiku: [],
  openbsd: [],
  sunos: [],
  cygwin: [],
  netbsd: [],
};

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v : undefined;
}

function asArrayOfStrings(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object") {
        const o = item as { email?: unknown; name?: unknown; full_name?: unknown };
        return asString(o.email) ?? asString(o.full_name) ?? asString(o.name);
      }
      return undefined;
    })
    .filter((s): s is string => typeof s === "string" && s.length > 0);
}

function flattenProseMirror(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  const node = value as { type?: string; text?: string; content?: unknown };
  if (typeof node.text === "string") return node.text;
  if (Array.isArray(node.content)) {
    const sep = node.type === "paragraph" || node.type === "heading" ? "\n" : "";
    return node.content.map((c) => flattenProseMirror(c)).join(sep);
  }
  return "";
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function findCacheFile(): Promise<string | null> {
  const candidates = CACHE_PATHS[process.platform] ?? [];
  for (const p of candidates) {
    try {
      await fs.access(p);
      return p;
    } catch {
      // continue
    }
  }
  // Last resort: scan for any cache-v*.json file in the Granola dir.
  const dir = path.dirname(candidates[0] ?? "");
  if (dir) {
    try {
      const entries = await fs.readdir(dir);
      const match = entries.find((e) => /^cache-v\d+\.json$/.test(e));
      if (match) return path.join(dir, match);
    } catch {
      // ignore
    }
  }
  return null;
}

function summarize(v: unknown, depth = 0): unknown {
  if (depth > 2) return typeof v === "object" ? "<truncated>" : v;
  if (Array.isArray(v)) return v.length === 0 ? "[]" : `[${v.length}] ${typeof v[0]}`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(o).slice(0, 12).map(([k, val]) => [
        k,
        Array.isArray(val)
          ? `[${val.length}]`
          : val && typeof val === "object"
            ? depth < 1
              ? summarize(val, depth + 1)
              : `{${Object.keys(val as Record<string, unknown>).length}}`
            : typeof val === "string" && val.length > 60
              ? val.slice(0, 60) + "…"
              : val,
      ]),
    );
  }
  return v;
}

export async function diagnoseGranolaCache(): Promise<{
  found: string | null;
  size?: number;
  topLevelKeys?: string[];
  documentsCount?: number;
  cacheShape?: unknown;
  sampleDoc?: unknown;
}> {
  const file = await findCacheFile();
  if (!file) return { found: null };
  let size: number | undefined;
  try {
    const stat = await fs.stat(file);
    size = stat.size;
  } catch {
    // ignore
  }
  const data = await readJson<unknown>(file);
  if (!data || typeof data !== "object") return { found: file, size };
  const topLevelKeys = Object.keys(data as Record<string, unknown>);

  // Probe shape — print full structure summary so we see where docs live.
  const cache = (data as Record<string, unknown>).cache;
  const cacheShape =
    cache && typeof cache === "object" ? summarize(cache) : summarize(data);

  const { documents } = unwrapCache(data);
  return {
    found: file,
    size,
    topLevelKeys,
    documentsCount: documents.length,
    cacheShape,
    sampleDoc: documents[0] ? summarize(documents[0]) : undefined,
    sampleDocFull:
      documents[0] && typeof documents[0] === "object"
        ? Object.keys(documents[0] as Record<string, unknown>)
        : undefined,
  } as never;
}

// The cache shape varies between Granola versions. Most observed shapes:
//   { cache: { state: { documents: [...], transcripts: {...} } } }
//   { cache: { documents: [...], transcripts: {...} } }
//   { state: { documents: [...] } }
// We probe defensively.
function asDocumentList(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (v && typeof v === "object") {
    return Object.values(v as Record<string, unknown>);
  }
  return [];
}

function unwrapCache(file: unknown): {
  documents: unknown[];
  transcripts: Record<string, unknown>;
} {
  const candidates: unknown[] = [];
  if (file && typeof file === "object") {
    const f = file as Record<string, unknown>;
    candidates.push(f);
    if (f.cache) candidates.push(f.cache);
    if (f.state) candidates.push(f.state);
    const cacheState = (f.cache as Record<string, unknown> | undefined)?.state;
    if (cacheState) candidates.push(cacheState);
  }
  for (const c of candidates) {
    if (!c || typeof c !== "object") continue;
    const o = c as Record<string, unknown>;
    const docs = asDocumentList(o.documents);
    if (docs.length > 0) {
      const transcripts =
        o.transcripts && typeof o.transcripts === "object" && !Array.isArray(o.transcripts)
          ? (o.transcripts as Record<string, unknown>)
          : {};
      return { documents: docs, transcripts };
    }
  }
  return { documents: [], transcripts: {} };
}

function extractTranscript(value: unknown): string | undefined {
  if (!value) return undefined;
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const lines = value
      .map((seg) => {
        if (typeof seg === "string") return seg;
        if (seg && typeof seg === "object") {
          const s = seg as { speaker?: unknown; text?: unknown };
          const speaker = asString(s.speaker);
          const text = asString(s.text);
          if (text) return speaker ? `${speaker}: ${text}` : text;
        }
        return "";
      })
      .filter(Boolean);
    return lines.join("\n") || undefined;
  }
  return undefined;
}

export async function isGranolaCacheAvailable(): Promise<boolean> {
  return (await findCacheFile()) !== null;
}

export async function readGranolaCache(opts: {
  days?: number;
  limit?: number;
}): Promise<GranolaMeeting[]> {
  const file = await findCacheFile();
  if (!file) return [];

  const data = await readJson<unknown>(file);
  if (!data) return [];

  const { documents, transcripts } = unwrapCache(data);
  const cutoff =
    opts.days != null
      ? Date.now() - Math.max(1, opts.days) * 24 * 60 * 60 * 1000
      : 0;
  const limit = Math.max(1, Math.min(200, opts.limit ?? 25));

  const meetings: GranolaMeeting[] = [];
  for (const doc of documents) {
    if (!doc || typeof doc !== "object") continue;
    const d = doc as Record<string, unknown>;
    const id = asString(d.id) ?? asString(d.uuid) ?? asString(d.document_id);
    if (!id) continue;
    if (d.deleted_at) continue;

    const createdAtRaw =
      asString(d.created_at) ??
      asString(d.createdAt) ??
      asString(d.updated_at) ??
      asString(d.date);
    const createdMs = createdAtRaw ? Date.parse(createdAtRaw) : NaN;
    if (Number.isFinite(createdMs) && createdMs < cutoff) continue;

    const calEventTitle = (() => {
      const ce = d.google_calendar_event;
      if (!ce || typeof ce !== "object") return undefined;
      return asString((ce as { summary?: unknown }).summary);
    })();

    const title =
      asString(d.title) ??
      asString(d.name) ??
      calEventTitle ??
      asString((d.meeting as Record<string, unknown> | undefined)?.title) ??
      "Untitled meeting";

    const attendees = asArrayOfStrings(
      d.attendees ?? d.participants ?? d.people ?? [],
    );

    // Calendar event embeds attendees too — fall back when `people` empty.
    const calEvent = d.google_calendar_event;
    if (
      attendees.length === 0 &&
      calEvent &&
      typeof calEvent === "object"
    ) {
      const att = (calEvent as { attendees?: unknown }).attendees;
      attendees.push(...asArrayOfStrings(att));
    }

    // Granola Desktop cache fields (cache-v6, observed):
    //  - title                 string
    //  - notes_markdown        string (markdown source — best for summary)
    //  - notes_plain           string
    //  - notes                 ProseMirror JSON (rich-text)
    //  - summary / overview    string (AI-generated when available)
    //  - people                array of attendees
    const summary =
      asString(d.notes_markdown) ||
      asString(d.summary) ||
      asString(d.overview) ||
      flattenProseMirror(d.ai_summary) ||
      "";

    const privateNotes =
      asString(d.notes_plain) ||
      flattenProseMirror(d.notes) ||
      flattenProseMirror(d.private_notes);

    const transcript = extractTranscript(transcripts[id]);

    const body = [summary, privateNotes, transcript ? `--- Transcript ---\n${transcript}` : ""]
      .map((s) => (s ?? "").trim())
      .filter(Boolean)
      .join("\n\n");

    // Skip docs with no usable content AND no real title — those are
    // calendar entries that never became a real meeting.
    const titleIsUntitled =
      title === "Untitled meeting" || title.length === 0;
    if (titleIsUntitled && body.length === 0) continue;

    meetings.push({
      id,
      title,
      createdAt: createdAtRaw ?? new Date().toISOString(),
      attendees,
      summary: summary || body.slice(0, 800),
      privateNotes: privateNotes || undefined,
    });
  }

  meetings.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return meetings.slice(0, limit);
}
