import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { paths } from "./mesh-state";
import { isGranolaCacheAvailable } from "./granola-cache";
import { getOAuthTokens, hasOAuthSession } from "./granola-oauth";

// ── Constants ───────────────────────────────────────────────────────────

const DESKTOP_TOKEN_PATHS: Record<NodeJS.Platform, string | null> = {
  darwin: path.join(os.homedir(), "Library/Application Support/Granola/supabase.json"),
  linux: path.join(os.homedir(), ".config/Granola/supabase.json"),
  win32: path.join(os.homedir(), "AppData/Roaming/Granola/supabase.json"),
  aix: null,
  android: null,
  freebsd: null,
  haiku: null,
  openbsd: null,
  sunos: null,
  cygwin: null,
  netbsd: null,
};

const CACHE_PATH = path.join(paths.root, "granola-cache.json");

// WorkOS token endpoint. Granola Desktop registers via Dynamic Client
// Registration; the same client_id used to obtain the original token is
// embedded in the refresh request implicitly via the refresh_token, but
// WorkOS's user_management endpoint does require a client_id. We default
// to the public client id used by Granola Desktop. If refresh fails with
// 401, we fall back to needs_login.
const WORKOS_AUTH_URL = "https://api.workos.com/user_management/authenticate";
const GRANOLA_CLIENT_ID = "client_01J1G1JYP7H1D8VJZJ1B3RFYK1";

const SAFETY_BUFFER_MS = 60_000;

// ── Types ───────────────────────────────────────────────────────────────

export type GranolaTokenStatus = "linked" | "needs_login" | "not_installed";

export type GranolaTokenInfo = {
  status: GranolaTokenStatus;
  email?: string;
  expiresAt?: string;
  source?: "desktop" | "cache";
};

export type ResolvedToken = {
  accessToken: string;
  email: string;
  expiresAt: string;
};

type DesktopTokenFile = {
  workos_tokens?: string;
  session_id?: string;
  user_info?: string;
};

type WorkosTokens = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  obtained_at: number;
  token_type?: string;
  session_id?: string;
};

type UserInfo = {
  email?: string;
};

type Cache = {
  accessToken: string;
  refreshToken: string;
  email: string;
  expiresAt: string;
};

// ── Helpers ─────────────────────────────────────────────────────────────

function desktopTokenPath(): string | null {
  return DESKTOP_TOKEN_PATHS[process.platform] ?? null;
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw) as T;
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

async function readCache(): Promise<Cache | null> {
  return readJson<Cache>(CACHE_PATH);
}

async function writeCache(cache: Cache): Promise<void> {
  await fs.mkdir(path.dirname(CACHE_PATH), { recursive: true });
  await fs.writeFile(CACHE_PATH, JSON.stringify(cache, null, 2) + "\n", "utf8");
}

async function readDesktopTokens(): Promise<{
  tokens: WorkosTokens;
  email: string;
} | null> {
  const file = desktopTokenPath();
  if (!file) return null;
  const data = await readJson<DesktopTokenFile>(file);
  if (!data) return null;

  let tokens: WorkosTokens | null = null;
  if (typeof data.workos_tokens === "string") {
    try {
      tokens = JSON.parse(data.workos_tokens) as WorkosTokens;
    } catch {
      tokens = null;
    }
  }
  if (!tokens || !tokens.access_token || !tokens.refresh_token) return null;

  let email = "";
  if (typeof data.user_info === "string") {
    try {
      const ui = JSON.parse(data.user_info) as UserInfo;
      if (ui.email) email = ui.email;
    } catch {
      // ignore
    }
  }
  return { tokens, email };
}

function tokenExpiresAt(t: WorkosTokens): number {
  return t.obtained_at + t.expires_in * 1000;
}

function isExpired(at: number): boolean {
  return Date.now() + SAFETY_BUFFER_MS >= at;
}

