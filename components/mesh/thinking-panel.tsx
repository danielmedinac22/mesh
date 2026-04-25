"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import { MESH } from "./tokens";
import { Pill } from "./pill";

export type ThinkingLine =
  | string
  | {
      text: string;
      kind?: "heading" | "mute" | "amber" | "red" | "green" | "code" | "bullet" | "blank";
    };

export function ThinkingPanel({
  lines,
  tokens = 0,
  active = true,
  caretLine,
  style,
  header = "Extended thinking",
  sub = "Opus 4.7 · temperature 0.7",
  autoScroll = true,
}: {
  lines: ThinkingLine[];
  tokens?: number;
  active?: boolean;
  caretLine?: number;
  style?: CSSProperties;
  header?: string;
  sub?: string;
  autoScroll?: boolean;
}) {
  const streamRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (autoScroll && streamRef.current) {
      streamRef.current.scrollTop = streamRef.current.scrollHeight;
    }
  }, [lines, autoScroll]);

  return (
    <div
      style={{
        background: MESH.bg,
        height: "100%",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        ...style,
      }}
    >
      {/* header */}
      <div
        style={{
          padding: "14px 22px",
          borderBottom: `1px solid ${MESH.border}`,
          display: "flex",
          alignItems: "center",
          gap: 12,
          position: "relative",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: `radial-gradient(ellipse at 18% 50%, ${MESH.amberGlow} 0%, transparent 55%)`,
            pointerEvents: "none",
          }}
        />
        <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: 999,
              background: active ? MESH.amber : MESH.fgMute,
              boxShadow: active ? `0 0 8px ${MESH.amber}` : "none",
            }}
          />
          <span
            className="font-mono"
            style={{ fontSize: 12, color: MESH.fg, fontWeight: 500, letterSpacing: "0.01em" }}
          >
            {header}
          </span>
          <span className="font-mono" style={{ fontSize: 11, color: MESH.fgMute }}>
            · {sub}
          </span>
        </div>
        <div
          style={{
            marginLeft: "auto",
            position: "relative",
            display: "flex",
            alignItems: "center",
            gap: 14,
          }}
        >
          <span className="font-mono" style={{ fontSize: 11, color: MESH.fgDim }}>
            <span style={{ color: MESH.amber }}>{tokens.toLocaleString()}</span> tokens
          </span>
          <Pill tone={active ? "amber" : "dim"}>{active ? "thinking" : "idle"}</Pill>
        </div>
      </div>

      {/* stream */}
      <div
        ref={streamRef}
        style={{
          flex: 1,
          overflow: "auto",
          padding: "20px 24px 24px",
          fontFamily: "var(--font-mono), ui-monospace, monospace",
          fontSize: 13,
          lineHeight: 1.75,
          color: MESH.fgDim,
        }}
      >
        {lines.length === 0 && (
          <div style={{ color: MESH.fgMute, fontStyle: "italic" }}>
            Waiting for thinking stream…
          </div>
        )}
        {lines.map((ln, i) => {
          const lineStyle: CSSProperties = {};
          let content: string;
          let prefix: React.ReactNode = null;
          if (typeof ln === "object") {
            content = ln.text;
            if (ln.kind === "heading") {
              lineStyle.color = MESH.fg;
              lineStyle.fontWeight = 600;
              lineStyle.marginTop = i === 0 ? 0 : 18;
              lineStyle.marginBottom = 4;
            }
            if (ln.kind === "mute") lineStyle.color = MESH.fgMute;
            if (ln.kind === "amber") lineStyle.color = MESH.amber;
            if (ln.kind === "red") lineStyle.color = MESH.red;
            if (ln.kind === "green") lineStyle.color = MESH.green;
            if (ln.kind === "code") {
              lineStyle.color = "#C8C8CC";
              lineStyle.paddingLeft = 16;
            }
            if (ln.kind === "bullet") {
              prefix = <span style={{ color: MESH.fgMute, marginRight: 8 }}>›</span>;
            }
            if (ln.kind === "blank") {
              return <div key={i} style={{ height: 10 }} />;
            }
          } else {
            content = ln;
          }
          const isCaret = caretLine === i;
          return (
            <div key={i} style={{ whiteSpace: "pre-wrap", ...lineStyle }}>
              {prefix}
              {content}
              {isCaret && (
                <span
                  style={{
                    display: "inline-block",
                    width: 8,
                    height: 14,
                    background: MESH.amber,
                    marginLeft: 4,
                    verticalAlign: "-2px",
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Thin wrapper for raw monospace text (e.g., Anthropic streaming thinking).
 * Keeps the header + styling but treats the input as a single pre-wrapped block.
 *
 * `tokens` is the raw character count of the streaming text; we render it as
 * an approximate token estimate (chars/4) and label it "thinking" to avoid
 * collision with the sidebar's context counter.
 */
export function ThinkingPanelRaw({
  text,
  tokens = 0,
  active = true,
  style,
  header = "Extended thinking",
  sub = "Opus 4.7",
  placeholder = "Waiting for thinking stream…",
}: {
  text: string;
  tokens?: number;
  active?: boolean;
  style?: CSSProperties;
  header?: string;
  sub?: string;
  placeholder?: string;
}) {
  const estThinkingTokens = Math.ceil(tokens / 4);
  const thinkingLabel =
    estThinkingTokens >= 1000
      ? `${(estThinkingTokens / 1000).toFixed(1)}K`
      : `${estThinkingTokens}`;
  const streamRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (streamRef.current) streamRef.current.scrollTop = streamRef.current.scrollHeight;
  }, [text]);

  return (
    <div
      style={{
        background: MESH.bg,
        height: "100%",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        border: `1px solid ${MESH.border}`,
        borderRadius: 8,
        overflow: "hidden",
        ...style,
      }}
    >
      <div
        style={{
          padding: "14px 22px",
          borderBottom: `1px solid ${MESH.border}`,
          display: "flex",
          alignItems: "center",
          gap: 12,
          position: "relative",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: `radial-gradient(ellipse at 18% 50%, ${MESH.amberGlow} 0%, transparent 55%)`,
            pointerEvents: "none",
          }}
        />
        <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: 999,
              background: active ? MESH.amber : MESH.fgMute,
              boxShadow: active ? `0 0 8px ${MESH.amber}` : "none",
            }}
          />
          <span
            className="font-mono"
            style={{ fontSize: 12, color: MESH.fg, fontWeight: 500, letterSpacing: "0.01em" }}
          >
            {header}
          </span>
          <span className="font-mono" style={{ fontSize: 11, color: MESH.fgMute }}>
            · {sub}
          </span>
        </div>
        <div
          style={{
            marginLeft: "auto",
            position: "relative",
            display: "flex",
            alignItems: "center",
            gap: 14,
          }}
        >
          <span className="font-mono" style={{ fontSize: 11, color: MESH.fgDim }}>
            <span style={{ color: MESH.amber }}>~{thinkingLabel}</span> thinking
          </span>
          <Pill tone={active ? "amber" : "dim"}>{active ? "thinking" : "idle"}</Pill>
        </div>
      </div>
      <div
        ref={streamRef}
        className="font-mono"
        style={{
          flex: 1,
          overflow: "auto",
          padding: "20px 24px 24px",
          fontSize: 13,
          lineHeight: 1.75,
          color: MESH.fgDim,
          whiteSpace: "pre-wrap",
        }}
      >
        {text ? text : <span style={{ color: MESH.fgMute, fontStyle: "italic" }}>{placeholder}</span>}
      </div>
    </div>
  );
}
