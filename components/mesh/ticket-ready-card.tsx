"use client";

import type { CSSProperties } from "react";
import { MESH } from "./tokens";
import { Dot, Pill } from "./pill";
import { NavIcon } from "./icons";

export type TicketReadySummary = {
  id: string;
  title: string;
  branch: string;
  reposTouched: string[];
  steps: number;
  status: "drafted" | "in_process" | "pending_review";
  prs?: { url: string; simulated: boolean }[];
};

const STATUS_LABEL: Record<TicketReadySummary["status"], string> = {
  drafted: "ready to stage",
  in_process: "staging…",
  pending_review: "awaiting review",
};

const STATUS_TONE: Record<
  TicketReadySummary["status"],
  "amber" | "green" | "default"
> = {
  drafted: "default",
  in_process: "amber",
  pending_review: "amber",
};

const STATUS_DOT: Record<TicketReadySummary["status"], string> = {
  drafted: MESH.fgMute,
  in_process: MESH.amber,
  pending_review: MESH.amber,
};

export function TicketReadyCard({
  ticket,
  selected,
  onSelect,
  style,
}: {
  ticket: TicketReadySummary;
  selected?: boolean;
  onSelect?: (id: string) => void;
  style?: CSSProperties;
}) {
  const accent = selected ? "rgba(245,165,36,0.45)" : MESH.border;
  return (
    <button
      type="button"
      onClick={() => onSelect?.(ticket.id)}
      style={{
        textAlign: "left",
        background: selected ? "rgba(245,165,36,0.06)" : MESH.bgElev,
        border: `1px solid ${accent}`,
        borderLeft: `2px solid ${selected ? MESH.amber : "transparent"}`,
        borderRadius: 6,
        padding: "10px 12px",
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        transition: "background 120ms, border-color 120ms",
        ...style,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Dot color={STATUS_DOT[ticket.status]} size={6} />
        <span
          className="font-mono"
          style={{ fontSize: 10, color: MESH.fgDim, letterSpacing: "0.04em" }}
        >
          {ticket.id}
        </span>
        <span style={{ flex: 1 }} />
        <Pill tone={STATUS_TONE[ticket.status]}>
          {STATUS_LABEL[ticket.status]}
        </Pill>
      </div>
      <span
        style={{
          fontSize: 13,
          lineHeight: "18px",
          color: selected ? MESH.fg : MESH.fg,
          fontWeight: 500,
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {ticket.title}
      </span>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "5px 7px",
          background: MESH.bg,
          border: `1px solid ${MESH.border}`,
          borderRadius: 4,
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
            flex: 1,
            minWidth: 0,
          }}
        >
          {ticket.branch}
        </span>
      </div>
      <div
        className="font-mono"
        style={{
          fontSize: 10,
          color: MESH.fgMute,
          display: "flex",
          gap: 6,
          flexWrap: "wrap",
        }}
      >
        <span>
          <b style={{ color: MESH.fgDim, fontWeight: 500 }}>{ticket.steps}</b> steps
        </span>
        <span>·</span>
        <span>
          <b style={{ color: MESH.fgDim, fontWeight: 500 }}>
            {ticket.reposTouched.length}
          </b>{" "}
          repos
        </span>
        {ticket.reposTouched.length > 0 && (
          <>
            <span>·</span>
            <span style={{ color: MESH.fgMute }}>
              {ticket.reposTouched.slice(0, 3).join(", ")}
              {ticket.reposTouched.length > 3 ? "…" : ""}
            </span>
          </>
        )}
      </div>
    </button>
  );
}
