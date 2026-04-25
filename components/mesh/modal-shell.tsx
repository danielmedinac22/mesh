"use client";

import { useEffect, type ReactNode } from "react";
import { MESH } from "./tokens";

export function ModalShell({
  open,
  onClose,
  title,
  meta,
  width = 560,
  footer,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  meta?: ReactNode;
  width?: number;
  footer?: ReactNode;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        background: "rgba(0,0,0,0.55)",
        backdropFilter: "blur(2px)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: 80,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width,
          maxWidth: "92vw",
          maxHeight: "calc(100vh - 140px)",
          background: MESH.bgElev,
          border: `1px solid ${MESH.borderHi}`,
          borderRadius: 8,
          boxShadow: "0 12px 40px rgba(0,0,0,0.45)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <header
          style={{
            padding: "14px 18px 10px",
            display: "flex",
            alignItems: "baseline",
            gap: 12,
            borderBottom: `1px solid ${MESH.border}`,
          }}
        >
          <div
            style={{
              fontSize: 14,
              fontWeight: 500,
              color: MESH.fg,
              letterSpacing: "-0.01em",
            }}
          >
            {title}
          </div>
          {meta && (
            <div
              className="font-mono"
              style={{ fontSize: 10, color: MESH.fgMute }}
            >
              {meta}
            </div>
          )}
        </header>
        <div
          style={{
            padding: "14px 18px",
            overflowY: "auto",
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          {children}
        </div>
        {footer && (
          <footer
            style={{
              padding: "12px 18px",
              borderTop: `1px solid ${MESH.border}`,
              background: MESH.bg,
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}

export function ModalLabel({ children }: { children: ReactNode }) {
  return (
    <div
      className="font-mono"
      style={{
        fontSize: 9,
        textTransform: "uppercase",
        letterSpacing: "0.14em",
        color: MESH.fgMute,
        marginBottom: 4,
      }}
    >
      {children}
    </div>
  );
}

export function PrimaryButton({
  onClick,
  disabled,
  children,
  kbd,
}: {
  onClick?: () => void;
  disabled?: boolean;
  children: ReactNode;
  kbd?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "8px 14px",
        fontSize: 12,
        fontWeight: 500,
        color: disabled ? MESH.fgMute : "#0B0B0C",
        background: disabled ? MESH.border : MESH.amber,
        border: `1px solid ${disabled ? MESH.border : MESH.amber}`,
        borderRadius: 5,
        cursor: disabled ? "not-allowed" : "pointer",
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        transition: "background 120ms",
      }}
    >
      <span>{children}</span>
      {kbd && (
        <span
          className="font-mono"
          style={{
            fontSize: 10,
            padding: "1px 5px",
            background: "rgba(0,0,0,0.15)",
            borderRadius: 3,
            color: disabled ? MESH.fgMute : "#0B0B0C",
          }}
        >
          {kbd}
        </span>
      )}
    </button>
  );
}

export function SecondaryButton({
  onClick,
  children,
  kbd,
  disabled,
}: {
  onClick?: () => void;
  children: ReactNode;
  kbd?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "7px 12px",
        fontSize: 12,
        color: MESH.fgDim,
        background: "transparent",
        border: `1px solid ${MESH.border}`,
        borderRadius: 5,
        cursor: disabled ? "not-allowed" : "pointer",
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
      }}
    >
      <span>{children}</span>
      {kbd && (
        <span
          className="font-mono"
          style={{
            fontSize: 10,
            padding: "1px 5px",
            background: MESH.bgElev2,
            borderRadius: 3,
            color: MESH.fgMute,
          }}
        >
          {kbd}
        </span>
      )}
    </button>
  );
}
