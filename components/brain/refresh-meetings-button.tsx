"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MESH } from "@/components/mesh";

type GranolaStatus = "linked" | "needs_login" | "not_installed" | "unknown";

type Props = {
  defaultDays?: number;
  onRefreshed?: (count: number) => void | Promise<void>;
  compact?: boolean;
};

export function RefreshMeetingsButton({
  defaultDays = 3,
  onRefreshed,
  compact = false,
}: Props) {
  const [status, setStatus] = useState<GranolaStatus>("unknown");
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState(defaultDays);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const flashTimer = useRef<NodeJS.Timeout | null>(null);

  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/integrations/granola/status", {
        cache: "no-store",
      });
      const json = (await res.json()) as { status: GranolaStatus };
      setStatus(json.status);
    } catch {
      setStatus("unknown");
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const link = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/integrations/granola/link", {
        method: "POST",
      });
      const json = (await res.json()) as {
        status: GranolaStatus;
        error?: string;
      };
      setStatus(json.status);
      if (!res.ok && json.error) setError(json.error);
      return json.status === "linked";
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const refresh = useCallback(
    async (windowDays: number) => {
      setBusy(true);
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
                  setProgress(`Stored ${count}…`);
                } else if (ev.type === "done") {
                  count = ev.count;
                } else if (ev.type === "error") {
                  errMsg = ev.message;
                  if (ev.code === "not_linked") needsLogin = true;
                }
              } catch {
                // ignore
              }
            }
            idx = buf.indexOf("\n\n");
          }
        }
        if (errMsg) {
          setError(errMsg);
          if (needsLogin) setStatus("needs_login");
        } else {
          setFlash(`+${count} added`);
          if (flashTimer.current) clearTimeout(flashTimer.current);
          flashTimer.current = setTimeout(() => setFlash(null), 3500);
          await onRefreshed?.(count);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
        setProgress(null);
      }
    },
    [onRefreshed],
  );

  const click = useCallback(async () => {
    setError(null);
    if (status === "not_installed") {
      window.open("https://www.granola.ai/download", "_blank");
      return;
    }
    if (status === "needs_login" || status === "unknown") {
      const ok = await link();
      if (!ok) return;
    }
    await refresh(defaultDays);
  }, [status, link, refresh, defaultDays]);

  const label =
    status === "not_installed"
      ? "Install Granola"
      : status === "needs_login"
        ? "Link Granola"
        : busy
          ? "Pulling…"
          : flash
            ? `Refreshed · ${flash}`
            : `Refresh meetings · last ${defaultDays}d`;

  const tone =
    status === "not_installed"
      ? "red"
      : status === "needs_login"
        ? "amber"
        : flash
          ? "green"
          : "default";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <button
          type="button"
          onClick={click}
          disabled={busy}
          className="font-mono"
          style={{
            ...buttonStyle(tone, compact),
            opacity: busy ? 0.7 : 1,
            cursor: busy ? "wait" : "pointer",
          }}
        >
          {label}
        </button>
        {status === "linked" && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            disabled={busy}
            className="font-mono"
            aria-label="Custom range"
            style={{
              ...buttonStyle("default", compact),
              padding: compact ? "4px 8px" : "6px 9px",
            }}
          >
            ⋯
          </button>
        )}
      </div>

      {open && status === "linked" && (
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
          <span className="font-mono" style={{ fontSize: 11, color: MESH.fgDim }}>
            last
          </span>
          <input
            type="number"
            min={1}
            max={30}
            value={days}
            onChange={(e) =>
              setDays(Math.max(1, Math.min(30, Number(e.target.value) || 1)))
            }
            style={inputStyle}
          />
          <span className="font-mono" style={{ fontSize: 11, color: MESH.fgDim }}>
            d
          </span>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              void refresh(days);
            }}
            disabled={busy}
            className="font-mono"
            style={buttonStyle("amber", true)}
          >
            Pull
          </button>
        </div>
      )}

      {progress && (
        <span className="font-mono" style={{ fontSize: 10.5, color: MESH.fgMute }}>
          {progress}
        </span>
      )}
      {error && (
        <span
          className="font-mono"
          style={{
            fontSize: 10.5,
            color: MESH.red,
            maxWidth: 320,
            textAlign: "right",
            lineHeight: 1.4,
          }}
        >
          {error}
        </span>
      )}
    </div>
  );
}

function buttonStyle(
  tone: "default" | "amber" | "green" | "red",
  compact: boolean,
): React.CSSProperties {
  const palette: Record<typeof tone, { fg: string; bd: string; bg: string }> = {
    default: { fg: MESH.fgDim, bd: MESH.border, bg: "transparent" },
    amber: { fg: MESH.amber, bd: MESH.amber, bg: "rgba(245,165,36,0.08)" },
    green: { fg: MESH.green, bd: MESH.green, bg: "rgba(48,162,108,0.08)" },
    red: { fg: MESH.red, bd: MESH.red, bg: "rgba(229,72,77,0.08)" },
  };
  const c = palette[tone];
  return {
    background: c.bg,
    border: `1px solid ${c.bd}`,
    borderRadius: 6,
    padding: compact ? "4px 10px" : "6px 12px",
    color: c.fg,
    fontSize: compact ? 11 : 12,
    letterSpacing: "0.02em",
  };
}

const inputStyle: React.CSSProperties = {
  width: 48,
  padding: "4px 6px",
  background: MESH.bgElev,
  border: `1px solid ${MESH.border}`,
  borderRadius: 4,
  color: MESH.fg,
  fontSize: 12,
  outline: "none",
};
