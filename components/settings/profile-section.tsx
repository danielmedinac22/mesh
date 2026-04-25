"use client";

import { useEffect, useState, type ReactNode } from "react";
import { MESH } from "@/components/mesh";
import { ErrorBanner, SectionHeader, type EngineStatus } from "./engine-section";

type ProfileColor = "amber" | "violet" | "blue" | "green" | "red" | "slate";

const COLOR_MAP: Record<ProfileColor, { bg: string; fg: string }> = {
  amber: { bg: "rgba(245,165,36,0.18)", fg: MESH.amber },
  violet: { bg: "rgba(176,140,221,0.18)", fg: MESH.purple },
  blue: { bg: "rgba(94,177,239,0.18)", fg: MESH.blue },
  green: { bg: "rgba(48,164,108,0.18)", fg: MESH.green },
  red: { bg: "rgba(229,72,77,0.18)", fg: MESH.red },
  slate: { bg: "rgba(154,154,162,0.18)", fg: MESH.fgDim },
};

const COLORS: ProfileColor[] = ["amber", "violet", "blue", "green", "red", "slate"];

type Profile = {
  fullName?: string;
  email?: string;
  role?: string;
  company?: string;
  githubUsername?: string;
  language?: "es" | "en";
  avatarColor?: ProfileColor;
};

type DraftProfile = Required<{
  [K in keyof Profile]: NonNullable<Profile[K]>;
}>;

const EMPTY: DraftProfile = {
  fullName: "",
  email: "",
  role: "",
  company: "",
  githubUsername: "",
  language: "es",
  avatarColor: "amber",
};