async function refreshAccessToken(refreshToken: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
} | null> {
  try {
    const res = await fetch(WORKOS_AUTH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: GRANOLA_CLIENT_ID,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };
    if (!json.access_token) return null;
    const expiresIn = typeof json.expires_in === "number" ? json.expires_in : 3600;
    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token ?? refreshToken,
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    };
  } catch {
    return null;
  }
}

// ── Public API ──────────────────────────────────────────────────────────

export async function inspectGranolaInstall(): Promise<GranolaTokenInfo> {
  // Highest priority: OAuth session that the user explicitly granted to
  // this app. Treats Granola as linked even if the desktop app is absent.
  if (await hasOAuthSession()) {
    const oauth = await getOAuthTokens();
    return {
      status: "linked",
      email: oauth?.email,
      expiresAt: oauth?.expiresAt,
      source: "cache",
    };
  }
  const cache = await readCache();
  if (cache) {
    const expAt = Date.parse(cache.expiresAt);
    if (Number.isFinite(expAt) && !isExpired(expAt)) {
      return {
        status: "linked",
        email: cache.email,
        expiresAt: cache.expiresAt,
        source: "cache",
      };
    }
  }

  const desktop = await readDesktopTokens();
  if (!desktop) {
    // No desktop token file — but if a Granola cache file exists, the
    // app IS installed and we can still serve meetings from cache.
    if (await isGranolaCacheAvailable()) {
      return { status: "linked", source: "cache" };
    }
    return { status: "not_installed" };
  }

  const expAt = tokenExpiresAt(desktop.tokens);
  if (!isExpired(expAt)) {
    return {
      status: "linked",
      email: desktop.email,
      expiresAt: new Date(expAt).toISOString(),
      source: "desktop",
    };
  }

  // Desktop tokens expired — try silent refresh.
  const refreshed = await refreshAccessToken(desktop.tokens.refresh_token);
  if (refreshed) {
    await writeCache({
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken,
      email: desktop.email,
      expiresAt: refreshed.expiresAt,
    });
    return {
      status: "linked",
      email: desktop.email,
      expiresAt: refreshed.expiresAt,
      source: "cache",
    };
  }
  // Refresh failed — but if local cache is present we can still pull
  // meetings from disk; treat as linked-via-cache and surface the email.
  if (await isGranolaCacheAvailable()) {
    return { status: "linked", email: desktop.email, source: "cache" };
  }
  return { status: "needs_login", email: desktop.email };
}

export async function resolveAccessToken(): Promise<ResolvedToken | null> {
  const cache = await readCache();
  if (cache) {
    const expAt = Date.parse(cache.expiresAt);
    if (Number.isFinite(expAt) && !isExpired(expAt)) {
      return {
        accessToken: cache.accessToken,
        email: cache.email,
        expiresAt: cache.expiresAt,
      };
    }
    // Cache expired — try refreshing using cached refresh token.
    const refreshed = await refreshAccessToken(cache.refreshToken);
    if (refreshed) {
      await writeCache({
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
        email: cache.email,
        expiresAt: refreshed.expiresAt,
      });
      return {
        accessToken: refreshed.accessToken,
        email: cache.email,
        expiresAt: refreshed.expiresAt,
      };
    }
    // Fall through to desktop tokens.
  }

  const desktop = await readDesktopTokens();
  if (!desktop) return null;

  const expAt = tokenExpiresAt(desktop.tokens);
  if (!isExpired(expAt)) {
    // Hot path: desktop token still valid — use directly without writing cache.
    return {
      accessToken: desktop.tokens.access_token,
      email: desktop.email,
      expiresAt: new Date(expAt).toISOString(),
    };
  }

  const refreshed = await refreshAccessToken(desktop.tokens.refresh_token);
  if (!refreshed) return null;
  await writeCache({
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken,
    email: desktop.email,
    expiresAt: refreshed.expiresAt,
  });
  return {
    accessToken: refreshed.accessToken,
    email: desktop.email,
    expiresAt: refreshed.expiresAt,
  };
}

export async function clearGranolaCache(): Promise<void> {
  try {
    await fs.unlink(CACHE_PATH);
  } catch {
    // ignore
  }
}
