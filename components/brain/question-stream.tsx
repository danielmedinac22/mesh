"use client";

import { useEffect, useRef, useState } from "react";
import { MESH } from "@/components/mesh";
import type { ProfileDimension } from "@/lib/user-brain";

export type PendingQuestion = {
  dim: ProfileDimension;
  prompt: string;
  hint: string;
};

export function QuestionStream({
  questions,
  onAnswer,
  onSkip,
  onDone,
}: {
  questions: PendingQuestion[];
  onAnswer: (dim: ProfileDimension, text: string) => Promise<void>;
  onSkip: (dim: ProfileDimension) => void;
  onDone: () => void;
}) {
  const [idx, setIdx] = useState(0);
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const current = questions[idx];

  useEffect(() => {
    setText("");
    inputRef.current?.focus();
  }, [idx]);

  if (!current) {
    return (
      <div
        className="font-mono"
        style={{
          padding: 18,
          color: MESH.green,
          fontSize: 12.5,
          textAlign: "center",
        }}
      >
        Your profile is complete. Mesh has enough context now.
      </div>
    );
  }

  const submit = async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setSubmitting(true);
    try {
      await onAnswer(current.dim, trimmed);
    } finally {
      setSubmitting(false);
      if (idx + 1 >= questions.length) onDone();
      else setIdx(idx + 1);
    }
  };

  const skip = () => {
    onSkip(current.dim);
    if (idx + 1 >= questions.length) onDone();
    else setIdx(idx + 1);
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 14,
        padding: "16px 18px 18px",
        background: MESH.bgElev,
        border: `1px solid ${MESH.border}`,
        borderRadius: 8,
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          paddingBottom: 6,
          borderBottom: `1px solid ${MESH.border}`,
        }}
      >
        <span
          aria-hidden
          style={{
            width: 8,
            height: 8,
            borderRadius: 999,
            background: MESH.amber,
            boxShadow: `0 0 12px ${MESH.amber}`,
            animation: "mesh-pulse 1.6s ease-in-out infinite",
          }}
        />
        <span
          className="font-mono"
          style={{
            fontSize: 10,
            color: MESH.fgDim,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
          }}
        >
          Mesh is asking
        </span>
        <span
          className="font-mono"
          style={{
            marginLeft: "auto",
            fontSize: 10.5,
            color: MESH.fgMute,
          }}
        >
          {idx + 1} / {questions.length}
        </span>
      </header>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span
          className="font-mono"
          style={{
            fontSize: 10,
            color: MESH.amber,
            textTransform: "uppercase",
            letterSpacing: "0.14em",
          }}
        >
          {current.dim}
        </span>
        <p
          style={{
            margin: 0,
            fontSize: 16,
            lineHeight: 1.45,
            color: MESH.fg,
            letterSpacing: "-0.01em",
          }}
        >
          {current.prompt}
        </p>
        <p
          className="font-mono"
          style={{
            margin: 0,
            fontSize: 11.5,
            color: MESH.fgMute,
            lineHeight: 1.55,
          }}
        >
          {current.hint}
        </p>
      </div>

      <textarea
        ref={inputRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            void submit();
          }
        }}
        rows={3}
        placeholder="Write it in your own words…"
        style={{
          padding: "10px 12px",
          background: MESH.bgInput,
          border: `1px solid ${MESH.border}`,
          borderRadius: 6,
          color: MESH.fg,
          fontSize: 13.5,
          lineHeight: 1.5,
          fontFamily: "inherit",
          resize: "vertical",
          outline: "none",
        }}
      />

      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <button
          type="button"
          disabled={submitting || !text.trim()}
          onClick={submit}
          style={{
            padding: "8px 14px",
            borderRadius: 6,
            background: MESH.amber,
            border: `1px solid ${MESH.amber}`,
            color: "#0B0B0C",
            fontSize: 12,
            fontWeight: 600,
            cursor: submitting || !text.trim() ? "not-allowed" : "pointer",
            opacity: submitting || !text.trim() ? 0.5 : 1,
          }}
        >
          {submitting ? "saving…" : "save and next"}
        </button>
        <button
          type="button"
          onClick={skip}
          className="font-mono"
          style={{
            background: "transparent",
            border: `1px solid ${MESH.border}`,
            borderRadius: 6,
            padding: "7px 12px",
            color: MESH.fgDim,
            fontSize: 11.5,
            cursor: "pointer",
          }}
        >
          skip
        </button>
        <span
          className="font-mono"
          style={{
            marginLeft: "auto",
            fontSize: 10,
            color: MESH.fgMute,
          }}
        >
          ⌘+enter to submit
        </span>
      </div>
    </div>
  );
}
