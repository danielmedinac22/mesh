"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { MESH } from "./tokens";
import { Pill } from "./pill";
import { CornerBrackets } from "./corner-brackets";

export type CinemaPhase = {
  id: string;
  label: string;
  tone?: "amber" | "signal" | "green" | "dim";
};

export type CinemaMode = "cinema" | "docked" | "off";

type CinemaProps = {
  /** Raw streaming text. If you have parsed lines, prefer `lines`. */
  text?: string;
  /** Pre-parsed structured lines. Optional alternative to `text`. */
  lines?: Array<
    | string
    | {
        text: string;
        kind?: "heading" | "mute" | "amber" | "red" | "green" | "code" | "bullet" | "blank";
      }
  >;
  mode: CinemaMode;
  /** raw character count of streaming text */
  tokens?: number;
  active?: boolean;
  phase?: CinemaPhase | null;
  /** All phases in order; current = `phase`. Used as breadcrumb. */
  phases?: CinemaPhase[];
  /** Title at top, e.g. "Drafting plan · cross-repo" */
  title?: ReactNode;
  /** Subtitle, e.g. ticket name */
  subtitle?: ReactNode;
  /** Right-side meta in header (e.g., engine, model) */
  meta?: ReactNode;
  /** Footer right CTAs when docked or finished */
  footer?: ReactNode;
  /** Called when the user dismisses cinema mode (esc / backdrop / minimize button) */
  onDismiss?: () => void;
  /** Called when the user clicks the docked rail to expand back to cinema */
  onExpand?: () => void;
};

const TONE_COLOR: Record<NonNullable<CinemaPhase["tone"]>, string> = {
  amber: MESH.amber,
  signal: "var(--mesh-signal)",
  green: MESH.green,
  dim: MESH.fgMute,
};

const TONE_GLOW: Record<NonNullable<CinemaPhase["tone"]>, string> = {
  amber: "rgba(245, 165, 36, 0.18)",
  signal: "rgba(76, 154, 255, 0.18)",
  green: "rgba(48, 164, 108, 0.16)",
  dim: "rgba(154, 154, 162, 0.10)",
};

function formatTokens(raw: number): { value: string; label: string } {
  const est = Math.max(0, Math.ceil(raw / 4));
  if (est >= 1000) return { value: (est / 1000).toFixed(1) + "K", label: "thinking" };
  return { value: String(est), label: "thinking" };
}

export function CinemaThinking(props: CinemaProps) {
  if (props.mode === "off") return null;
  if (props.mode === "docked") return <DockedThinking {...props} />;
  return <FullCinema {...props} />;
}

