import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  OAuthClientInformationFull,
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type {
  OAuthClientProvider,
  OAuthDiscoveryState,
} from "@modelcontextprotocol/sdk/client/auth.js";
import { paths } from "./mesh-state";

export const GRANOLA_MCP_SERVER_URL = "https://mcp.granola.ai/mcp";

// Persistence ────────────────────────────────────────────────────────────

const STATE_FILE = path.join(paths.root, "granola-oauth.json");
const PENDING_FILE = path.join(paths.root, "granola-oauth-pending.json");

type StoredState = {
  redirectUrl: string;
  clientInformation?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  codeVerifier?: string;
  discoveryState?: OAuthDiscoveryState;
  tokenObtainedAt?: number;
  email?: string;
};

type PendingAuth = {
  authorizationUrl: string;
  redirectUrl: string;
  startedAt: string;
};

async function readState(): Promise<StoredState | null> {
  try {
    const raw = await fs.readFile(STATE_FILE, "utf8");
    return JSON.parse(raw) as StoredState;
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

async function writeState(s: StoredState): Promise<void> {
  await fs.mkdir(path.dirname(STATE_FILE), { recursive: true });
  await fs.writeFile(STATE_FILE, JSON.stringify(s, null, 2) + "\n", "utf8");
}

async function patchState(patch: Partial<StoredState>): Promise<StoredState> {
  const cur = (await readState()) ?? { redirectUrl: patch.redirectUrl ?? "" };
  const next: StoredState = { ...cur, ...patch };
  if (!next.redirectUrl) throw new Error("redirectUrl missing");
  await writeState(next);
  return next;
}

export async function readPendingAuth(): Promise<PendingAuth | null> {
  try {
    const raw = await fs.readFile(PENDING_FILE, "utf8");
    return JSON.parse(raw) as PendingAuth;
  } catch {
    return null;
  }
}

export async function clearPendingAuth(): Promise<void> {
  try {
    await fs.unlink(PENDING_FILE);
  } catch {
    /* ignore */
  }
}

async function writePendingAuth(p: PendingAuth): Promise<void> {
  await fs.mkdir(path.dirname(PENDING_FILE), { recursive: true });
  await fs.writeFile(PENDING_FILE, JSON.stringify(p, null, 2) + "\n", "utf8");
}

export async function clearOAuthState(): Promise<void> {
  try {
    await fs.unlink(STATE_FILE);
  } catch {
    /* ignore */
  }
  await clearPendingAuth();
}

export async function getOAuthTokens(): Promise<{
  accessToken: string;
  expiresAt?: string;
  email?: string;
} | null> {
  const s = await readState();
  if (!s?.tokens?.access_token) return null;
  const obtainedAt = s.tokenObtainedAt ?? 0;
  const expiresIn = s.tokens.expires_in;
  const expiresAt =
    typeof expiresIn === "number"
      ? new Date(obtainedAt + expiresIn * 1000).toISOString()
      : undefined;
  return {
    accessToken: s.tokens.access_token,
    expiresAt,
    email: s.email,
  };
}

export async function hasOAuthSession(): Promise<boolean> {
  const s = await readState();
  return !!s?.tokens?.access_token;
}

// Provider implementation ────────────────────────────────────────────────

export class GranolaOAuthProvider implements OAuthClientProvider {
  private readonly _redirectUrl: string;
  private readonly _clientName: string;

  constructor(redirectUrl: string, clientName = "Mesh") {
    this._redirectUrl = redirectUrl;
    this._clientName = clientName;
  }

  get redirectUrl(): string {
    return this._redirectUrl;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: this._clientName,
      redirect_uris: [this._redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: "openid profile email offline_access",
    };
  }

  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    const s = await readState();
    if (!s?.clientInformation) return undefined;
    // If a previous DCR registered against a different redirect URL, force
    // re-registration so the new port works.
    const reg = s.clientInformation as OAuthClientInformationFull;
    if (
      Array.isArray(reg.redirect_uris) &&
      reg.redirect_uris.length > 0 &&
      !reg.redirect_uris.includes(this._redirectUrl)
    ) {
      return undefined;
    }
    return s.clientInformation;
  }

  async saveClientInformation(info: OAuthClientInformationMixed): Promise<void> {
    await patchState({
      clientInformation: info,
      redirectUrl: this._redirectUrl,
    });
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    const s = await readState();
    return s?.tokens;
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    await patchState({
      tokens,
      tokenObtainedAt: Date.now(),
      redirectUrl: this._redirectUrl,
    });
  }

  async redirectToAuthorization(url: URL): Promise<void> {
    // Server-side: we can't redirect a user agent. Capture the URL so the
    // calling API route can return it to the browser.
    await writePendingAuth({
      authorizationUrl: url.toString(),
      redirectUrl: this._redirectUrl,
      startedAt: new Date().toISOString(),
    });
  }

  async saveCodeVerifier(verifier: string): Promise<void> {
    await patchState({
      codeVerifier: verifier,
      redirectUrl: this._redirectUrl,
    });
  }

  async codeVerifier(): Promise<string> {
    const s = await readState();
    if (!s?.codeVerifier) {
      throw new Error("missing PKCE code verifier — restart the OAuth flow");
    }
    return s.codeVerifier;
  }

  async saveDiscoveryState(state: OAuthDiscoveryState): Promise<void> {
    await patchState({
      discoveryState: state,
      redirectUrl: this._redirectUrl,
    });
  }

  async discoveryState(): Promise<OAuthDiscoveryState | undefined> {
    const s = await readState();
    return s?.discoveryState;
  }

  async invalidateCredentials(
    scope: "all" | "client" | "tokens" | "verifier" | "discovery",
  ): Promise<void> {
    const cur = (await readState()) ?? { redirectUrl: this._redirectUrl };
    const next: StoredState = { ...cur };
    if (scope === "all") {
      await clearOAuthState();
      return;
    }
    if (scope === "tokens") delete next.tokens;
    if (scope === "verifier") delete next.codeVerifier;
    if (scope === "client") delete next.clientInformation;
    if (scope === "discovery") delete next.discoveryState;
    await writeState(next);
  }
}

// Helper — derive a redirect URL from a Next.js request.
export function redirectUrlFromRequest(req: Request): string {
  const u = new URL(req.url);
  return `${u.protocol}//${u.host}/api/integrations/granola/oauth/callback`;
}

export async function setOAuthEmail(email: string): Promise<void> {
  await patchState({ email, redirectUrl: (await readState())?.redirectUrl ?? "" });
}
