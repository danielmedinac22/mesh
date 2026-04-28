"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Sparkles, ChevronDown, X, Loader2 } from "lucide-react";
import { MESH } from "./tokens";

type HealStatus =
  | "auto-applied"
  | "applied"
  | "proposal"
  | "skipped"
  | "failed";

type HealLogEntry = {
  id: string;
  errorId: string;
  endpoint: string;
  status: HealStatus;
  rootCause: string;
  filesChanged: string[];
  commit?: string;
  reason?: string;
  createdAt: string;
};

type ProposalFile = { path: string; contents: string };
type Proposal = {
  rootCause: string;
  files?: ProposalFile[] | null;
  commitMessage?: string;
  reason?: string;
};

type EntryWithProposal = HealLogEntry & { proposal?: Proposal | null };

const POLL_MS = 30_000;
const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;

export function HealBadge() {
  const [entries, setEntries] = useState<EntryWithProposal[]>([]);
  const [open, setOpen] = useState(false);
  const [applying, setApplying] = useState<Record<string, boolean>>({});
  const inflight = useRef<AbortController | null>(null);

  const fetchEntries = useCallback(async () => {
    inflight.current?.abort();
    const ac = new AbortController();
    inflight.current = ac;
    try {
      const r = await fetch("/api/heal/recent?limit=15&proposal=1", {
        signal: ac.signal,
        cache: "no-store",
      });
      if (!r.ok) return;
      const j = (await r.json()) as { entries: EntryWithProposal[] };
      setEntries(j.entries ?? []);
    } catch {
      // network blip — try again next tick
    }
  }, []);

  useEffect(() => {
    void fetchEntries();
    const t = setInterval(fetchEntries, POLL_MS);
    const onFocus = () => void fetchEntries();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
      inflight.current?.abort();
    };
  }, [fetchEntries]);

  const recent = entries.filter(
    (e) => Date.now() - new Date(e.createdAt).getTime() < RECENT_WINDOW_MS,
  );
  const pendingProposals = recent.filter(
    (e) => e.status === "proposal" && (e.proposal?.files?.length ?? 0) > 0,
  );
  const recentApplied = recent.filter(
    (e) => e.status === "applied" || e.status === "auto-applied",
  );

  if (recent.length === 0) return null;

  const badgeTone = pendingProposals.length > 0 ? "amber" : "signal";
  const badgeColor = badgeTone === "amber" ? MESH.amber : MESH.signal;
  const badgeGlow = badgeTone === "amber" ? MESH.amberGlow : MESH.signalGlow;
  const badgeCount = pendingProposals.length || recentApplied.length;
  const badgeLabel =
    pendingProposals.length > 0
      ? `${pendingProposals.length} fix ${pendingProposals.length === 1 ? "proposed" : "proposed"}`
      : `${recentApplied.length} fix ${recentApplied.length === 1 ? "applied" : "applied"}`;

  const applyOne = async (errorId: string) => {
    setApplying((s) => ({ ...s, [errorId]: true }));
    try {
      await fetch(`/api/heal/apply/${encodeURIComponent(errorId)}`, {
        method: "POST",
      });
      await fetchEntries();
    } finally {
      setApplying((s) => {
        const n = { ...s };
        delete n[errorId];
        return n;
      });
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={badgeLabel}
        style={{
          position: "fixed",
          right: 20,
          bottom: 20,
          zIndex: 60,
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 12px",
          borderRadius: 999,
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          letterSpacing: 0.4,
          textTransform: "uppercase",
          color: badgeColor,
          background: badgeGlow,
          border: `1px solid ${badgeColor}33`,
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
          cursor: "pointer",
          boxShadow: `0 8px 32px -16px ${badgeColor}66`,
        }}
      >
        <Sparkles size={12} strokeWidth={2} />
        <span>{badgeLabel}</span>
        <span
          style={{
            fontSize: 10,
            padding: "1px 6px",
            borderRadius: 999,
            background: `${badgeColor}22`,
            color: badgeColor,
          }}
        >
          {badgeCount}
        </span>
        <ChevronDown
          size={12}
          strokeWidth={2}
          style={{
            transform: open ? "rotate(180deg)" : "none",
            transition: "transform 200ms",
          }}
        />
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Self-heal proposals"
          style={{
            position: "fixed",
            right: 20,
            bottom: 70,
            zIndex: 60,
            width: 420,
            maxHeight: "70vh",
            overflowY: "auto",
            background: MESH.bgElev,
            border: `1px solid ${MESH.border}`,
            borderRadius: 8,
            boxShadow: "0 24px 64px -24px rgba(0,0,0,0.6)",
            fontFamily: "var(--font-sans)",
            color: MESH.fg,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "12px 14px",
              borderBottom: `1px solid ${MESH.border}`,
            }}
          >
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                letterSpacing: 0.4,
                textTransform: "uppercase",
                color: MESH.fgDim,
              }}
            >
              Claude · self-heal
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              style={{
                background: "transparent",
                border: "none",
                color: MESH.fgMute,
                cursor: "pointer",
                padding: 2,
                lineHeight: 0,
              }}
            >
              <X size={14} strokeWidth={2} />
            </button>
          </div>

          <div style={{ padding: 4 }}>
            {pendingProposals.length === 0 && recentApplied.length === 0 ? (
              <div
                style={{
                  padding: "20px 14px",
                  fontSize: 13,
                  color: MESH.fgMute,
                }}
              >
                No recent fixes.
              </div>
            ) : null}

            {pendingProposals.map((e) => (
              <ProposalRow
                key={e.id}
                entry={e}
                applying={!!applying[e.errorId]}
                onApply={() => void applyOne(e.errorId)}
              />
            ))}

            {recentApplied.length > 0 ? (
              <div
                style={{
                  padding: "10px 14px 4px",
                  fontFamily: "var(--font-mono)",
                  fontSize: 10,
                  letterSpacing: 0.4,
                  textTransform: "uppercase",
                  color: MESH.fgMute,
                }}
              >
                Applied recently
              </div>
            ) : null}

            {recentApplied.map((e) => (
              <AppliedRow key={e.id} entry={e} />
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}

function ProposalRow({
  entry,
  applying,
  onApply,
}: {
  entry: EntryWithProposal;
  applying: boolean;
  onApply: () => void;
}) {
  const files = entry.proposal?.files ?? [];
  return (
    <div
      style={{
        padding: 12,
        margin: 4,
        borderRadius: 6,
        background: MESH.bgElev2,
        border: `1px solid ${MESH.border}`,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            color: MESH.amber,
            textTransform: "uppercase",
            letterSpacing: 0.4,
          }}
        >
          proposal · {entry.endpoint}
        </span>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            color: MESH.fgMute,
          }}
        >
          {timeAgo(entry.createdAt)}
        </span>
      </div>
      <div
        style={{
          marginTop: 8,
          fontSize: 13,
          lineHeight: 1.4,
          color: MESH.fg,
        }}
      >
        {entry.rootCause || entry.proposal?.rootCause || "(no root cause)"}
      </div>
      {files.length > 0 ? (
        <div style={{ marginTop: 8 }}>
          {files.map((f) => (
            <div
              key={f.path}
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: MESH.fgDim,
              }}
            >
              {f.path}
            </div>
          ))}
        </div>
      ) : null}
      {entry.reason ? (
        <div
          style={{
            marginTop: 8,
            fontSize: 11,
            color: MESH.fgMute,
            fontStyle: "italic",
          }}
        >
          {entry.reason}
        </div>
      ) : null}
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
        <button
          type="button"
          onClick={onApply}
          disabled={applying || files.length === 0}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 12px",
            borderRadius: 4,
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            letterSpacing: 0.4,
            textTransform: "uppercase",
            color: files.length === 0 ? MESH.fgMute : MESH.amber,
            background:
              files.length === 0 ? "transparent" : "rgba(245,165,36,0.10)",
            border: `1px solid ${files.length === 0 ? MESH.border : "rgba(245,165,36,0.35)"}`,
            cursor:
              applying || files.length === 0 ? "not-allowed" : "pointer",
            opacity: applying ? 0.6 : 1,
          }}
        >
          {applying ? (
            <Loader2 size={11} strokeWidth={2} className="animate-spin" />
          ) : null}
          {applying ? "Applying" : "Apply fix"}
        </button>
      </div>
    </div>
  );
}

function AppliedRow({ entry }: { entry: EntryWithProposal }) {
  return (
    <div
      style={{
        padding: "10px 14px",
        margin: 4,
        borderRadius: 6,
        borderLeft: `2px solid ${
          entry.status === "auto-applied" ? MESH.signal : MESH.green
        }`,
        background: MESH.bgElev2,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            color:
              entry.status === "auto-applied" ? MESH.signal : MESH.green,
            textTransform: "uppercase",
            letterSpacing: 0.4,
          }}
        >
          {entry.status} · {entry.endpoint}
        </span>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            color: MESH.fgMute,
          }}
        >
          {timeAgo(entry.createdAt)}
        </span>
      </div>
      <div
        style={{
          marginTop: 4,
          fontSize: 12,
          color: MESH.fgDim,
          lineHeight: 1.4,
        }}
      >
        {entry.rootCause}
      </div>
      {entry.commit ? (
        <div
          style={{
            marginTop: 4,
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            color: MESH.fgMute,
          }}
        >
          {entry.commit.slice(0, 7)} · {entry.filesChanged.join(", ")}
        </div>
      ) : null}
    </div>
  );
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}