function FullCinema(props: CinemaProps) {
  const {
    text = "",
    lines,
    tokens = 0,
    active = true,
    phase,
    phases,
    title,
    subtitle,
    meta,
    footer,
    onDismiss,
  } = props;

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const streamRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (streamRef.current) streamRef.current.scrollTop = streamRef.current.scrollHeight;
  }, [text, lines]);

  useEffect(() => {
    if (!onDismiss) return;
    const handle = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [onDismiss]);

  const tok = useMemo(() => formatTokens(tokens), [tokens]);
  const tone = phase?.tone ?? "amber";
  const accent = TONE_COLOR[tone];
  const accentGlow = TONE_GLOW[tone];

  if (!mounted) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Extended thinking"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 80,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 32,
        animation: `mesh-cinema-backdrop var(--motion-base) var(--ease) both`,
      }}
    >
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Minimize thinking panel"
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(8, 8, 10, 0.62)",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
          border: 0,
          cursor: onDismiss ? "pointer" : "default",
        }}
      />
      <div
        style={{
          position: "relative",
          width: "min(1100px, 78vw)",
          height: "min(78vh, 820px)",
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
          background: MESH.bg,
          border: `1px solid ${MESH.borderHi}`,
          borderRadius: 12,
          boxShadow: `0 28px 80px rgba(0,0,0,0.7), 0 0 0 1px ${accentGlow}, 0 0 60px ${accentGlow}`,
          overflow: "hidden",
          animation: `mesh-cinema-in var(--motion-cinema) var(--ease) both`,
        }}
      >
        {/* atmospheric glow on top edge */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            background: `radial-gradient(60% 50% at 80% 0%, ${accentGlow} 0%, transparent 60%), radial-gradient(40% 40% at 10% 100%, ${accentGlow} 0%, transparent 70%)`,
          }}
        />

        {/* HEADER */}
        <header
          style={{
            position: "relative",
            padding: "18px 26px 16px",
            borderBottom: `1px solid ${MESH.border}`,
            display: "flex",
            flexDirection: "column",
            gap: 10,
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <PulseDot active={active} color={accent} />
            <span
              className="mesh-hud"
              style={{ color: MESH.fgDim, letterSpacing: "0.18em" }}
            >
              EXTENDED THINKING
            </span>
            <span style={{ color: MESH.fgMute }}>·</span>
            <span
              className="mesh-mono"
              style={{ fontSize: 11, color: MESH.fgMute, textTransform: "lowercase" }}
            >
              opus 4.7 · 1m context
            </span>
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 14 }}>
              {meta}
              <TokenTicker value={tok.value} label={tok.label} active={active} accent={accent} />
              <Pill tone={active ? "amber" : "dim"}>{active ? "live" : "idle"}</Pill>
              {onDismiss && (
                <button
                  type="button"
                  onClick={onDismiss}
                  className="mesh-mono"
                  style={{
                    fontSize: 10,
                    color: MESH.fgDim,
                    background: "transparent",
                    border: `1px solid ${MESH.border}`,
                    padding: "4px 8px",
                    borderRadius: 4,
                    cursor: "pointer",
                    textTransform: "uppercase",
                    letterSpacing: "0.14em",
                  }}
                  aria-label="Minimize"
                >
                  esc · dock
                </button>
              )}
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
            {title && (
              <h2
                className="mesh-display"
                style={{
                  margin: 0,
                  fontSize: 32,
                  lineHeight: 1.1,
                  color: MESH.fg,
                  letterSpacing: "-0.02em",
                }}
              >
                {title}
              </h2>
            )}
            {subtitle && (
              <span
                className="mesh-mono"
                style={{ fontSize: 12, color: MESH.fgDim, textTransform: "lowercase" }}
              >
                {subtitle}
              </span>
            )}
          </div>

          {phases && phases.length > 0 && (
            <PhaseStrip phases={phases} currentId={phase?.id} />
          )}
        </header>

        {/* STREAM */}
        <div
          ref={streamRef}
          style={{
            position: "relative",
            flex: 1,
            overflow: "auto",
            padding: "26px 32px 32px",
            minHeight: 0,
          }}
        >
          {lines && lines.length > 0 ? (
            <StructuredStream lines={lines} active={active} accent={accent} />
          ) : text ? (
            <RawStream text={text} active={active} accent={accent} />
          ) : (
            <div
              className="mesh-mono"
              style={{ color: MESH.fgMute, fontStyle: "italic", fontSize: 13 }}
            >
              Waiting for thinking stream…
            </div>
          )}
        </div>

        {/* FOOTER */}
        {(footer || onDismiss) && (
          <footer
            style={{
              padding: "14px 26px",
              borderTop: `1px solid ${MESH.border}`,
              display: "flex",
              alignItems: "center",
              gap: 14,
              flexShrink: 0,
              background: MESH.bgElev,
            }}
          >
            <span
              className="mesh-hud"
              style={{ color: MESH.fgMute }}
            >
              CINEMA MODE
            </span>
            <span style={{ color: MESH.fgMute }}>·</span>
            <span
              className="mesh-mono"
              style={{ fontSize: 11, color: MESH.fgMute }}
            >
              press <span style={{ color: MESH.fg }}>esc</span> to minimize
            </span>
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
              {footer}
            </div>
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}

function DockedThinking(props: CinemaProps) {
  const {
    text = "",
    lines,
    tokens = 0,
    active = true,
    phase,
    title,
    subtitle,
    onExpand,
  } = props;
  const tok = formatTokens(tokens);
  const accent = TONE_COLOR[phase?.tone ?? "amber"];

  return (
    <aside
      style={{
        width: 320,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        background: MESH.bg,
        borderLeft: `1px solid ${MESH.border}`,
        height: "100%",
        position: "relative",
      }}
    >
      <header
        style={{
          padding: "14px 18px",
          borderBottom: `1px solid ${MESH.border}`,
          display: "flex",
          flexDirection: "column",
          gap: 6,
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <PulseDot active={active} color={accent} />
          <span className="mesh-hud" style={{ color: MESH.fgDim }}>
            THINKING
          </span>
          <Pill tone={active ? "amber" : "dim"} style={{ marginLeft: "auto" }}>
            {active ? "live" : "complete"}
          </Pill>
        </div>
        {title && (
          <div
            className="mesh-display"
            style={{ fontSize: 18, color: MESH.fg, lineHeight: 1.2, letterSpacing: "-0.01em" }}
          >
            {title}
          </div>
        )}
        {subtitle && (
          <span
            className="mesh-mono"
            style={{ fontSize: 11, color: MESH.fgMute, textTransform: "lowercase" }}
          >
            {subtitle}
          </span>
        )}
        <div
          className="mesh-mono"
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 10,
            color: MESH.fgMute,
            paddingTop: 4,
          }}
        >
          <span>
            ~{tok.value} {tok.label}
          </span>
          {phase && <span style={{ color: accent }}>{phase.label}</span>}
        </div>
      </header>

      <div
        style={{
          flex: 1,
          overflow: "auto",
          padding: "14px 18px",
          minHeight: 0,
          fontFamily: "var(--font-mono), monospace",
          fontSize: 12,
          lineHeight: 1.7,
          color: MESH.fgDim,
          whiteSpace: "pre-wrap",
        }}
      >
        {lines && lines.length > 0 ? (
          <StructuredStream lines={lines} active={false} accent={accent} compact />
        ) : text ? (
          text
        ) : (
          <span style={{ color: MESH.fgMute, fontStyle: "italic" }}>
            No reasoning captured yet.
          </span>
        )}
      </div>

      {onExpand && (
        <button
          type="button"
          onClick={onExpand}
          className="mesh-mono"
          style={{
            margin: "0 18px 16px",
            padding: "8px 12px",
            background: MESH.bgElev,
            color: MESH.fg,
            border: `1px solid ${MESH.borderHi}`,
            borderRadius: 6,
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: "0.12em",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span>expand cinema</span>
          <span style={{ color: MESH.fgMute }}>↗</span>
        </button>
      )}
    </aside>
  );
}

function PulseDot({ active, color }: { active: boolean; color: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: 8,
        height: 8,
        borderRadius: 999,
        background: active ? color : MESH.fgMute,
        boxShadow: active ? `0 0 12px ${color}, 0 0 0 3px rgba(255,255,255,0.04)` : "none",
        animation: active ? "mesh-pulse 1.6s ease-in-out infinite" : undefined,
      }}
    />
  );
}

function PhaseStrip({
  phases,
  currentId,
}: {
  phases: CinemaPhase[];
  currentId?: string;
}) {
  return (
    <div
      role="list"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 0,
        flexWrap: "wrap",
        marginTop: 4,
      }}
    >
      {phases.map((p, i) => {
        const isCurrent = p.id === currentId;
        const isPast =
          phases.findIndex((x) => x.id === currentId) > i && currentId !== undefined;
        const tone = p.tone ?? "dim";
        const color = isCurrent ? TONE_COLOR[tone] : isPast ? MESH.fgDim : MESH.fgMute;
        return (
          <span
            key={p.id}
            role="listitem"
            style={{ display: "inline-flex", alignItems: "center" }}
          >
            <span
              className="mesh-hud"
              style={{
                color,
                opacity: isCurrent ? 1 : 0.7,
                padding: "4px 0",
                position: "relative",
              }}
            >
              {isCurrent && (
                <span
                  aria-hidden
                  style={{
                    position: "absolute",
                    bottom: -2,
                    left: 0,
                    right: 0,
                    height: 2,
                    background: color,
                    boxShadow: `0 0 8px ${color}`,
                  }}
                />
              )}
              {String(i + 1).padStart(2, "0")} · {p.label}
            </span>
            {i < phases.length - 1 && (
              <span style={{ color: MESH.fgMute, padding: "0 10px" }}>›</span>
            )}
          </span>
        );
      })}
    </div>
  );
}

