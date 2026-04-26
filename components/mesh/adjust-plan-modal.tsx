"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MESH } from "./tokens";
import {
  ModalShell,
  ModalLabel,
  PrimaryButton,
  SecondaryButton,
} from "./modal-shell";
import { Pill } from "./pill";
import { NavIcon } from "./icons";

export type AdjustPayload = {
  instruction: string;
  quick_actions: string[];
};

export type AdjustContext = {
  ticket_id: string;
  target_branch: string;
  repos: string[];
  invariants: string[];
  cited_adrs: string[];
  step_count: number;
};

const STATIC_ACTIONS: Array<{ label: string; value: string }> = [
  { label: "Narrow scope", value: "Narrow the scope — remove any step that isn't strictly required." },
  { label: "Add test step", value: "Add an explicit verification/test step at the end for each repo touched." },
  { label: "Change target branch", value: "Propose an alternative target branch name that fits the summary better." },
  { label: "Drop low-confidence steps", value: "Drop any step whose rationale cites 'maybe', 'optional', or isn't backed by an invariant." },
];

export function AdjustPlanModal({
  open,
  onClose,
  onSubmit,
  busy,
  ctx,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (p: AdjustPayload) => void;
  busy?: boolean;
  ctx: AdjustContext | null;
}) {
  const [instruction, setInstruction] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) {
      setInstruction("");
      setSelected([]);
      return;
    }
    const t = setTimeout(() => textareaRef.current?.focus(), 40);
    return () => clearTimeout(t);
  }, [open]);

  const dynamicActions = useMemo(() => {
    if (!ctx) return [] as Array<{ label: string; value: string }>;
    const out: Array<{ label: string; value: string }> = [];
    for (const r of ctx.repos) {
      out.push({
        label: `Drop ${r}`,
        value: `Do not touch ${r} in the revised plan — drop any step against it.`,
      });
    }
    for (const inv of ctx.invariants.slice(0, 3)) {
      out.push({
        label: `Enforce ${inv}`,
        value: `Every step must explicitly cite and respect invariant "${inv}".`,
      });
    }
    return out;
  }, [ctx]);

  const allActions = [...dynamicActions, ...STATIC_ACTIONS];

  const toggle = (value: string) => {
    setSelected((cur) =>
      cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value],
    );
  };

  const canSubmit =
    !busy && (selected.length > 0 || instruction.trim().length > 0);

  const submit = () => {
    if (!canSubmit) return;
    onSubmit({
      instruction: instruction.trim(),
      quick_actions: selected,
    });
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      width={620}
      title="Ask Claude to adjust the plan"
      meta={
        ctx
          ? `${ctx.ticket_id} · ${ctx.step_count} steps · ${ctx.repos.length} repos`
          : undefined
      }
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
            {selected.length > 0 && `${selected.length} quick action${selected.length > 1 ? "s" : ""} · `}
            {instruction.trim().length > 0
              ? "freeform note"
              : selected.length === 0 && "pick an action or write a note"}
          </span>
          <PrimaryButton onClick={submit} disabled={!canSubmit} kbd="⌘↵">
            regenerate plan
          </PrimaryButton>
        </>
      }
    >
      {ctx && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            padding: "10px 12px",
            background: MESH.bgInput,
            border: `1px solid ${MESH.border}`,
            borderRadius: 6,
          }}
        >
          <ModalLabel>Current plan context</ModalLabel>
          <div
            style={{
              display: "flex",
              gap: 6,
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            <NavIcon kind="branch" color={MESH.fgDim} size={11} />
            <span
              className="font-mono"
              style={{ fontSize: 10, color: MESH.fgDim }}
            >
              {ctx.target_branch}
            </span>
            <span style={{ color: MESH.fgMute, fontSize: 10 }}>·</span>
            {ctx.repos.map((r) => (
              <Pill key={r} tone="default">
                {r}
              </Pill>
            ))}
          </div>
          {(ctx.invariants.length > 0 || ctx.cited_adrs.length > 0) && (
            <div
              style={{
                display: "flex",
                gap: 6,
                flexWrap: "wrap",
                alignItems: "center",
              }}
            >
              {ctx.invariants.slice(0, 6).map((i) => (
                <Pill key={`i-${i}`} tone="green">
                  {i}
                </Pill>
              ))}
              {ctx.cited_adrs.slice(0, 4).map((a) => (
                <Pill key={`a-${a}`} tone="amber">
                  {a}
                </Pill>
              ))}
            </div>
          )}
        </div>
      )}

      <div onKeyDown={onKey} style={{ display: "contents" }}>
        <div>
          <ModalLabel>Quick actions</ModalLabel>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 6,
            }}
          >
            {allActions.map((a) => {
              const active = selected.includes(a.value);
              return (
                <button
                  key={a.value}
                  type="button"
                  onClick={() => toggle(a.value)}
                  title={a.value}
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
                  }}
                >
                  {active ? "✓ " : "+ "}
                  {a.label}
                </button>
              );
            })}
          </div>
          {selected.length > 0 && (
            <div
              style={{
                marginTop: 10,
                padding: "8px 10px",
                background: "rgba(245,165,36,0.04)",
                border: `1px solid ${MESH.amberDim}`,
                borderRadius: 5,
                display: "flex",
                flexDirection: "column",
                gap: 4,
              }}
            >
              {selected.map((s, i) => (
                <div
                  key={i}
                  className="font-mono"
                  style={{ fontSize: 10, color: MESH.fgDim }}
                >
                  · {s}
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <ModalLabel>Anything else Claude should know?</ModalLabel>
          <textarea
            ref={textareaRef}
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder="e.g. keep the docs repo untouched, propose a cleaner migration order, add rollback notes per step…"
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
      </div>
    </ModalShell>
  );
}
