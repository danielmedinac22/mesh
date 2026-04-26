"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AppShell,
  CinemaThinking,
  MESH,
  Pill,
  type CinemaPhase,
} from "@/components/mesh";
import { ConnectCard, type ConnectState } from "@/components/brain/connect-card";
import { RolePicker } from "@/components/brain/role-picker";
import {
  ProfileSection,
  EmptyDimension,
} from "@/components/brain/profile-section";
import {
  QuestionStream,
  type PendingQuestion,
} from "@/components/brain/question-stream";
import { ProvenanceBadge } from "@/components/brain/provenance-badge";
import { getPlaybook, SOURCE_META, type SourceKind } from "@/lib/role-playbooks";
import type {
  BrainProfile,
  ProfileDimension,
  Role,
} from "@/lib/user-brain";

type View = "empty" | "role" | "connect" | "onboarding" | "profile";

export default function BrainPage() {
  const [view, setView] = useState<View>("empty");
  const [profile, setProfile] = useState<BrainProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const [role, setRole] = useState<Role | null>(null);
  const [roleLabel, setRoleLabel] = useState<string>("");
  const [selectedSources, setSelectedSources] = useState<SourceKind[]>([]);

  const [cinemaMode, setCinemaMode] = useState<"cinema" | "docked" | "off">("off");
  const [phases, setPhases] = useState<CinemaPhase[]>([]);
  const [currentPhase, setCurrentPhase] = useState<CinemaPhase | null>(null);
  const [thinkingText, setThinkingText] = useState("");
  const [streamingActive, setStreamingActive] = useState(false);
  const [questions, setQuestions] = useState<PendingQuestion[]>([]);
  const [questionsActive, setQuestionsActive] = useState(false);

  const sourceStates = useRef<Map<SourceKind, ConnectState>>(new Map());

  const playbook = useMemo(() => (role ? getPlaybook(role) : null), [role]);
  const isProfilePopulated = useMemo(() => {
    if (!profile) return false;
    const c = profile.confidence;
    return Object.values(c).reduce((a, b) => a + b, 0) > 1.0;
  }, [profile]);

  const loadProfile = useCallback(async () => {
    try {
      const res = await fetch("/api/brain/profile", { cache: "no-store" });
      const json = (await res.json()) as { profile: BrainProfile };
      setProfile(json.profile);
      const populated =
        Object.values(json.profile.confidence).reduce((a, b) => a + b, 0) > 1.0;
      if (populated) setView("profile");
      else setView("empty");
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  // ── Onboarding flow ────────────────────────────────────────────────────

  const startOnboarding = useCallback(async () => {
    if (!role) return;
    setView("onboarding");
    setCinemaMode("cinema");
    setPhases([
      { id: "intake", label: "Intake", tone: "amber" },
      { id: "fetch", label: "Fetch", tone: "signal" },
      { id: "read", label: "Read", tone: "signal" },
      { id: "synthesize", label: "Synthesize", tone: "amber" },
      { id: "questions", label: "Gap-fill", tone: "green" },
    ]);
    setCurrentPhase({ id: "intake", label: "Intake", tone: "amber" });
    setThinkingText("");
    setQuestions([]);
    setStreamingActive(true);

    try {
      const res = await fetch("/api/brain/onboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role,
          sources: selectedSources,
          lang: "en",
        }),
      });
      if (!res.ok || !res.body) throw new Error("onboard failed");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const collectedQuestions: PendingQuestion[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let sep: number;
        while ((sep = buffer.indexOf("\n\n")) !== -1) {
          const raw = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          for (const line of raw.split("\n")) {
            if (!line.startsWith("data: ")) continue;
            try {
              const ev = JSON.parse(line.slice(6));
              if (ev.type === "phase") {
                const p: CinemaPhase = {
                  id: ev.id,
                  label: ev.label,
                  tone: ev.tone ?? "amber",
                };
                setCurrentPhase(p);
                setThinkingText((t) => t + `\n\n${ev.label}…\n`);
              } else if (ev.type === "source-fetched") {
                setThinkingText(
                  (t) => t + `· ${ev.source}: ${ev.count} items\n`,
                );
                sourceStates.current.set(ev.source, "done");
              } else if (ev.type === "thinking") {
                setThinkingText((t) => t + ev.delta);
              } else if (ev.type === "text") {
                setThinkingText((t) => t + ev.delta);
              } else if (ev.type === "question") {
                collectedQuestions.push({
                  dim: ev.dim,
                  prompt: ev.prompt,
                  hint: ev.hint,
                });
              } else if (ev.type === "done") {
                setProfile(ev.profile);
                setStreamingActive(false);
                if (collectedQuestions.length > 0) {
                  setQuestions(collectedQuestions);
                  setQuestionsActive(true);
                  // Dock so the user can see questions overlay clearly
                  setCinemaMode("docked");
                } else {
                  setCinemaMode("off");
                  setView("profile");
                }
              } else if (ev.type === "error") {
                setThinkingText((t) => t + `\n\nError: ${ev.message}\n`);
                setStreamingActive(false);
              }
            } catch {
              // ignore malformed lines
            }
          }
        }
      }
    } catch (err) {
      setThinkingText(
        (t) => t + `\n\nError: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      setStreamingActive(false);
    }
  }, [role, selectedSources]);

  const handleAnswer = useCallback(
    async (dim: ProfileDimension, text: string) => {
      const res = await fetch("/api/brain/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dim, text }),
      });
      if (res.ok) {
        const json = (await res.json()) as { profile: BrainProfile };
        setProfile(json.profile);
      }
    },
    [],
  );

  const finishQuestions = useCallback(() => {
    setQuestionsActive(false);
    setCinemaMode("off");
    setView("profile");
    void loadProfile();
  }, [loadProfile]);

  const resetAll = useCallback(async () => {
    if (!confirm("Reset your full profile? (notes at /brain/notes are kept)")) return;
    await fetch("/api/brain/profile", { method: "DELETE" });
    setRole(null);
    setRoleLabel("");
    setSelectedSources([]);
    setQuestions([]);
    await loadProfile();
  }, [loadProfile]);

  // ── Render ─────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <AppShell title="Brain" subtitle="Your personal context for Mesh">
        <div
          className="font-mono"
          style={{ padding: 32, color: MESH.fgMute, fontSize: 12 }}
        >
          loading…
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell
      title="Brain"
      subtitle="Your learned profile — injected into every Mesh plan"
    >
      <div
        style={{
          maxWidth: 980,
          width: "100%",
          margin: "0 auto",
          padding: "24px 24px 64px",
          display: "flex",
          flexDirection: "column",
          gap: 24,
        }}
      >
        {/* Top action bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <Link
            href="/brain/notes"
            style={{
              padding: "6px 12px",
              borderRadius: 6,
              background: "transparent",
              border: `1px solid ${MESH.border}`,
              color: MESH.fgDim,
              fontSize: 12,
              textDecoration: "none",
              fontFamily: "var(--font-mono), monospace",
              letterSpacing: "0.04em",
            }}
          >
            notes &amp; uploads →
          </Link>
          {view === "profile" && isProfilePopulated && (
            <button
              type="button"
              onClick={resetAll}
              className="font-mono"
              style={{
                marginLeft: "auto",
                background: "transparent",
                border: `1px solid ${MESH.border}`,
                borderRadius: 6,
                padding: "6px 12px",
                color: MESH.fgMute,
                fontSize: 11,
                cursor: "pointer",
              }}
            >
              reset profile
            </button>
          )}
        </div>

        {view === "empty" && (
          <EmptyHero
            onStart={() => setView("role")}
            isPopulated={isProfilePopulated}
          />
        )}

        {view === "role" && (
          <RoleStep
            onPick={(r, label) => {
              setRole(r);
              setRoleLabel(label);
              const pb = getPlaybook(r);
              setSelectedSources(pb.sources.primary);
              setView("connect");
            }}
            onBack={() => setView("empty")}
          />
        )}

        {view === "connect" && playbook && (
          <ConnectStep
            roleLabel={roleLabel}
            playbook={playbook}
            selected={selectedSources}
            onToggle={(s) =>
              setSelectedSources((prev) =>
                prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s],
              )
            }
            onStart={startOnboarding}
            onSkip={startOnboarding}
            onBack={() => setView("role")}
          />
        )}

        {view === "profile" && profile && (
          <ProfileGrid
            profile={profile}
            roleLabel={profile.who?.roleLabel ?? roleLabel}
            playbookRole={profile.who?.role ?? role ?? "other"}
            onRefresh={() => setView("role")}
          />
        )}

        {view === "onboarding" && questionsActive && questions.length > 0 && (
          <QuestionStream
            questions={questions}
            onAnswer={handleAnswer}
            onSkip={() => undefined}
            onDone={finishQuestions}
          />
        )}
      </div>

      <CinemaThinking
        mode={cinemaMode}
        text={thinkingText}
        active={streamingActive}
        tokens={thinkingText.length}
        phase={currentPhase}
        phases={phases}
        title={
          <span>
            Learning about you<span style={{ color: MESH.amber }}>.</span>
          </span>
        }
        subtitle={`${roleLabel} · ${selectedSources.length} source${selectedSources.length === 1 ? "" : "s"}`}
        onDismiss={() => setCinemaMode("docked")}
        onExpand={() => setCinemaMode("cinema")}
      />
    </AppShell>
  );
}

// ── Empty hero ──────────────────────────────────────────────────────────

function EmptyHero({
  onStart,
  isPopulated,
}: {
  onStart: () => void;
  isPopulated: boolean;
}) {
  return (
    <section
      style={{
        padding: "48px 32px 56px",
        background: MESH.bgElev,
        border: `1px solid ${MESH.border}`,
        borderRadius: 12,
        display: "flex",
        flexDirection: "column",
        gap: 18,
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(60% 80% at 80% -10%, rgba(245,165,36,0.10) 0%, transparent 60%), radial-gradient(40% 60% at 0% 100%, rgba(76,154,255,0.08) 0%, transparent 70%)",
          pointerEvents: "none",
        }}
      />
      <span
        className="font-mono"
        style={{
          fontSize: 11,
          color: MESH.amber,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          zIndex: 1,
        }}
      >
        Personal brain
      </span>
      <h1
        className="mesh-display"
        style={{
          margin: 0,
          fontSize: 40,
          color: MESH.fg,
          letterSpacing: "-0.03em",
          lineHeight: 1.05,
          maxWidth: 720,
          zIndex: 1,
        }}
      >
        Mesh works better when it knows you.
      </h1>
      <p
        style={{
          margin: 0,
          fontSize: 16,
          color: MESH.fgDim,
          lineHeight: 1.55,
          maxWidth: 640,
          zIndex: 1,
        }}
      >
        Tell me your role, we connect the sources where your work lives, and in
        3 minutes I'll have a profile that gets injected as context into every
        plan I build for you.
      </p>
      <div style={{ display: "flex", gap: 10, marginTop: 8, zIndex: 1 }}>
        <button
          type="button"
          onClick={onStart}
          style={{
            padding: "10px 18px",
            borderRadius: 6,
            background: MESH.amber,
            border: `1px solid ${MESH.amber}`,
            color: "#0B0B0C",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {isPopulated ? "Re-train profile" : "Get started — 3 min"}
        </button>
        <Link
          href="/brain/notes"
          style={{
            padding: "10px 16px",
            borderRadius: 6,
            background: "transparent",
            border: `1px solid ${MESH.border}`,
            color: MESH.fgDim,
            fontSize: 13,
            textDecoration: "none",
          }}
        >
          Or upload a .md
        </Link>
      </div>
    </section>
  );
}

// ── Role step ───────────────────────────────────────────────────────────

function RoleStep({
  onPick,
  onBack,
}: {
  onPick: (role: Role, label: string) => void;
  onBack: () => void;
}) {
  return (
    <section
      style={{
        padding: "28px 24px 28px",
        background: MESH.bgElev,
        border: `1px solid ${MESH.border}`,
        borderRadius: 10,
        display: "flex",
        flexDirection: "column",
        gap: 18,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span
          className="font-mono"
          style={{
            fontSize: 10,
            color: MESH.fgMute,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
          }}
        >
          Step 1 of 2
        </span>
        <button
          type="button"
          onClick={onBack}
          className="font-mono"
          style={{
            marginLeft: "auto",
            background: "transparent",
            border: "none",
            color: MESH.fgMute,
            fontSize: 11,
            cursor: "pointer",
          }}
        >
          ← back
        </button>
      </div>
      <h2
        className="mesh-display"
        style={{
          margin: 0,
          fontSize: 26,
          color: MESH.fg,
          letterSpacing: "-0.02em",
          lineHeight: 1.1,
        }}
      >
        Which role describes you best?
      </h2>
      <p
        style={{
          margin: 0,
          fontSize: 13.5,
          color: MESH.fgDim,
          maxWidth: 560,
          lineHeight: 1.55,
        }}
      >
        This decides which sources I offer you next and what questions I ask.
        You can change it later.
      </p>
      <RolePicker onPick={onPick} />
    </section>
  );
}

// ── Connect step ────────────────────────────────────────────────────────

function ConnectStep({
  roleLabel,
  playbook,
  selected,
  onToggle,
  onStart,
  onSkip,
  onBack,
}: {
  roleLabel: string;
  playbook: ReturnType<typeof getPlaybook>;
  selected: SourceKind[];
  onToggle: (s: SourceKind) => void;
  onStart: () => void;
  onSkip: () => void;
  onBack: () => void;
}) {
  const all: SourceKind[] = [
    ...playbook.sources.primary,
    ...playbook.sources.placeholder,
  ];
  return (
    <section
      style={{
        padding: "28px 24px 28px",
        background: MESH.bgElev,
        border: `1px solid ${MESH.border}`,
        borderRadius: 10,
        display: "flex",
        flexDirection: "column",
        gap: 18,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span
          className="font-mono"
          style={{
            fontSize: 10,
            color: MESH.fgMute,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
          }}
        >
          Step 2 of 2 · {roleLabel}
        </span>
        <button
          type="button"
          onClick={onBack}
          className="font-mono"
          style={{
            marginLeft: "auto",
            background: "transparent",
            border: "none",
            color: MESH.fgMute,
            fontSize: 11,
            cursor: "pointer",
          }}
        >
          ← back
        </button>
      </div>
      <h2
        className="mesh-display"
        style={{
          margin: 0,
          fontSize: 26,
          color: MESH.fg,
          letterSpacing: "-0.02em",
          lineHeight: 1.1,
        }}
      >
        Where should we pull your context from?
      </h2>
      <p
        style={{
          margin: 0,
          fontSize: 13.5,
          color: MESH.fgDim,
          maxWidth: 560,
          lineHeight: 1.55,
        }}
      >
        {playbook.pitch}
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          gap: 12,
        }}
      >
        {all.map((s) => (
          <ConnectCard
            key={s}
            source={s}
            state="idle"
            selected={selected.includes(s)}
            disabled={!SOURCE_META[s].live}
            onToggle={() => onToggle(s)}
          />
        ))}
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 4 }}>
        <button
          type="button"
          onClick={onStart}
          disabled={selected.length === 0}
          style={{
            padding: "10px 18px",
            borderRadius: 6,
            background: MESH.amber,
            border: `1px solid ${MESH.amber}`,
            color: "#0B0B0C",
            fontSize: 13,
            fontWeight: 600,
            cursor: selected.length === 0 ? "not-allowed" : "pointer",
            opacity: selected.length === 0 ? 0.4 : 1,
          }}
        >
          Connect {selected.length} {selected.length === 1 ? "source" : "sources"} and learn
        </button>
        <button
          type="button"
          onClick={onSkip}
          className="font-mono"
          style={{
            background: "transparent",
            border: `1px solid ${MESH.border}`,
            borderRadius: 6,
            padding: "10px 14px",
            color: MESH.fgDim,
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          skip and just chat
        </button>
      </div>
    </section>
  );
}

// ── Profile grid ────────────────────────────────────────────────────────

function ProfileGrid({
  profile,
  roleLabel,
  playbookRole,
  onRefresh,
}: {
  profile: BrainProfile;
  roleLabel: string;
  playbookRole: Role;
  onRefresh: () => void;
}) {
  const playbook = getPlaybook(playbookRole);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <header
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <h2
          className="mesh-display"
          style={{
            margin: 0,
            fontSize: 22,
            color: MESH.fg,
            letterSpacing: "-0.02em",
          }}
        >
          What I know about you
        </h2>
        <Pill tone="amber">{roleLabel}</Pill>
        <button
          type="button"
          onClick={onRefresh}
          className="font-mono"
          style={{
            marginLeft: "auto",
            background: "transparent",
            border: `1px solid ${MESH.border}`,
            borderRadius: 6,
            padding: "6px 12px",
            color: MESH.fgDim,
            fontSize: 11.5,
            cursor: "pointer",
          }}
        >
          + add source / re-train
        </button>
      </header>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, 1fr)",
          gap: 12,
        }}
      >
        {/* Who — full width */}
        <ProfileSection
          label="Who you are"
          filled={!!profile.who?.bio || !!profile.who?.name}
          provenance={profile.who?.provenance}
          confidence={profile.confidence.who}
          span={2}
        >
          {profile.who?.bio || profile.who?.name ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {(profile.who?.name || profile.who?.company || profile.who?.team) && (
                <div style={{ fontSize: 15, color: MESH.fg, fontWeight: 500 }}>
                  {[profile.who?.name, profile.who?.company, profile.who?.team]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              )}
              {profile.who?.bio && (
                <p
                  style={{
                    margin: 0,
                    fontSize: 13.5,
                    color: MESH.fgDim,
                    lineHeight: 1.55,
                  }}
                >
                  {profile.who.bio}
                </p>
              )}
            </div>
          ) : (
            <EmptyDimension hint={playbook.questions.who.hint} />
          )}
        </ProfileSection>

        <ProfileSection
          label="What you work on"
          filled={
            !!profile.focus?.summary ||
            (profile.focus?.areas?.length ?? 0) > 0 ||
            (profile.focus?.activeInitiatives?.length ?? 0) > 0
          }
          provenance={profile.focus?.provenance}
          confidence={profile.confidence.focus}
        >
          {profile.focus?.summary || profile.focus?.activeInitiatives?.length ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {profile.focus?.summary && (
                <p style={{ margin: 0, fontSize: 13.5, color: MESH.fgDim, lineHeight: 1.55 }}>
                  {profile.focus.summary}
                </p>
              )}
              {profile.focus?.areas?.length ? (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {profile.focus.areas.map((a) => (
                    <Pill key={a} tone="dim">
                      {a}
                    </Pill>
                  ))}
                </div>
              ) : null}
              {profile.focus?.activeInitiatives?.length ? (
                <ul
                  style={{
                    margin: 0,
                    padding: 0,
                    listStyle: "none",
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                  }}
                >
                  {profile.focus.activeInitiatives.slice(0, 4).map((i, idx) => (
                    <li
                      key={idx}
                      style={{
                        fontSize: 12.5,
                        color: MESH.fgDim,
                        lineHeight: 1.5,
                      }}
                    >
                      <span style={{ color: MESH.amber }}>—</span> {i.title}
                      {i.note && (
                        <span style={{ color: MESH.fgMute }}> · {i.note}</span>
                      )}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : (
            <EmptyDimension hint={playbook.questions.focus.hint} />
          )}
        </ProfileSection>

        <ProfileSection
          label="How you decide"
          filled={(profile.decisions?.rules?.length ?? 0) > 0}
          provenance={profile.decisions?.provenance}
          confidence={profile.confidence.decisions}
        >
          {profile.decisions?.rules?.length ? (
            <ul
              style={{
                margin: 0,
                padding: 0,
                listStyle: "none",
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              {profile.decisions.rules.slice(0, 5).map((r, idx) => (
                <li
                  key={idx}
                  style={{
                    fontSize: 12.5,
                    color: MESH.fg,
                    lineHeight: 1.5,
                    paddingLeft: 12,
                    borderLeft: `2px solid ${MESH.amber}`,
                  }}
                >
                  {r.rule}
                  {r.why && (
                    <div style={{ color: MESH.fgMute, fontSize: 11, marginTop: 2 }}>
                      {r.why}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyDimension hint={playbook.questions.decisions.hint} />
          )}
        </ProfileSection>

        <ProfileSection
          label="Who you work with"
          filled={
            (profile.people?.stakeholders?.length ?? 0) > 0 ||
            !!profile.people?.escalation
          }
          provenance={profile.people?.provenance}
          confidence={profile.confidence.people}
        >
          {(profile.people?.stakeholders?.length ?? 0) > 0 ||
          profile.people?.escalation ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {profile.people?.stakeholders?.length ? (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {profile.people.stakeholders.slice(0, 6).map((s) => (
                    <Pill key={s} tone="dim">
                      {s}
                    </Pill>
                  ))}
                </div>
              ) : null}
              {profile.people?.escalation && (
                <p
                  style={{
                    margin: 0,
                    fontSize: 12,
                    color: MESH.fgMute,
                    lineHeight: 1.5,
                  }}
                >
                  Escalation: {profile.people.escalation}
                </p>
              )}
            </div>
          ) : (
            <EmptyDimension hint={playbook.questions.people.hint} />
          )}
        </ProfileSection>

        <ProfileSection
          label="Where context lives"
          filled={
            (profile.sources?.connected?.length ?? 0) > 0 ||
            !!profile.sources?.lives
          }
          provenance={profile.sources?.provenance}
          confidence={profile.confidence.sources}
        >
          {(profile.sources?.connected?.length ?? 0) > 0 ||
          profile.sources?.lives ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {profile.sources?.connected?.length ? (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {profile.sources.connected.map((s) => (
                    <Pill key={s} tone="green">
                      {s}
                    </Pill>
                  ))}
                </div>
              ) : null}
              {profile.sources?.lives && (
                <p
                  style={{
                    margin: 0,
                    fontSize: 12.5,
                    color: MESH.fgDim,
                    lineHeight: 1.5,
                  }}
                >
                  {profile.sources.lives}
                </p>
              )}
            </div>
          ) : (
            <EmptyDimension hint={playbook.questions.sources.hint} />
          )}
        </ProfileSection>

        <ProfileSection
          label="How you communicate"
          filled={!!profile.comms?.style || !!profile.comms?.format}
          provenance={profile.comms?.provenance}
          confidence={profile.confidence.comms}
        >
          {profile.comms?.style || profile.comms?.format ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {profile.comms?.style && (
                  <Pill tone="amber">{profile.comms.style}</Pill>
                )}
                {profile.comms?.lang && (
                  <Pill tone="dim">lang: {profile.comms.lang}</Pill>
                )}
              </div>
              {profile.comms?.format && (
                <p
                  style={{
                    margin: 0,
                    fontSize: 12.5,
                    color: MESH.fgDim,
                    lineHeight: 1.5,
                  }}
                >
                  {profile.comms.format}
                </p>
              )}
            </div>
          ) : (
            <EmptyDimension hint={playbook.questions.comms.hint} />
          )}
        </ProfileSection>
      </div>

      <footer
        style={{
          marginTop: 8,
          padding: "12px 14px",
          background: MESH.bg,
          border: `1px dashed ${MESH.border}`,
          borderRadius: 6,
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <ProvenanceBadge
          provenance={[
            { source: "synthesized", at: profile.updatedAt },
          ]}
          align="left"
        />
        <span
          className="font-mono"
          style={{ fontSize: 10.5, color: MESH.fgMute }}
        >
          stored at .mesh/user/brain.json — appended to every Build / Ship prompt as cached system context.
        </span>
      </footer>
    </div>
  );
}