function TokenTicker({
  value,
  label,
  active,
  accent,
}: {
  value: string;
  label: string;
  active: boolean;
  accent: string;
}) {
  return (
    <CornerBrackets tone={active ? "amber" : "default"}>
      <span
        className="mesh-mono"
        style={{
          padding: "4px 12px",
          fontSize: 12,
          color: MESH.fg,
          display: "inline-flex",
          alignItems: "baseline",
          gap: 6,
          fontVariantNumeric: "tabular-nums",
          minWidth: 84,
          justifyContent: "center",
        }}
      >
        <span style={{ color: active ? accent : MESH.fgDim, fontWeight: 600 }}>
          {value}
        </span>
        <span
          style={{
            color: MESH.fgMute,
            fontSize: 9,
            textTransform: "uppercase",
            letterSpacing: "0.16em",
          }}
        >
          {label}
        </span>
      </span>
    </CornerBrackets>
  );
}

function StructuredStream({
  lines,
  active,
  accent,
  compact = false,
}: {
  lines: NonNullable<CinemaProps["lines"]>;
  active: boolean;
  accent: string;
  compact?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: compact ? 2 : 4,
      }}
    >
      {lines.map((ln, i) => {
        const isLast = i === lines.length - 1;
        if (typeof ln === "string") {
          return (
            <div
              key={i}
              className="mesh-mono"
              style={{
                fontSize: compact ? 12 : 14,
                lineHeight: 1.7,
                color: MESH.fgDim,
                whiteSpace: "pre-wrap",
              }}
            >
              {ln}
              {active && isLast && <Caret accent={accent} />}
            </div>
          );
        }
        if (ln.kind === "blank") return <div key={i} style={{ height: compact ? 6 : 12 }} />;
        if (ln.kind === "heading") {
          return (
            <div
              key={i}
              className="mesh-display"
              style={{
                fontSize: compact ? 16 : 22,
                color: MESH.fg,
                marginTop: i === 0 ? 0 : compact ? 8 : 18,
                marginBottom: compact ? 2 : 6,
                letterSpacing: "-0.01em",
                lineHeight: 1.25,
              }}
            >
              {ln.text}
              {active && isLast && <Caret accent={accent} />}
            </div>
          );
        }
        if (ln.kind === "code") {
          return (
            <div
              key={i}
              className="mesh-mono"
              style={{
                fontSize: compact ? 11 : 12.5,
                color: "#C8C8CC",
                background: MESH.bgElev,
                border: `1px solid ${MESH.border}`,
                borderRadius: 4,
                padding: compact ? "6px 10px" : "10px 14px",
                margin: compact ? "2px 0" : "4px 0",
                whiteSpace: "pre-wrap",
              }}
            >
              {ln.text}
              {active && isLast && <Caret accent={accent} />}
            </div>
          );
        }
        if (ln.kind === "bullet") {
          return (
            <div
              key={i}
              className="mesh-mono"
              style={{
                display: "flex",
                gap: 8,
                fontSize: compact ? 12 : 14,
                color: MESH.fgDim,
                lineHeight: 1.6,
                whiteSpace: "pre-wrap",
              }}
            >
              <span style={{ color: accent, flexShrink: 0 }}>—</span>
              <span style={{ flex: 1 }}>
                {ln.text}
                {active && isLast && <Caret accent={accent} />}
              </span>
            </div>
          );
        }
        const color =
          ln.kind === "amber"
            ? MESH.amber
            : ln.kind === "red"
            ? MESH.red
            : ln.kind === "green"
            ? MESH.green
            : ln.kind === "mute"
            ? MESH.fgMute
            : MESH.fgDim;
        return (
          <div
            key={i}
            className="mesh-mono"
            style={{
              fontSize: compact ? 12 : 14,
              color,
              lineHeight: 1.7,
              whiteSpace: "pre-wrap",
            }}
          >
            {ln.text}
            {active && isLast && <Caret accent={accent} />}
          </div>
        );
      })}
    </div>
  );
}

