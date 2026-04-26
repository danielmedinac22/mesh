import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { resolveAccessToken } from "./granola-token";
import { isGranolaCacheAvailable, readGranolaCache } from "./granola-cache";
import {
  GranolaOAuthProvider,
  hasOAuthSession,
} from "./granola-oauth";

export const GRANOLA_DEFAULT_DAYS = 3;
export const GRANOLA_MAX_LIMIT = 50;
export const GRANOLA_MCP_URL = "https://mcp.granola.ai/mcp";

export class GranolaNotLinkedError extends Error {
  code = "not_linked" as const;
  constructor(message = "Granola MCP is not linked on this machine") {
    super(message);
    this.name = "GranolaNotLinkedError";
  }
}

export type GranolaMeeting = {
  id: string;
  title: string;
  createdAt: string;
  attendees: string[];
  summary: string;
  privateNotes?: string;
};

type ListMeetingsItem = {
  id?: unknown;
  uuid?: unknown;
  title?: unknown;
  name?: unknown;
  created_at?: unknown;
  createdAt?: unknown;
  date?: unknown;
};

type GetMeetingsItem = {
  id?: unknown;
  uuid?: unknown;
  title?: unknown;
  name?: unknown;
  created_at?: unknown;
  createdAt?: unknown;
  attendees?: unknown;
  ai_summary?: unknown;
  summary?: unknown;
  notes?: unknown;
  private_notes?: unknown;
  privateNotes?: unknown;
};

type CallToolResult = {
  content?: Array<{ type?: string; text?: string }>;
  structuredContent?: unknown;
  isError?: boolean;
};

// ── Helpers ─────────────────────────────────────────────────────────────

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v : undefined;
}

function asArrayOfStrings(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object") {
        const o = item as { email?: unknown; name?: unknown };
        return asString(o.email) ?? asString(o.name);
      }
      return undefined;
    })
    .filter((s): s is string => typeof s === "string" && s.length > 0);
}

// Granola summaries are returned as ProseMirror JSON in some contexts; in
// the MCP they usually come back already flattened to text. We accept both.
function flattenProseMirror(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  const node = value as { type?: string; text?: string; content?: unknown };
  if (typeof node.text === "string") return node.text;
  if (Array.isArray(node.content)) {
    return node.content.map((c) => flattenProseMirror(c)).join(node.type === "paragraph" ? "\n" : "");
  }
  return "";
}

function parseStructured(result: CallToolResult): unknown {
  if (result.structuredContent !== undefined) return result.structuredContent;
  const text = result.content?.find((c) => c.type === "text")?.text;
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function pickArray(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") {
    const o = payload as { meetings?: unknown; items?: unknown; results?: unknown; data?: unknown };
    for (const k of ["meetings", "items", "results", "data"] as const) {
      const v = o[k];
      if (Array.isArray(v)) return v;
    }
  }
  return [];
}

function meetingId(item: ListMeetingsItem | GetMeetingsItem): string | undefined {
  return asString(item.id) ?? asString(item.uuid);
}

function meetingTitle(item: ListMeetingsItem | GetMeetingsItem): string {
  return asString(item.title) ?? asString(item.name) ?? "Untitled meeting";
}

function meetingCreatedAt(item: ListMeetingsItem | GetMeetingsItem): string {
  return (
    asString(item.created_at) ??
    asString(item.createdAt) ??
    asString((item as ListMeetingsItem).date) ??
    new Date().toISOString()
  );
}

// ── Connection ──────────────────────────────────────────────────────────

async function connectWithBearer(accessToken: string): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(GRANOLA_MCP_URL), {
    requestInit: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });
  const client = new Client(
    { name: "mesh", version: "0.1.0" },
    { capabilities: {} },
  );
  await client.connect(transport);
  return client;
}

async function connectWithOAuth(): Promise<Client> {
  // The provider supplies tokens it previously stored. The redirect URL
  // is irrelevant here (no new auth flow happens during a connect that
  // already has tokens), so we hand it a placeholder.
  const provider = new GranolaOAuthProvider(
    "http://localhost/api/integrations/granola/oauth/callback",
  );
  const transport = new StreamableHTTPClientTransport(new URL(GRANOLA_MCP_URL), {
    authProvider: provider,
  });
  const client = new Client(
    { name: "mesh", version: "0.1.0" },
    { capabilities: {} },
  );
  await client.connect(transport);
  return client;
}