export function ProfileSection({
  onStatus,
}: {
  onStatus?: (s: EngineStatus, message?: string) => void;
}) {
  const [draft, setDraft] = useState<DraftProfile>(EMPTY);
  const [initial, setInitial] = useState<DraftProfile>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // Initial load: GET /api/config + autopopulate githubUsername from /api/github/auth.
  useEffect(() => {
    onStatus?.("loading");
    void (async () => {
      try {
        const [cfgRes, ghRes] = await Promise.all([
          fetch("/api/config", { cache: "no-store" }),
          fetch("/api/github/auth", { cache: "no-store" }),
        ]);
        const cfgJson = (await cfgRes.json()) as {
          config?: { profile?: Profile };
        };
        const ghJson = (await ghRes.json().catch(() => ({}))) as {
          state?: string;
          user?: string;
        };
        const merged: DraftProfile = {
          ...EMPTY,
          ...(cfgJson.config?.profile ?? {}),
        };
        if (
          !merged.githubUsername &&
          ghJson.state === "signed-in" &&
          ghJson.user
        ) {
          merged.githubUsername = ghJson.user;
        }
        setDraft(merged);
        setInitial(merged);
        onStatus?.("ready");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        onStatus?.("error", msg);
      } finally {
        setLoaded(true);
      }
    })();
  }, [onStatus]);

  function update<K extends keyof DraftProfile>(key: K, value: DraftProfile[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  async function save() {
    setSaving(true);
    setError(null);
    onStatus?.("saving");
    try {
      // Strip empty strings to keep config.json clean (schema fields are optional).
      const profile: Profile = {
        language: draft.language,
        avatarColor: draft.avatarColor,
      };
      if (draft.fullName.trim()) profile.fullName = draft.fullName.trim();
      if (draft.email.trim()) profile.email = draft.email.trim();
      if (draft.role.trim()) profile.role = draft.role.trim();
      if (draft.company.trim()) profile.company = draft.company.trim();
      if (draft.githubUsername.trim())
        profile.githubUsername = draft.githubUsername.trim();

      const res = await fetch("/api/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setInitial(draft);
      setSavedAt(Date.now());
      onStatus?.("saved");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      onStatus?.("error", msg);
    } finally {
      setSaving(false);
    }
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const initials = computeInitials(draft.fullName);
  const colorTokens = COLOR_MAP[draft.avatarColor];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      <SectionHeader
        title="Profile"
        kicker="who you are"
        caption="Mesh uses these fields to personalize plans, PR authoring, and the chat experience. Saved locally to .mesh/config.json — nothing leaves your machine."
      />
      {error && <ErrorBanner message={error} />}

      <Block kicker="Personal information">
        <Row>
          <div style={{ display: "flex", alignItems: "center", gap: 14, flex: 1 }}>
            <Avatar initials={initials} color={colorTokens} />
            <Field label="Full name" style={{ flex: 1 }}>
              <Input
                value={draft.fullName}
                onChange={(v) => update("fullName", v)}
                placeholder="Daniel Medina"
                disabled={!loaded}
              />
            </Field>
          </div>
        </Row>
        <Row>
          <Field label="Email" style={{ flex: 1 }}>
            <Input
              type="email"
              value={draft.email}
              onChange={(v) => update("email", v)}
              placeholder="you@domain.com"
              disabled={!loaded}
            />
          </Field>
          <Field label="Conversation language" style={{ flex: 1 }}>
            <Select
              value={draft.language}
              onChange={(v) => update("language", v as "es" | "en")}
              disabled={!loaded}
              options={[
                { value: "es", label: "Spanish (es)" },
                { value: "en", label: "English (en)" },
              ]}
            />
          </Field>
        </Row>
        <Row>
          <Field label="Avatar color" style={{ flex: 1 }}>
            <ColorPicker
              value={draft.avatarColor}
              onChange={(v) => update("avatarColor", v)}
              disabled={!loaded}
            />
          </Field>
        </Row>
      </Block>

      <Block kicker="Work">
        <Row>
          <Field label="Role / title" style={{ flex: 1 }}>
            <Input
              value={draft.role}
              onChange={(v) => update("role", v)}
              placeholder="Senior Engineer"
              disabled={!loaded}
            />
          </Field>
          <Field label="Company / team" style={{ flex: 1 }}>
            <Input
              value={draft.company}
              onChange={(v) => update("company", v)}
              placeholder="Simetrik"
              disabled={!loaded}
            />
          </Field>
        </Row>
        <Row>
          <Field
            label="GitHub username"
            hint="Auto-detected from gh auth status when signed in."
            style={{ flex: 1 }}
          >
            <Input
              value={draft.githubUsername}
              onChange={(v) => update("githubUsername", v)}
              placeholder="octocat"
              disabled={!loaded}
            />
          </Field>
        </Row>
      </Block>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          paddingTop: 8,
        }}
      >
        <button
          type="button"
          onClick={save}
          disabled={!loaded || saving || !dirty}
          className="font-mono"
          style={{
            padding: "10px 18px",
            borderRadius: 6,
            border: `1px solid ${dirty ? MESH.amber : MESH.border}`,
            background: dirty ? MESH.amber : "transparent",
            color: dirty ? "#0B0B0C" : MESH.fgMute,
            fontSize: 12.5,
            fontWeight: 500,
            cursor: !loaded || saving || !dirty ? "default" : "pointer",
            opacity: saving ? 0.6 : 1,
          }}
        >
          {saving ? "saving…" : "Save profile"}
        </button>
        {savedAt && !dirty && (
          <span
            className="font-mono"
            style={{ fontSize: 11, color: MESH.fgMute }}
          >
            saved
          </span>
        )}
        {dirty && !saving && (
          <button
            type="button"
            onClick={() => setDraft(initial)}
            className="font-mono"
            style={{
              padding: "8px 12px",
              borderRadius: 6,
              border: `1px solid ${MESH.border}`,
              background: "transparent",
              color: MESH.fgDim,
              fontSize: 11.5,
              cursor: "pointer",
            }}
          >
            Discard
          </button>
        )}
      </div>
    </div>
  );
}

function computeInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "·";
  const parts = trimmed.split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "·";
}

