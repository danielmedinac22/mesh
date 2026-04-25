"use client";

import { useEffect, useRef, useState } from "react";
import { MESH } from "./tokens";
import {
  ModalShell,
  ModalLabel,
  PrimaryButton,
  SecondaryButton,
} from "./modal-shell";
import { Pill } from "./pill";
import type {
  TicketPriority,
  TicketSourceHint,
} from "@/lib/ticket-store";

const PRIORITIES: TicketPriority[] = ["low", "med", "high"];
const SOURCES: TicketSourceHint[] = ["mesh", "slack", "linear", "github"];

export type NewTicketPayload = {
  title: string;
  description: string;
  priority: TicketPriority;
  labels: string[];
  source_hint: TicketSourceHint;
  handoff: boolean;
};

export function NewTicketModal({
  open,
  onClose,
  onSubmit,
  busy,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (p: NewTicketPayload) => void;
  busy?: boolean;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TicketPriority>("med");
  const [labels, setLabels] = useState<string[]>([]);
  const [labelDraft, setLabelDraft] = useState("");
  const [source, setSource] = useState<TicketSourceHint>("mesh");
  const [handoff, setHandoff] = useState(true);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setTitle("");
      setDescription("");
      setPriority("med");
      setLabels([]);
      setLabelDraft("");
      setSource("mesh");
      setHandoff(true);
      return;
    }
    const t = setTimeout(() => titleRef.current?.focus(), 40);
    return () => clearTimeout(t);
  }, [open]);

  const canSubmit = title.trim().length > 0 && !busy;

  const submit = () => {
    if (!canSubmit) return;
    onSubmit({
      title: title.trim(),
      description: description.trim(),
      priority,
      labels,
      source_hint: source,
      handoff,
    });
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    }
  };

  const addLabel = () => {
    const raw = labelDraft.trim().toLowerCase();
    if (!raw) return;
    if (!labels.includes(raw)) setLabels([...labels, raw]);
    setLabelDraft("");
  };

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title="New ticket"
      meta="draft + route cross-repo in one shot"
      footer={
        <>
          <SecondaryButton onClick={onClose} kbd="esc">
            cancel
          </SecondaryButton>
          <span style={{ flex: 1 }} />
          <span
            className="font-mono"
            style={{ fontSize: 10, color: MESH.fgMute }}
          >
            {handoff
              ? "claude will classify + draft plan on submit"
              : "ticket will land in inbox, you can build later"}
          </span>
          <PrimaryButton onClick={submit} disabled={!canSubmit} kbd="⌘↵">
            {handoff ? "build" : "create ticket"}
          </PrimaryButton>
        </>
      }
    >
      <div onKeyDown={onKey} style={{ display: "contents" }}>
        <div>
          <ModalLabel>Title</ModalLabel>
          <input
            ref={titleRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What needs to change?"
            style={{
              width: "100%",
              padding: "9px 10px",
              fontSize: 13,
              color: MESH.fg,
              background: MESH.bgInput,
              border: `1px solid ${MESH.border}`,
              borderRadius: 5,
              outline: "none",
            }}
          />
        </div>

        <div>
          <ModalLabel>Description</ModalLabel>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Paste from Slack / Linear, or describe the problem. Include context Claude would need to route this correctly."
            rows={5}
            style={{
              width: "100%",
              padding: "9px 10px",
              fontSize: 12,
              color: MESH.fg,
              background: MESH.bgInput,
              border: `1px solid ${MESH.border}`,
              borderRadius: 5,
              outline: "none",
              resize: "vertical",
              fontFamily: "inherit",
              lineHeight: 1.5,
            }}
          />
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 14,
          }}
        >
          <div>
            <ModalLabel>Priority</ModalLabel>
            <div style={{ display: "flex", gap: 6 }}>
              {PRIORITIES.map((p) => {
                const active = p === priority;
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPriority(p)}
                    style={{
                      padding: "5px 10px",
                      fontSize: 11,
                      color: active ? MESH.amber : MESH.fgDim,
                      background: active
                        ? "rgba(245,165,36,0.08)"
                        : MESH.bgInput,
                      border: `1px solid ${active ? MESH.amber : MESH.border}`,
                      borderRadius: 4,
                      cursor: "pointer",
                      textTransform: "uppercase",
                      letterSpacing: "0.1em",
                    }}
                  >
                    {p}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <ModalLabel>Source</ModalLabel>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {SOURCES.map((s) => {
                const active = s === source;
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSource(s)}
                    style={{
                      padding: "5px 10px",
                      fontSize: 11,
                      color: active ? MESH.fg : MESH.fgDim,
                      background: active ? MESH.bgElev2 : MESH.bgInput,
                      border: `1px solid ${active ? MESH.borderHi : MESH.border}`,
                      borderRadius: 4,
                      cursor: "pointer",
                    }}
                  >
                    {s}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div>
          <ModalLabel>Labels</ModalLabel>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              flexWrap: "wrap",
            }}
          >
            {labels.map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLabels(labels.filter((x) => x !== l))}
                title="remove"
                style={{
                  border: "none",
                  background: "transparent",
                  padding: 0,
                  cursor: "pointer",
                }}
              >
                <Pill tone="dim">{l} ×</Pill>
              </button>
            ))}
            <input
              value={labelDraft}
              onChange={(e) => setLabelDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault();
                  e.stopPropagation();
                  addLabel();
                }
              }}
              placeholder="add a label, enter to save"
              style={{
                flex: 1,
                minWidth: 140,
                padding: "5px 8px",
                fontSize: 11,
                color: MESH.fg,
                background: MESH.bgInput,
                border: `1px solid ${MESH.border}`,
                borderRadius: 4,
                outline: "none",
              }}
            />
          </div>
        </div>

        {/* Handoff toggle — primary affordance */}
        <label
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            padding: "10px 12px",
            background: handoff
              ? "rgba(245,165,36,0.06)"
              : MESH.bgInput,
            border: `1px solid ${handoff ? MESH.amber : MESH.border}`,
            borderRadius: 6,
            cursor: "pointer",
            transition: "border-color 120ms, background 120ms",
          }}
        >
          <input
            type="checkbox"
            checked={handoff}
            onChange={(e) => setHandoff(e.target.checked)}
            style={{
              marginTop: 2,
              accentColor: MESH.amber,
            }}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span
              style={{
                fontSize: 12,
                color: handoff ? MESH.fg : MESH.fgDim,
                fontWeight: 500,
              }}
            >
              Build immediately
            </span>
            <span
              className="font-mono"
              style={{ fontSize: 10, color: MESH.fgMute }}
            >
              classify · dispatch multi-agent · draft cross-repo plan
            </span>
          </div>
        </label>
      </div>
    </ModalShell>
  );
}