// ── Public ──────────────────────────────────────────────────────────────

export async function fetchRecentMeetings(opts: {
  days?: number;
  limit?: number;
}): Promise<GranolaMeeting[]> {
  const days = Math.max(1, Math.min(60, opts.days ?? GRANOLA_DEFAULT_DAYS));
  const limit = Math.max(1, Math.min(GRANOLA_MAX_LIMIT, opts.limit ?? 20));

  // Primary path: read the local Granola Desktop cache. This is what
  // community Granola MCP servers do internally and is the only path
  // that works without going through the MCP's own OAuth/DCR flow.
  // If the cache file exists, it IS the source of truth for this user —
  // even an empty window is a valid result (no meetings in last N days).
  if (await isGranolaCacheAvailable()) {
    try {
      return await readGranolaCache({ days, limit });
    } catch (err) {
      console.error("[granola-mcp] cache read failed:", err);
      // Only fall through to MCP if cache read genuinely errored.
    }
  }

  // Fallback A: OAuth-authenticated remote MCP. Used when no Desktop is
  // installed but the user has signed in via the OAuth flow.
  if (await hasOAuthSession()) {
    try {
      const client = await connectWithOAuth();
      return await fetchViaClient(client, days, limit);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[granola-mcp] OAuth connect failed:", msg);
      if (err instanceof UnauthorizedError) {
        throw new GranolaNotLinkedError(
          "Granola OAuth session expired — sign in again",
        );
      }
      // Not auth-related — surface as generic error.
      throw err;
    }
  }

  // Fallback B: bare Bearer token (Desktop WorkOS). Generally rejected by
  // the public MCP but kept for self-hosted / custom deployments.
  const token = await resolveAccessToken();
  if (!token) throw new GranolaNotLinkedError();

  const client = await connectWithBearer(token.accessToken).catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[granola-mcp] connect failed:", msg);
    if (/401|403|unauth/i.test(msg)) {
      throw new GranolaNotLinkedError(
        `Granola MCP rejected token: ${msg.slice(0, 120)}`,
      );
    }
    throw err;
  });

  return fetchViaClient(client, days, limit);
}

async function fetchViaClient(
  client: Client,
  days: number,
  limit: number,
): Promise<GranolaMeeting[]> {
  try {
    const since = isoDaysAgo(days);
    const list = (await client.callTool({
      name: "list_meetings",
      arguments: {
        date_range: { start: since, end: new Date().toISOString() },
        limit,
      },
    })) as CallToolResult;

    if (list.isError) {
      throw new Error(
        list.content?.find((c) => c.type === "text")?.text ?? "list_meetings failed",
      );
    }

    const items = pickArray(parseStructured(list)) as ListMeetingsItem[];
    const ids = items.map(meetingId).filter((id): id is string => !!id);
    if (ids.length === 0) return [];

    const meetings: GranolaMeeting[] = [];
    for (let i = 0; i < ids.length; i += 10) {
      const batch = ids.slice(i, i + 10);
      const detail = (await client.callTool({
        name: "get_meetings",
        arguments: { uuids: batch },
      })) as CallToolResult;
      if (detail.isError) continue;
      const got = pickArray(parseStructured(detail)) as GetMeetingsItem[];
      for (const m of got) {
        const id = meetingId(m);
        if (!id) continue;
        meetings.push({
          id,
          title: meetingTitle(m),
          createdAt: meetingCreatedAt(m),
          attendees: asArrayOfStrings(m.attendees),
          summary:
            asString(flattenProseMirror(m.ai_summary)) ??
            asString(flattenProseMirror(m.summary)) ??
            "",
          privateNotes:
            asString(flattenProseMirror(m.private_notes)) ??
            asString(flattenProseMirror(m.privateNotes)) ??
            asString(flattenProseMirror(m.notes)),
        });
      }
    }

    meetings.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    return meetings;
  } finally {
    await client.close().catch(() => {});
  }
}