function RawStream({
  text,
  active,
  accent,
}: {
  text: string;
  active: boolean;
  accent: string;
}) {
  // Split on double newlines into pseudo-paragraphs to give the editorial layout some rhythm.
  const blocks = useMemo(() => text.split(/\n{2,}/), [text]);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {blocks.map((block, i) => {
        const isLast = i === blocks.length - 1;
        const isHeading = /^[A-Z][A-Za-z0-9 \-_]{2,60}$/.test(block.split("\n")[0] ?? "");
        if (isHeading && block.length < 80) {
          return (
            <div
              key={i}
              className="mesh-display"
              style={{
                fontSize: 24,
                color: MESH.fg,
                letterSpacing: "-0.01em",
                lineHeight: 1.25,
              }}
            >
              {block}
              {active && isLast && <Caret accent={accent} />}
            </div>
          );
        }
        return (
          <div
            key={i}
            className="mesh-mono"
            style={{
              fontSize: 14,
              color: MESH.fgDim,
              lineHeight: 1.75,
              whiteSpace: "pre-wrap",
            }}
          >
            {block}
            {active && isLast && <Caret accent={accent} />}
          </div>
        );
      })}
    </div>
  );
}

function Caret({ accent }: { accent: string }) {
  return (
    <span
      aria-hidden
      style={{
        display: "inline-block",
        width: 8,
        height: 14,
        marginLeft: 4,
        background: accent,
        verticalAlign: "-2px",
        animation: "mesh-blink 1s steps(2, end) infinite",
      }}
    />
  );
}
