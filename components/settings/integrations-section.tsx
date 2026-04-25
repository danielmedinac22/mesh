"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  MESH,
  ModalShell,
  ModalLabel,
  Pill,
  PrimaryButton,
  SecondaryButton,
} from "@/components/mesh";
import { SectionHeader, ErrorBanner } from "./engine-section";

type IntegrationKind = "github" | "granola" | "jira" | "linear";

type IntegrationItem = {
  kind: IntegrationKind;
  connected: boolean;
  importedCount: number;
  lastImportAt?: string;
  lastError?: string;
  meta: {
    name: string;
    description: string;
    importVerb: string;
    bodyHint: string;
    defaultEntryKind: "note" | "meeting" | "ticket" | "link";
  };
};

type GithubAuth = {
  installed: boolean;
  authenticated: boolean;
  username?: string | null;
};

export function IntegrationsSection() {
  const [items, setItems] = useState<IntegrationItem[]>([]);
  const [github, setGithub] = useState<GithubAuth | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState<IntegrationKind | null>(null);

  const loadAll = useCallback(async () => {
    try {
      const [intRes, ghRes] = await Promise.all([
        fetch("/api/integrations", { cache: "no-store" }),
        fetch("/api/github/auth", { cache: "no-store" }),
      ]);
      const intJson = (await intRes.json()) as { integrations: IntegrationItem[] };
      const ghJson = (await ghRes.json()) as GithubAuth;
      setItems(intJson.integrations ?? []);
      setGithub(ghJson);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const disconnect = useCallback(
    async (kind: IntegrationKind) => {
      try {
        await fetch(`/api/integrations/${kind}`, { method: "DELETE" });
        await loadAll();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [loadAll],
  );

  const githubItem = useMemo(() => items.find((i) => i.kind === "github"), [items]);
  const others = useMemo(() => items.filter((i) => i.kind !== "github"), [items]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <SectionHeader
        title="Integrations"
        kicker="cross-project context channels"
        caption="GitHub powers cloning and PRs. Granola, Jira and Linear feed your personal Brain — content imported here becomes cross-project context that Mesh injects into every ticket plan."
      />
      {error && <ErrorBanner message={error} />}
      {loading && (
        <div
          className="font-mono"
          style={{ fontSize: 12, color: MESH.fgMute, padding: 12 }}
        >
          Loading…
        </div>
      )}
      {!loading && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {githubItem && (
            <GithubCard
              item={githubItem}
              auth={github}
              onJump={() => {
                if (typeof window !== "undefined") {
                  window.location.hash = "github";
                }
              }}
            />
          )}
          {others.map((it) => (
            <ProviderCard
              key={it.kind}
              item={it}
              onImport={() => setImporting(it.kind)}
              onDisconnect={() => disconnect(it.kind)}
            />
          ))}
        </div>
      )}
      <ImportModal
        kind={importing}
        item={importing ? items.find((i) => i.kind === importing) ?? null : null}
        onClose={() => setImporting(null)}
        onSaved={async () => {
          setImporting(null);
          await loadAll();
        }}
      />
    </div>
  );
}

function GithubCard({
  item,
  auth,
  onJump,
}: {
  item: IntegrationItem;
  auth: GithubAuth | null;
  onJump: () => void;
}) {
  const connected = !!auth?.authenticated;
  const installed = !!auth?.installed;
  return (
    <div style={cardStyle}>
      <CardHeader
        name={item.meta.name}
        description={item.meta.description}
        right={
          connected ? (
            <Pill tone="green">connected{auth?.username ? ` · ${auth.username}` : ""}</Pill>
          ) : installed ? (
            <Pill tone="amber">signed out</Pill>
          ) : (
            <Pill tone="red">gh CLI not installed</Pill>
          )
        }
      />
      <div style={{ display: "flex", gap: 8 }}>
        <SecondaryButton onClick={onJump}>Open GitHub settings</SecondaryButton>
      </div>
    </div>
  );
}

function ProviderCard({
  item,
  onImport,
  onDisconnect,
}: {
  item: IntegrationItem;
  onImport: () => void;
  onDisconnect: () => void;
}) {
  const connected = item.connected;
  return (
    <div style={cardStyle}>
      <CardHeader
        name={item.meta.name}
        description={item.meta.description}
        right={
          connected ? (
            <Pill tone="green">
              {item.importedCount} imported
            </Pill>
          ) : (
            <Pill tone="dim">not connected</Pill>
          )
        }
      />
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <PrimaryButton onClick={onImport}>{item.meta.importVerb}</PrimaryButton>
        {connected && (
          <SecondaryButton onClick={onDisconnect}>Reset</SecondaryButton>
        )}
        {connected && item.lastImportAt && (
          <span
            className="font-mono"
            style={{ fontSize: 10.5, color: MESH.fgMute }}
          >
            last import {timeAgo(item.lastImportAt)}
          </span>
        )}
      </div>
    </div>
  );
}

function CardHeader({
  name,
  description,
  right,
}: {
  name: string;
  description: string;
  right?: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <h3
          style={{
            margin: 0,
            fontSize: 15,
            fontWeight: 600,
            color: MESH.fg,
            letterSpacing: "-0.01em",
          }}
        >
          {name}
        </h3>
        {right && <span style={{ marginLeft: "auto" }}>{right}</span>}
      </div>
      <p
        style={{
          margin: 0,
          fontSize: 12.5,
          color: MESH.fgDim,
          lineHeight: 1.55,
        }}
      >
        {description}
      </p>
    </div>
  );
}

function ImportModal({
  kind,
  item,
  onClose,
  onSaved,
}: {
  kind: IntegrationKind | null;
  item: IntegrationItem | null;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [body, setBody] = useState("");
  const [title, setTitle] = useState("");
  const [ref, setRef] = useState("");
  const [tags, setTags] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!kind) {
      setBody("");
      setTitle("");
      setRef("");
      setTags("");
      setErr(null);
    }
  }, [kind]);

  const submit = useCallback(async () => {
    if (!kind) return;
    const trimmed = body.trim();
    if (!trimmed) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/integrations/${kind}/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body: trimmed,
          title: title.trim() || undefined,
          ref: ref.trim() || undefined,
          tags: tags
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? `HTTP ${res.status}`);
      }
      await onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [kind, body, title, ref, tags, onSaved]);

  return (
    <ModalShell
      open={!!kind}
      onClose={onClose}
      title={item ? `${item.meta.importVerb} — ${item.meta.name}` : ""}
      meta={item?.meta.defaultEntryKind}
      width={560}
      footer={
        <>
          <span style={{ flex: 1 }} />
          <SecondaryButton onClick={onClose} disabled={busy}>
            Cancel
          </SecondaryButton>
          <PrimaryButton onClick={submit} disabled={busy || !body.trim()}>
            {busy ? "Saving…" : "Import"}
          </PrimaryButton>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {item && (
          <p
            style={{
              margin: 0,
              fontSize: 12,
              color: MESH.fgDim,
              lineHeight: 1.5,
            }}
          >
            {item.meta.bodyHint}
          </p>
        )}
        <div>
          <ModalLabel>Title (optional)</ModalLabel>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Defaults to first line of body"
            style={inputStyle}
          />
        </div>
        <div>
          <ModalLabel>Reference (optional)</ModalLabel>
          <input
            value={ref}
            onChange={(e) => setRef(e.target.value)}
            placeholder={kind === "jira" ? "e.g. ENG-1234" : kind === "linear" ? "e.g. TEAM-42" : "free-form id"}
            style={inputStyle}
          />
        </div>
        <div>
          <ModalLabel>Body</ModalLabel>
          <textarea
            autoFocus
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={10}
            placeholder="Paste here…"
            style={{ ...inputStyle, fontFamily: "inherit", resize: "vertical", lineHeight: 1.5 }}
          />
        </div>
        <div>
          <ModalLabel>Tags</ModalLabel>
          <input
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="comma-separated"
            style={inputStyle}
          />
        </div>
        {err && (
          <div
            className="font-mono"
            style={{
              fontSize: 11,
              color: MESH.red,
              padding: "6px 8px",
              background: "rgba(229,72,77,0.08)",
              borderRadius: 4,
            }}
          >
            {err}
          </div>
        )}
      </div>
    </ModalShell>
  );
}

function timeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  if (!t) return "";
  const diff = Date.now() - t;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

const cardStyle: React.CSSProperties = {
  borderRadius: 8,
  border: `1px solid ${MESH.border}`,
  background: MESH.bgElev,
  padding: "16px 18px",
  display: "flex",
  flexDirection: "column",
  gap: 12,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  background: MESH.bgInput,
  border: `1px solid ${MESH.border}`,
  borderRadius: 5,
  color: MESH.fg,
  fontSize: 12.5,
  outline: "none",
};
