"use client";

import { type ReactNode } from "react";
import { MESH } from "./tokens";

export type TabId = string;

export function Tabs({
  value,
  onChange,
  children,
}: {
  value: TabId;
  onChange: (id: TabId) => void;
  children: ReactNode;
}) {
  return (
    <TabsContext.Provider value={{ value, onChange }}>
      {children}
    </TabsContext.Provider>
  );
}

export function TabList({
  children,
  bordered = true,
}: {
  children: ReactNode;
  bordered?: boolean;
}) {
  return (
    <div
      role="tablist"
      style={{
        display: "flex",
        gap: 2,
        borderBottom: bordered ? `1px solid ${MESH.border}` : "none",
        paddingLeft: 4,
        overflow: "auto",
      }}
    >
      {children}
    </div>
  );
}

export function Tab({
  id,
  children,
  trailing,
}: {
  id: TabId;
  children: ReactNode;
  trailing?: ReactNode;
}) {
  const ctx = useTabsContext();
  const active = ctx.value === id;
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={() => ctx.onChange(id)}
      className="font-mono"
      style={{
        padding: "12px 14px",
        background: "transparent",
        border: "none",
        borderBottom: `2px solid ${active ? MESH.amber : "transparent"}`,
        color: active ? MESH.fg : MESH.fgMute,
        fontSize: 12,
        fontWeight: active ? 500 : 400,
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        whiteSpace: "nowrap",
        transition: "color 120ms, border-color 120ms",
      }}
    >
      <span>{children}</span>
      {trailing}
    </button>
  );
}

export function TabPanel({
  id,
  children,
}: {
  id: TabId;
  children: ReactNode;
}) {
  const ctx = useTabsContext();
  if (ctx.value !== id) return null;
  return (
    <div role="tabpanel" style={{ display: "flex", flexDirection: "column" }}>
      {children}
    </div>
  );
}

import { createContext, useContext } from "react";

type TabsCtx = { value: TabId; onChange: (id: TabId) => void };
const TabsContext = createContext<TabsCtx | null>(null);

function useTabsContext(): TabsCtx {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error("Tab components must be used inside <Tabs>");
  return ctx;
}
