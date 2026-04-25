"use client";

import { useMemo } from "react";
import Link from "next/link";
import { MESH } from "./tokens";
import { Dot, Pill, type PillTone } from "./pill";
import { NavIcon } from "./icons";
import type {
  TicketIndexEntry,
  TicketPriority,
  TicketSourceHint,
  DraftingPhase,
} from "@/lib/ticket-store";

const PRIORITY_COLOR: Record<TicketPriority, string> = {
  low: MESH.fgMute,
  med: MESH.amber,
  high: MESH.red,
};

const SOURCE_LABEL: Record<TicketSourceHint, string> = {
  mesh: "mesh",
  slack: "slack",
  linear: "linear",
  github: "github",
};

function relTime(iso: string): string {
  const delta = Date.now() - new Date(iso).getTime();
  if (delta < 60_000) return "just now";
  const m = Math.floor(delta / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

function phaseLabel(p: DraftingPhase): string {
  if (p === "classifying") return "classifying";
  if (p === "planning") return "multi-agent planning";
  return "synthesizing plan";
}

export function TicketCard({
  ticket,
  href,
  branch,
  stepsInfo,
  className,
}: {
  ticket: TicketIndexEntry;
  href?: string;
  // Optional enrichments — only the board passes them when known.
  branch?: string;
  stepsInfo?: { steps: number; repos: number; invariants: number };
  className?: string;
}) {
  const priorityColor = PRIORITY_COLOR[ticket.priority];
  const isDrafting = !!ticket.drafting_phase;
  const progress = useMemo(() => {
    if (!ticket.ship) return null;
    const pct =
      ticket.ship.steps_total > 0
        ? Math.min(
            100,
            Math.round((ticket.ship.steps_done / ticket.ship.steps_total) * 100),
          )
        : 0;
    return { ...ticket.ship, pct };
  }, [ticket.ship]);

  const body = (
    <div
      className={`${className ?? ""} mesh-ticket-card`}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: "12px 14px",
        background: MESH.bgElev,
        border: `1px solid ${MESH.border}`,
        borderRadius: 6,
        transition:
          "background var(--motion-fast) var(--ease), border-color var(--motion-fast) var(--ease), transform var(--motion-fast) var(--ease), box-shadow var(--motion-fast) var(--ease)",
        cursor: href ? "pointer" : "default",
      }}
    >
      {/* header row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          minWidth: 0,
        }}
      >
        <Dot color={priorityColor} size={6} />
        <span
          className="font-mono"
          style={{ fontSize: 10, color: MESH.fgDim }}
        >
          {ticket.id}
        </span>
        <Pill tone="dim">
          <NavIcon kind="bolt" color={MESH.fgMute} size={10} />
          <span>{SOURCE_LABEL[ticket.source_hint]}</span>
        </Pill>
        <span style={{ flex: 1 }} />
        <span
          className="font-mono"
          style={{ fontSize: 10, color: MESH.fgMute }}
        >
          {relTime(ticket.updated_at)}
        </span>
      </div>

      {/* title */}
      <div
        style={{
          fontSize: 13,
          lineHeight: "18px",
          color: MESH.fg,
          fontWeight: 500,
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {ticket.title}
      </div>

      {/* thinking pulse while drafting */}
      {isDrafting && (
        <div
          className="font-mono"
          style={{
            fontSize: 10,
            color: MESH.amber,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: 999,
              background: MESH.amber,
              animation: "mesh-pulse 1.2s ease-in-out infinite",
            }}
          />
          claude · {phaseLabel(ticket.drafting_phase!)}
        </div>
      )}

      {/* branch + stats */}
      {branch && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 8px",
            background: MESH.bg,
            border: `1px solid ${MESH.border}`,
            borderRadius: 4,
            flexWrap: "wrap",
          }}
        >
          <NavIcon kind="branch" color={MESH.fgDim} size={11} />
          <span
            className="font-mono"
            style={{
              fontSize: 10,
              color: MESH.fgDim,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              minWidth: 0,
              flex: 1,
            }}
          >
            {branch}
          </span>
          {stepsInfo && (
            <span
              className="font-mono"
              style={{ fontSize: 10, color: MESH.fgMute, whiteSpace: "nowrap" }}
            >
              <b style={{ color: MESH.fg, fontWeight: 500 }}>
                {stepsInfo.steps}
              </b>{" "}
              steps ·{" "}
              <b style={{ color: MESH.fg, fontWeight: 500 }}>
                {stepsInfo.repos}
              </b>{" "}
              repos ·{" "}
              <b style={{ color: MESH.fg, fontWeight: 500 }}>
                {stepsInfo.invariants}
              </b>{" "}
              invariants
            </span>
          )}
        </div>
      )}

      {/* in_process progress */}
      {progress && ticket.status === "in_process" && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 4,
            padding: "4px 0",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 10,
            }}
            className="font-mono"
          >
            <span style={{ color: MESH.amber }}>shipping</span>
            <span style={{ color: MESH.fgMute }}>·</span>
            <span style={{ color: MESH.fg }}>
              {progress.steps_done}/{progress.steps_total}
            </span>
          </div>
          <div
            style={{
              height: 3,
              background: MESH.border,
              borderRadius: 2,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${progress.pct}%`,
                height: "100%",
                background: MESH.amber,
                transition: "width 300ms",
              }}
            />
          </div>
        </div>
      )}

      {/* for_review prs */}
      {ticket.status === "for_review" && ticket.prs_count > 0 && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          <div
            className="font-mono"
            style={{
              fontSize: 10,
              color: MESH.green,
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <NavIcon kind="pr" color={MESH.green} size={10} />
            {ticket.prs_count} PR{ticket.prs_count > 1 ? "s" : ""} open
          </div>
        </div>
      )}

      {/* footer — labels + author */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          flexWrap: "wrap",
          marginTop: 2,
        }}
      >
        {ticket.labels.map((l) => (
          <Pill key={l} tone="dim">
            {l}
          </Pill>
        ))}
        <span style={{ flex: 1 }} />
        <span
          className="font-mono"
          style={{ fontSize: 10, color: MESH.fgMute }}
        >
          {ticket.author}
        </span>
      </div>
    </div>
  );

  if (!href) return body;
  return (
    <Link
      href={href}
      style={{ textDecoration: "none", color: "inherit", display: "block" }}
    >
      {body}
    </Link>
  );
}

export function ticketTonePillTone(
  status: TicketIndexEntry["status"],
): PillTone {
  if (status === "for_review") return "green";
  if (status === "in_process") return "amber";
  if (status === "drafted") return "amber";
  return "dim";
}
