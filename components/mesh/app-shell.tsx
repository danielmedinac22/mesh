import type { ReactNode } from "react";
import { MESH } from "./tokens";
import { Sidebar, type SidebarRepo } from "./sidebar";
import { TopBar } from "./topbar";
import { Atmosphere } from "./atmosphere";

export function AppShell({
  title,
  subtitle,
  topRight,
  children,
  repos,
  noTopBar,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  topRight?: ReactNode;
  children: ReactNode;
  repos?: SidebarRepo[];
  noTopBar?: boolean;
}) {
  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        background: MESH.bg,
        color: MESH.fg,
        minHeight: "100vh",
      }}
    >
      <Atmosphere />
      <div style={{ position: "relative", zIndex: 1, display: "flex", width: "100%", minHeight: "100vh" }}>
        <Sidebar repos={repos} />
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            height: "100vh",
          }}
        >
          {!noTopBar && <TopBar title={title} subtitle={subtitle} right={topRight} />}
          <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
