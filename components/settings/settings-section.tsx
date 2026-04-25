"use client";

import { useEffect, useState, type ReactNode } from "react";
import { MESH } from "@/components/mesh";

// Collapsible stacked section used inside /settings. Each section gets a
// title, a kicker label (small uppercase mono), an optional caption, and any
// children. The `id` is set as the element id so /settings#skills and
// /settings#agents scroll-anchor links work without a router. If the page
// loads with a hash matching this section's id, the section auto-expands.
export function SettingsSection({
  id,
  title,
  kicker,
  caption,
  topRight,
  defaultOpen = true,
  children,
}: {
  id: string;
  title: string;
  kicker?: string;
  caption?: ReactNode;
  topRight?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.location.hash.replace(/^#/, "") === id) {
      setOpen(true);
    }
  }, [id]);

  return (
    <section
      id={id}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: open ? 14 : 0,
        scrollMarginTop: 24,
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={`${id}-body`}
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 10,
          flexWrap: "wrap",
          background: "transparent",
          border: "none",
          padding: 0,
          margin: 0,
          cursor: "pointer",
          textAlign: "left",
          color: "inherit",
        }}
      >
        <Chevron open={open} />
        <h2
          style={{
            fontSize: 18,
            fontWeight: 600,
            letterSpacing: "-0.02em",
            margin: 0,
            color: MESH.fg,
          }}
        >
          {title}
        </h2>
        {kicker ? (
          <span
            className="font-mono"
            style={{
              fontSize: 11,
              color: MESH.fgMute,
              textTransform: "uppercase",
              letterSpacing: "0.14em",
            }}
          >
            {kicker}
          </span>
        ) : null}
        {topRight ? (
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ marginLeft: "auto" }}
          >
            {topRight}
          </div>
        ) : null}
      </button>
      {open && (
        <div
          id={`${id}-body`}
          style={{ display: "flex", flexDirection: "column", gap: 14 }}
        >
          {caption ? (
            <p
              style={{
                fontSize: 13,
                color: MESH.fgDim,
                lineHeight: 1.6,
                margin: 0,
              }}
            >
              {caption}
            </p>
          ) : null}
          {children}
        </div>
      )}
    </section>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <span
      aria-hidden
      style={{
        display: "inline-flex",
        width: 14,
        height: 14,
        alignItems: "center",
        justifyContent: "center",
        color: MESH.fgMute,
        transform: open ? "rotate(90deg)" : "rotate(0deg)",
        transition: "transform 140ms",
        flexShrink: 0,
      }}
    >
      <svg
        width="10"
        height="10"
        viewBox="0 0 10 10"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M3 1.5L6.5 5L3 8.5"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}