function Avatar({
  initials,
  color,
}: {
  initials: string;
  color: { bg: string; fg: string };
}) {
  return (
    <div
      aria-hidden
      style={{
        width: 56,
        height: 56,
        borderRadius: 999,
        background: color.bg,
        color: color.fg,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontWeight: 600,
        fontSize: 20,
        letterSpacing: "0.02em",
        border: `1px solid ${MESH.border}`,
        flexShrink: 0,
      }}
    >
      {initials}
    </div>
  );
}

function ColorPicker({
  value,
  onChange,
  disabled,
}: {
  value: ProfileColor;
  onChange: (v: ProfileColor) => void;
  disabled?: boolean;
}) {
  return (
    <div style={{ display: "flex", gap: 8 }}>
      {COLORS.map((c) => {
        const active = c === value;
        const tokens = COLOR_MAP[c];
        return (
          <button
            key={c}
            type="button"
            disabled={disabled}
            onClick={() => onChange(c)}
            aria-label={c}
            style={{
              width: 28,
              height: 28,
              borderRadius: 999,
              background: tokens.bg,
              border: `2px solid ${active ? tokens.fg : "transparent"}`,
              cursor: disabled ? "default" : "pointer",
              padding: 0,
              transition: "border-color 120ms",
            }}
          >
            <span
              style={{
                display: "block",
                width: "100%",
                height: "100%",
                borderRadius: 999,
                background: tokens.fg,
                opacity: 0.9,
              }}
            />
          </button>
        );
      })}
    </div>
  );
}

function Block({ kicker, children }: { kicker: string; children: ReactNode }) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <span
        className="font-mono"
        style={{
          fontSize: 10.5,
          color: MESH.fgMute,
          textTransform: "uppercase",
          letterSpacing: "0.16em",
          paddingBottom: 6,
          borderBottom: `1px solid ${MESH.border}`,
        }}
      >
        {kicker}
      </span>
      {children}
    </section>
  );
}

function Row({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        gap: 14,
        flexWrap: "wrap",
      }}
    >
      {children}
    </div>
  );
}

function Field({
  label,
  hint,
  children,
  style,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <label
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        minWidth: 220,
        ...style,
      }}
    >
      <span
        className="font-mono"
        style={{
          fontSize: 10.5,
          color: MESH.fgDim,
          textTransform: "uppercase",
          letterSpacing: "0.12em",
        }}
      >
        {label}
      </span>
      {children}
      {hint && (
        <span
          className="font-mono"
          style={{ fontSize: 10.5, color: MESH.fgMute, lineHeight: 1.5 }}
        >
          {hint}
        </span>
      )}
    </label>
  );
}

function Input({
  value,
  onChange,
  placeholder,
  type,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  disabled?: boolean;
}) {
  return (
    <input
      type={type ?? "text"}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      className="font-mono"
      style={{
        padding: "10px 12px",
        borderRadius: 6,
        border: `1px solid ${MESH.border}`,
        background: MESH.bgInput,
        color: MESH.fg,
        fontSize: 13,
        outline: "none",
        transition: "border-color 120ms",
      }}
      onFocus={(e) => (e.currentTarget.style.borderColor = MESH.amber)}
      onBlur={(e) => (e.currentTarget.style.borderColor = MESH.border)}
    />
  );
}

function Select({
  value,
  onChange,
  options,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className="font-mono"
      style={{
        padding: "10px 12px",
        borderRadius: 6,
        border: `1px solid ${MESH.border}`,
        background: MESH.bgInput,
        color: MESH.fg,
        fontSize: 13,
        outline: "none",
        cursor: disabled ? "default" : "pointer",
        appearance: "none",
        backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'><path d='M1 1l4 4 4-4' stroke='%239A9AA2' stroke-width='1.5' fill='none' stroke-linecap='round' stroke-linejoin='round'/></svg>")`,
        backgroundRepeat: "no-repeat",
        backgroundPosition: "right 12px center",
        paddingRight: 32,
      }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value} style={{ background: MESH.bgElev }}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
