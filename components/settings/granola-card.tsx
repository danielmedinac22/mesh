"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  MESH,
  Pill,
  PrimaryButton,
  SecondaryButton,
} from "@/components/mesh";

type GranolaStatus = "linked" | "needs_login" | "not_installed" | "unknown";

type Props = {
  importedCount: number;
  lastImportAt?: string;
  bodyHint: string;
  onPasteTranscript: () => void;
  onChanged: () => void | Promise<void>;
};

type StatusResponse = {
  status: GranolaStatus;
  email?: string;
  expiresAt?: string;
};

export function GranolaCard({
  importedCount,
  lastImportAt,
  bodyHint,
  onPasteTranscript,
  onChanged,
}: Props) {
  const [status, setStatus] = useState<GranolaStatus>("unknown");
  const [email, setEmail] = useState<string | undefined>(undefined);
  const [linking, setLinking] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [days, setDays] = useState<number>(3);
  const [showCustom, setShowCustom] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doneFlash, setDoneFlash] = useState<string | null>(null);
  const flashTimer = useRef<NodeJS.Timeout | null>(null);

  // Surface oauth=ok / granola=error redirects (set by the callback route).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search);
    const flag = sp.get("granola");
    if (flag === "ok") {
      setError(null);
      setDoneFlash("Signed in");
      flashTimer.current && clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setDoneFlash(null), 4000);
    } else if (flag === "error") {
      setError(sp.get("message") ?? "OAuth flow failed");
    }
    if (flag) {
      sp.delete("granola");
      sp.delete("message");
      const remaining = sp.toString();
      const next =
        window.location.pathname +
        (remaining ? `?${remaining}` : "") +
        window.location.hash;
      window.history.replaceState(null, "", next);
    }
  }, []);

  const startOAuth = useCallback(async () => {
    setLinking(true);
    setError(null);
    try {
      const res = await fetch("/api/integrations/granola/oauth/start", {
        method: "POST",
      });
      const json = (await res.json()) as {
        status: "redirect" | "linked" | "error";
        authorizationUrl?: string;
        error?: string;
      };
      if (json.status === "linked") {
        await onChanged();
        setStatus("linked");
        return;
      }
      if (json.status === "redirect" && json.authorizationUrl) {
        window.location.href = json.authorizationUrl;
        return;
      }
      throw new Error(json.error ?? "OAuth start failed");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLinking(false);
    }
  }, [onChanged]);

  const reloadStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/integrations/granola/status", {
        cache: "no-store",
      });
      const json = (await res.json()) as StatusResponse;
      setStatus(json.status);
      setEmail(json.email);
    } catch {
      setStatus("unknown");
    }
  }, []);

  useEffect(() => {
    void reloadStatus();
  }, [reloadStatus]);

  const link = useCallback(async () => {
    setLinking(true);
    setError(null);
    try {
      const res = await fetch("/api/integrations/granola/link", {
        method: "POST",
      });
      const json = (await res.json()) as StatusResponse & { error?: string };
      setStatus(json.status);
      setEmail(json.email);
      if (!res.ok && json.error) setError(json.error);
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLinking(false);
    }
  }, [onChanged]);

  const refresh = useCallback(
    async (windowDays: number) => {
      setRefreshing(true);
      setError(null);
      setProgress("Connecting to Granola…");
      try {
        const res = await fetch("/api/integrations/granola/refresh", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ days: windowDays }),
        });
        if (!res.body) throw new Error("no stream body");
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let count = 0;
        let needsLogin = false;
        let errMsg: string | null = null;
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let idx = buf.indexOf("\n\n");
          while (idx >= 0) {
            const chunk = buf.slice(0, idx).trim();
            buf = buf.slice(idx + 2);
            if (chunk.startsWith("data: ")) {
              try {
                const ev = JSON.parse(chunk.slice(6));
                if (ev.type === "phase") setProgress(ev.label);
                else if (ev.type === "meeting") {
                  count += 1;
                  setProgress(`Stored ${count} meeting${count === 1 ? "" : "s"}…`);
                } else if (ev.type === "done") {
                  count = ev.count;
                } else if (ev.type === "error") {
                  errMsg = ev.message;
                  if (ev.code === "not_linked") needsLogin = true;
                }
              } catch {
                // ignore parse errors
              }
            }
            idx = buf.indexOf("\n\n");
          }
        }
        if (errMsg) {
          setError(errMsg);
          if (needsLogin) setStatus("needs_login");
        } else {
          setDoneFlash(`+${count} meeting${count === 1 ? "" : "s"} added`);
          if (flashTimer.current) clearTimeout(flashTimer.current);
          flashTimer.current = setTimeout(() => setDoneFlash(null), 3500);
        }
        await onChanged();
        await reloadStatus();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setRefreshing(false);
        setProgress(null);
      }
    },
    [onChanged, reloadStatus],
  );

  const pill =
    status === "linked" ? (
      <Pill tone="green">connected{email ? ` · ${email}` : ""}</Pill>
    ) : status === "needs_login" ? (
      <Pill tone="amber">signed out</Pill>
    ) : status === "not_installed" ? (
      <Pill tone="red">desktop app not detected</Pill>
    ) : (
      <Pill tone="dim">checking…</Pill>
    );

  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <h3
            style={{
              margin: 0,
              fontSize: 15,
              fontWeight: 600,
              color: MESH.fg,
              letterSpacing: "-0.01em",
            }}
          >
            Granola
          </h3>
          <span style={{ marginLeft: "auto" }}>{pill}</span>
        </div>
        <p
          style={{
            margin: 0,
            fontSize: 12.5,
            color: MESH.fgDim,
            lineHeight: 1.55,
          }}
        >
          Real meeting transcripts via the Granola MCP at{" "}
          <code style={codeInline}>mcp.granola.ai</code>. Auto-imports the last 3
          days into your brain so Mesh can recall decisions when planning.
        </p>
      </div>

      {status === "linked" && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <PrimaryButton
            onClick={() => refresh(3)}
            disabled={refreshing || linking}
          >
            {refreshing ? "Pulling…" : "Pull last 3 days"}
          </PrimaryButton>
          <SecondaryButton
            onClick={() => setShowCustom((v) => !v)}
            disabled={refreshing}
          >
            {showCustom ? "Hide custom" : "Pull custom…"}
          </SecondaryButton>
          <SecondaryButton onClick={onPasteTranscript} disabled={refreshing}>
            Paste transcript
          </SecondaryButton>
          <span style={{ flex: 1 }} />
          {progress && (
            <span
              className="font-mono"
              style={{ fontSize: 10.5, color: MESH.fgMute }}
            >
              {progress}
            </span>
          )}
          {doneFlash && (
            <span
              className="font-mono"
              style={{ fontSize: 10.5, color: MESH.green }}
            >
              {doneFlash}
            </span>
          )}
        </div>
      )}

      {status === "linked" && showCustom && (
        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            padding: "8px 10px",
            background: MESH.bgInput,
            borderRadius: 6,
            border: `1px solid ${MESH.border}`,
          }}
        >
          <span
            className="font-mono"
            style={{ fontSize: 11, color: MESH.fgDim }}
          >
            last
          </span>
          <input
            type="number"
            min={1}
            max={30}
            value={days}
            onChange={(e) => setDays(Math.max(1, Math.min(30, Number(e.target.value) || 1)))}
            style={{
              width: 56,
              padding: "4px 6px",
              background: MESH.bgElev,
              border: `1px solid ${MESH.border}`,
              borderRadius: 4,
              color: MESH.fg,
              fontSize: 12,
              outline: "none",
            }}
          />
          <span
            className="font-mono"
            style={{ fontSize: 11, color: MESH.fgDim }}
          >
            day{days === 1 ? "" : "s"}
          </span>
          <PrimaryButton
            onClick={() => {
              setShowCustom(false);
              void refresh(days);
            }}
            disabled={refreshing}
          >
            Pull
          </PrimaryButton>
        </div>
      )}

      {(status === "needs_login" || status === "not_installed") && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <PrimaryButton onClick={startOAuth} disabled={linking}>
            {linking ? "Redirecting…" : "Sign in with Granola"}
          </PrimaryButton>
          {status === "not_installed" ? (
            <a
              href="https://www.granola.ai/download"
              target="_blank"
              rel="noreferrer"
              style={{ textDecoration: "none" }}
            >
              <SecondaryButton>Install Desktop</SecondaryButton>
            </a>
          ) : (
            <SecondaryButton onClick={link} disabled={linking}>
              Re-check Desktop
            </SecondaryButton>
          )}
          <SecondaryButton onClick={onPasteTranscript}>
            Paste transcript
          </SecondaryButton>
        </div>
      )}

      {status === "unknown" && (
        <div
          className="font-mono"
          style={{ fontSize: 11, color: MESH.fgMute }}
        >
          Checking Granola desktop session…
        </div>
      )}

      {(importedCount > 0 || lastImportAt) && (
        <div
          className="font-mono"
          style={{
            fontSize: 10.5,
            color: MESH.fgMute,
            display: "flex",
            gap: 12,
          }}
        >
          <span>{importedCount} imported</span>
          {lastImportAt && <span>last sync {timeAgo(lastImportAt)}</span>}
        </div>
      )}

      {error && (
        <div
          className="font-mono"
          style={{
            fontSize: 11,
            color: MESH.red,
            padding: "6px 8px",
            background: "rgba(229,72,77,0.08)",
            borderRadius: 4,
          }}
        >
          {error}
        </div>
      )}

      <details style={{ fontSize: 11, color: MESH.fgMute }}>
        <summary style={{ cursor: "pointer", color: MESH.fgDim }}>
          Use this MCP from Claude Code
        </summary>
        <p style={{ margin: "8px 0 4px", lineHeight: 1.55 }}>
          Add this to <code style={codeInline}>~/.claude/.mcp.json</code> if you
          also want Claude Code to call the Granola MCP directly:
        </p>
        <pre style={preStyle}>{`{
  "mcpServers": {
    "granola": { "type": "url", "url": "https://mcp.granola.ai/mcp" }
  }
}`}</pre>
      </details>
    </div>
  );
}

function timeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  if (!t) return "";
  const diff = Date.now() - t;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

const cardStyle: React.CSSProperties = {
  borderRadius: 8,
  border: `1px solid ${MESH.border}`,
  background: MESH.bgElev,
  padding: "16px 18px",
  display: "flex",
  flexDirection: "column",
  gap: 12,
};

const codeInline: React.CSSProperties = {
  fontFamily: "var(--font-mono, monospace)",
  fontSize: 11.5,
  padding: "1px 5px",
  background: MESH.bgInput,
  borderRadius: 3,
  color: MESH.fgDim,
};

const preStyle: React.CSSProperties = {
  fontFamily: "var(--font-mono, monospace)",
  fontSize: 11,
  background: MESH.bgInput,
  border: `1px solid ${MESH.border}`,
  borderRadius: 5,
  padding: "8px 10px",
  margin: 0,
  color: MESH.fgDim,
  overflowX: "auto",
};
