"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AppShell,
  Pill,
  Tabs,
  TabList,
  Tab,
  TabPanel,
  type TabId,
} from "@/components/mesh";
import { SettingsSection } from "@/components/settings/settings-section";
import { SkillsSection } from "@/components/settings/skills-section";
import { AgentsSection } from "@/components/settings/agents-section";
import { EngineSection, type EngineStatus } from "@/components/settings/engine-section";
import { ProfileSection } from "@/components/settings/profile-section";
import { GithubSection } from "@/components/settings/github-section";

const TABS: { id: TabId; label: string }[] = [
  { id: "profile", label: "Profile" },
  { id: "github", label: "GitHub" },
  { id: "engine", label: "Engine" },
  { id: "skills", label: "Skills" },
  { id: "agents", label: "Agents" },
];

const VALID_TABS = new Set(TABS.map((t) => t.id));

export default function SettingsPage() {
  const [tab, setTabState] = useState<TabId>("profile");
  const [status, setStatus] = useState<EngineStatus>("loading");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Sync tab with URL hash on first load and on hash change.
  useEffect(() => {
    if (typeof window === "undefined") return;
    function readHash() {
      const h = window.location.hash.replace(/^#/, "");
      if (h && VALID_TABS.has(h)) setTabState(h);
    }
    readHash();
    window.addEventListener("hashchange", readHash);
    return () => window.removeEventListener("hashchange", readHash);
  }, []);

  const setTab = useCallback((next: TabId) => {
    setTabState(next);
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", `#${next}`);
    }
  }, []);

  const handleStatus = useCallback((s: EngineStatus, message?: string) => {
    setStatus(s);
    setStatusMessage(message ?? null);
    if (s === "saved") {
      // Auto-revert "saved" → "ready" after 2s so the chip doesn't stick.
      setTimeout(() => {
        setStatus((cur) => (cur === "saved" ? "ready" : cur));
      }, 2000);
    }
  }, []);

  const statusLabel =
    status === "loading"
      ? "loading…"
      : status === "saving"
        ? "saving…"
        : status === "saved"
          ? "saved"
          : status === "error"
            ? "error"
            : "ready";
  const statusTone: "amber" | "green" | "red" | "dim" =
    status === "saving"
      ? "amber"
      : status === "saved"
        ? "green"
        : status === "error"
          ? "red"
          : "dim";

  return (
    <AppShell
      title="Settings"
      subtitle="profile · github · engine · skills · agents"
      topRight={
        <Pill tone={statusTone}>
          {statusMessage && status === "error"
            ? `error: ${statusMessage.slice(0, 60)}`
            : statusLabel}
        </Pill>
      }
    >
      <Tabs value={tab} onChange={setTab}>
        <div
          style={{
            flex: 1,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            style={{
              padding: "0 32px",
              maxWidth: 1080,
              width: "100%",
              margin: "0 auto",
            }}
          >
            <TabList>
              {TABS.map((t) => (
                <Tab key={t.id} id={t.id}>
                  {t.label}
                </Tab>
              ))}
            </TabList>
          </div>
          <div
            style={{
              flex: 1,
              overflow: "auto",
              padding: "28px 32px 64px",
              maxWidth: 1080,
              width: "100%",
              margin: "0 auto",
            }}
          >
            <TabPanel id="profile">
              <ProfileSection onStatus={handleStatus} />
            </TabPanel>
            <TabPanel id="github">
              <GithubSection onStatus={handleStatus} />
            </TabPanel>
            <TabPanel id="engine">
              <EngineSection onStatus={handleStatus} />
            </TabPanel>
            <TabPanel id="skills">
              <SettingsSection
                id="skills-inner"
                title="Skills"
                kicker="claude code · .claude/skills/"
                caption="Skills nudge agents toward project invariants, preferred patterns, and stable facts. Claude picks the kind for you when you draft a new one."
              >
                <SkillsSection />
              </SettingsSection>
            </TabPanel>
            <TabPanel id="agents">
              <SettingsSection
                id="agents-inner"
                title="Agents"
                kicker="master dispatch · .claude/agents/"
                caption="The four base agents (frontend / backend / product / qa) drive the build dispatch. Custom agents are editable here and visible to Claude as roster context."
              >
                <AgentsSection />
              </SettingsSection>
            </TabPanel>
          </div>
        </div>
      </Tabs>
    </AppShell>
  );
}
