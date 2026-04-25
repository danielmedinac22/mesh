"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MESH, Pill, Dot } from "@/components/mesh";
import {
  ErrorBanner,
  SectionHeader,
  type EngineStatus,
} from "./engine-section";

type AuthState =
  | { state: "loading" }
  | { state: "signed-in"; user: string }
  | {
      state: "signed-out";
      error?: string;
      installHint?: { command: string; platform: string; fallback?: string };
    }
  | {
      state: "not-installed";
      error?: string;
      installHint?: { command: string; platform: string; fallback?: string };
    };

type FlowState =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "awaiting-code" }
  | { kind: "awaiting-auth"; code: string; verifyUrl: string }
  | { kind: "success" }
  | { kind: "error"; message: string }
  | { kind: "cancelled" };

export function GithubSection({
  onStatus,
}: {
  onStatus?: (s: EngineStatus, message?: string) => void;
}) {
  const [auth, setAuth] = useState<AuthState>({ state: "loading" });
  const [flow, setFlow] = useState<FlowState>({ kind: "idle" });
  const [showPat, setShowPat] = useState(false);
  const [pat, setPat] = useState("");
  const [patSubmitting, setPatSubmitting] = useState(false);
  const [patError, setPatError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const sourceRef = useRef<EventSource | null>(null);

  const loadAuth = useCallback(async () => {
    try {
      const res = await fetch("/api/github/auth", { cache: "no-store" });
      const json = (await res.json()) as {
        state?: string;
        user?: string;
        error?: string;
        installHint?: { command: string; platform: string; fallback?: string };
      };
      if (json.state === "signed-in" && json.user) {
        setAuth({ state: "signed-in", user: json.user });
      } else if (json.state === "not-installed") {
        setAuth({
          state: "not-installed",
          error: json.error,
          installHint: json.installHint,
        });
      } else {
        setAuth({
          state: "signed-out",
          error: json.error,
          installHint: json.installHint,
        });
      }
    } catch (err) {
      setAuth({
        state: "signed-out",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  useEffect(() => {
    onStatus?.("loading");
    void (async () => {
      await loadAuth();
      onStatus?.("ready");
    })();
  }, [loadAuth, onStatus]);

  // Cleanup SSE on unmount.
  useEffect(() => {
    return () => {
      if (sourceRef.current) {
        sourceRef.current.close();
        sourceRef.current = null;
      }
    };
  }, []);

  function startFlow() {
    if (sourceRef.current) {
      sourceRef.current.close();
      sourceRef.current = null;
    }
    setFlow({ kind: "starting" });
    onStatus?.("saving");
    const es = new EventSource("/api/github/login/start");
    sourceRef.current = es;
    es.addEventListener("code", (e) => {
      const data = JSON.parse((e as MessageEvent).data) as {
        code: string;
        verifyUrl: string;
      };
      setFlow({
        kind: "awaiting-auth",
        code: data.code,
        verifyUrl: data.verifyUrl,
      });
    });
    es.addEventListener("done", () => {
      setFlow({ kind: "success" });
      onStatus?.("saved");
      es.close();
      sourceRef.current = null;
      void loadAuth();
    });
    es.addEventListener("error", (e) => {
      // EventSource fires generic error events on disconnect — only treat the
      // server-sent `error` event with payload as fatal. Connection drops are
      // logged but we keep the state if we already have a code.
      const ev = e as MessageEvent;
      if (typeof ev.data === "string" && ev.data) {
        try {
          const parsed = JSON.parse(ev.data) as { message: string };
          setFlow({ kind: "error", message: parsed.message });
          onStatus?.("error", parsed.message);
        } catch {
          /* swallow */
        }
        es.close();
        sourceRef.current = null;
      }
    });
    // Move to awaiting-code immediately so the UI shows the spinner.
    setTimeout(() => {
      setFlow((cur) => (cur.kind === "starting" ? { kind: "awaiting-code" } : cur));
    }, 100);
  }

  async function cancelFlow() {
    if (sourceRef.current) {
      sourceRef.current.close();
      sourceRef.current = null;
    }
    try {
      await fetch("/api/github/login/cancel", { method: "POST" });
    } catch {
      /* ignore */
    }
    setFlow({ kind: "cancelled" });
  }

  async function submitPat() {
    setPatSubmitting(true);
    setPatError(null);
    onStatus?.("saving");
    try {
      const res = await fetch("/api/github/login/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: pat }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setPat("");
      setShowPat(false);
      setFlow({ kind: "success" });
      onStatus?.("saved");
      await loadAuth();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setPatError(msg);
      onStatus?.("error", msg);
    } finally {
      setPatSubmitting(false);
    }
  }

  async function signOut() {
    setSigningOut(true);
    setSignOutError(null);
    try {
      const res = await fetch("/api/github/logout", { method: "POST" });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      await loadAuth();
    } catch (err) {
      setSignOutError(err instanceof Error ? err.message : String(err));
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <SectionHeader
        title="GitHub"
        kicker="connection · gh cli"
        caption="Mesh uses the GitHub CLI to clone repos, list branches, and open PRs. Connect once from here — no terminal needed."
      />

      {auth.state === "loading" && (
        <div
          className="font-mono"
          style={{ fontSize: 12, color: MESH.fgMute, padding: "8px 0" }}
        >
          checking GitHub auth…
        </div>
      )}

      {auth.state === "not-installed" && (
        <NotInstalled
          installHint={auth.installHint}
          onRefresh={loadAuth}
        />
      )}

      {auth.state === "signed-out" && flow.kind !== "awaiting-auth" && flow.kind !== "starting" && flow.kind !== "awaiting-code" && (
        <SignedOut
          onConnect={startFlow}
          onTogglePat={() => setShowPat((v) => !v)}
          showPat={showPat}
          pat={pat}
          onPatChange={setPat}
          onSubmitPat={submitPat}
          patSubmitting={patSubmitting}
          patError={patError}
          flowError={flow.kind === "error" ? flow.message : null}
          flowCancelled={flow.kind === "cancelled"}
        />
      )}

      {(flow.kind === "starting" ||
        flow.kind === "awaiting-code" ||
        flow.kind === "awaiting-auth") && (
        <DeviceFlowCard flow={flow} onCancel={cancelFlow} />
      )}

      {auth.state === "signed-in" && (
        <SignedIn
          user={auth.user}
          onRefresh={loadAuth}
          onSignOut={signOut}
          signingOut={signingOut}
          error={signOutError}
        />
      )}
    </div>
  );
}

function NotInstalled({
  installHint,
  onRefresh,
}: {
  installHint?: { command: string; platform: string; fallback?: string };
  onRefresh: () => void;
}) {
  const cmd = installHint?.command ?? "brew install gh";
  const platform = installHint?.platform ?? "your platform";
  return (
    <div
      style={{
        padding: 16,
        borderRadius: 8,
        border: "1px solid rgba(229,72,77,0.25)",
        background: "rgba(229,72,77,0.04)",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Pill tone="red">GitHub CLI not installed</Pill>
        <span className="font-mono" style={{ fontSize: 11, color: MESH.fgDim }}>
          Mesh uses <code style={{ color: MESH.amber }}>gh</code> for auth and cloning.
        </span>
      </div>
      <Kicker>Install on {platform}</Kicker>
      <CodeBlock text={cmd} />
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <PrimaryButton onClick={onRefresh}>I installed gh — check again</PrimaryButton>
        {installHint?.fallback && (
          <a
            href={installHint.fallback.replace(/^.*(https?:\/\/\S+).*/, "$1")}
            target="_blank"
            rel="noreferrer"
            className="font-mono"
            style={{
              fontSize: 11,
              color: MESH.amber,
              textDecoration: "underline",
            }}
          >
            other install methods ↗
          </a>
        )}
      </div>
    </div>
  );
}

function SignedOut({
  onConnect,
  onTogglePat,
  showPat,
  pat,
  onPatChange,
  onSubmitPat,
  patSubmitting,
  patError,
  flowError,
  flowCancelled,
}: {
  onConnect: () => void;
  onTogglePat: () => void;
  showPat: boolean;
  pat: string;
  onPatChange: (v: string) => void;
  onSubmitPat: () => void;
  patSubmitting: boolean;
  patError: string | null;
  flowError: string | null;
  flowCancelled: boolean;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div
        style={{
          padding: 18,
          borderRadius: 8,
          border: `1px solid ${MESH.border}`,
          background: MESH.bgElev,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Pill tone="amber">Not connected</Pill>
          <span
            className="font-mono"
            style={{ fontSize: 12, color: MESH.fgDim }}
          >
            sign in once to unlock Connect, Build, and Ship
          </span>
        </div>
        <p style={{ margin: 0, color: MESH.fgDim, fontSize: 13, lineHeight: 1.55 }}>
          Click <strong style={{ color: MESH.fg }}>Connect with GitHub</strong>{" "}
          to start a one-time device-flow login. Mesh runs{" "}
          <code style={{ color: MESH.amber }}>gh auth login --web</code> for
          you and shows the verification code right here.
        </p>
        {flowError && (
          <ErrorBanner message={`device flow failed: ${flowError}`} />
        )}
        {flowCancelled && (
          <span
            className="font-mono"
            style={{ fontSize: 11, color: MESH.fgMute }}
          >
            cancelled. you can try again.
          </span>
        )}
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <PrimaryButton onClick={onConnect}>Connect with GitHub</PrimaryButton>
          <button
            type="button"
            onClick={onTogglePat}
            className="font-mono"
            style={{
              background: "transparent",
              border: "none",
              color: MESH.amber,
              fontSize: 11.5,
              cursor: "pointer",
              textDecoration: "underline",
              padding: 0,
            }}
          >
            {showPat ? "hide token option" : "use a personal access token instead"}
          </button>
        </div>
        {showPat && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 10,
              paddingTop: 6,
              borderTop: `1px solid ${MESH.border}`,
            }}
          >
            <Kicker>Personal access token</Kicker>
            <p style={{ margin: 0, color: MESH.fgMute, fontSize: 11.5, lineHeight: 1.5 }}>
              Create one at{" "}
              <a
                href="https://github.com/settings/tokens/new?scopes=repo,workflow,read:org"
                target="_blank"
                rel="noreferrer"
                style={{ color: MESH.amber, textDecoration: "underline" }}
              >
                github.com/settings/tokens
              </a>{" "}
              with <code>repo</code>, <code>workflow</code>, and{" "}
              <code>read:org</code> scopes.
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="password"
                value={pat}
                onChange={(e) => onPatChange(e.target.value)}
                placeholder="ghp_…"
                disabled={patSubmitting}
                className="font-mono"
                style={{
                  flex: 1,
                  padding: "10px 12px",
                  borderRadius: 6,
                  border: `1px solid ${MESH.border}`,
                  background: MESH.bgInput,
                  color: MESH.fg,
                  fontSize: 13,
                  outline: "none",
                }}
              />
              <PrimaryButton
                onClick={onSubmitPat}
                disabled={patSubmitting || !pat.trim()}
              >
                {patSubmitting ? "signing in…" : "Sign in"}
              </PrimaryButton>
            </div>
            {patError && <ErrorBanner message={patError} />}
          </div>
        )}
      </div>
    </div>
  );
}

function DeviceFlowCard({
  flow,
  onCancel,
}: {
  flow:
    | { kind: "starting" }
    | { kind: "awaiting-code" }
    | { kind: "awaiting-auth"; code: string; verifyUrl: string };
  onCancel: () => void;
}) {
  const isWaitingForCode = flow.kind === "starting" || flow.kind === "awaiting-code";
  return (
    <div
      style={{
        padding: 22,
        borderRadius: 10,
        border: "1px solid rgba(245,165,36,0.35)",
        background: "rgba(245,165,36,0.04)",
        display: "flex",
        flexDirection: "column",
        gap: 18,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Pill tone="amber">
          <Dot color={MESH.amber} size={5} />
          Device flow active
        </Pill>
      </div>

      {isWaitingForCode ? (
        <div
          className="font-mono"
          style={{
            fontSize: 13,
            color: MESH.fgDim,
            paddingTop: 4,
          }}
        >
          starting gh auth login…
        </div>
      ) : (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Kicker>One-time code</Kicker>
            <div
              className="font-mono"
              style={{
                fontSize: 32,
                fontWeight: 600,
                color: MESH.amber,
                letterSpacing: "0.18em",
                lineHeight: 1,
              }}
            >
              {flow.code}
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <a
              href={flow.verifyUrl}
              target="_blank"
              rel="noreferrer"
              className="font-mono"
              style={{
                padding: "9px 14px",
                borderRadius: 6,
                background: MESH.amber,
                color: "#0B0B0C",
                fontSize: 12,
                fontWeight: 500,
                textDecoration: "none",
              }}
            >
              Open verification page ↗
            </a>
            <span
              className="font-mono"
              style={{ fontSize: 11, color: MESH.fgMute }}
            >
              {flow.verifyUrl}
            </span>
          </div>
          <div
            style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 4 }}
          >
            <Spinner />
            <span
              className="font-mono"
              style={{ fontSize: 11, color: MESH.fgDim }}
            >
              waiting for authorization…
            </span>
          </div>
        </>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          type="button"
          onClick={onCancel}
          className="font-mono"
          style={{
            background: "transparent",
            border: `1px solid ${MESH.border}`,
            borderRadius: 5,
            padding: "6px 12px",
            color: MESH.fgDim,
            fontSize: 11.5,
            cursor: "pointer",
          }}
        >
          cancel
        </button>
      </div>
    </div>
  );
}

function SignedIn({
  user,
  onRefresh,
  onSignOut,
  signingOut,
  error,
}: {
  user: string;
  onRefresh: () => void;
  onSignOut: () => void;
  signingOut: boolean;
  error: string | null;
}) {
  return (
    <div
      style={{
        padding: 16,
        borderRadius: 8,
        border: `1px solid ${MESH.border}`,
        background: MESH.bgElev,
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <Pill tone="green">
          <Dot color={MESH.green} size={5} />
          gh · {user}
        </Pill>
        <span className="font-mono" style={{ fontSize: 11, color: MESH.fgMute }}>
          signed in via GitHub CLI
        </span>
      </div>
      <p style={{ margin: 0, color: MESH.fgDim, fontSize: 12.5, lineHeight: 1.55 }}>
        You can clone repos, list branches, and open PRs from Mesh. Sign out
        if you want to switch accounts — Mesh will guide you through the device
        flow again.
      </p>
      {error && <ErrorBanner message={error} />}
      <div style={{ display: "flex", gap: 10 }}>
        <button
          type="button"
          onClick={onRefresh}
          className="font-mono"
          style={{
            padding: "8px 12px",
            borderRadius: 5,
            border: `1px solid ${MESH.border}`,
            background: "transparent",
            color: MESH.fgDim,
            fontSize: 11.5,
            cursor: "pointer",
          }}
        >
          refresh
        </button>
        <button
          type="button"
          onClick={onSignOut}
          disabled={signingOut}
          className="font-mono"
          style={{
            padding: "8px 12px",
            borderRadius: 5,
            border: `1px solid ${MESH.border}`,
            background: "transparent",
            color: MESH.red,
            fontSize: 11.5,
            cursor: signingOut ? "default" : "pointer",
            opacity: signingOut ? 0.6 : 1,
          }}
        >
          {signingOut ? "signing out…" : "Sign out"}
        </button>
      </div>
    </div>
  );
}

function PrimaryButton({
  onClick,
  children,
  disabled,
}: {
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="font-mono"
      style={{
        padding: "9px 14px",
        borderRadius: 6,
        border: `1px solid ${MESH.amber}`,
        background: MESH.amber,
        color: "#0B0B0C",
        fontSize: 12,
        fontWeight: 500,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.6 : 1,
      }}
    >
      {children}
    </button>
  );
}

function CodeBlock({ text }: { text: string }) {
  return (
    <div
      className="font-mono"
      style={{
        padding: "10px 14px",
        borderRadius: 6,
        border: `1px solid ${MESH.border}`,
        background: MESH.bgInput,
        color: MESH.fg,
        fontSize: 12,
        userSelect: "all",
        overflowX: "auto",
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ color: MESH.fgMute }}>$ </span>
      {text}
    </div>
  );
}

function Kicker({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="font-mono"
      style={{
        fontSize: 10,
        color: MESH.fgMute,
        textTransform: "uppercase",
        letterSpacing: "0.16em",
      }}
    >
      {children}
    </span>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden
      style={{
        width: 12,
        height: 12,
        borderRadius: 999,
        border: `1.5px solid ${MESH.border}`,
        borderTopColor: MESH.amber,
        display: "inline-block",
        animation: "mesh-spin 0.8s linear infinite",
      }}
    >
      <style>{`@keyframes mesh-spin { to { transform: rotate(360deg); } }`}</style>
    </span>
  );
}
