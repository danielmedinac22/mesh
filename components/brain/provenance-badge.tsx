"use client";

import { MESH } from "@/components/mesh";
import type { ProvenanceRef } from "@/lib/user-brain";

const SOURCE_LABEL: Record<ProvenanceRef["source"], string> = {
  user: "you said",
  granola: "Granola",
  linear: "Linear",
  jira: "Jira",
  github: "GitHub",
  upload: "upload",
  synthesized: "synthesized",
};

export function ProvenanceBadge({
  provenance,
  align = "right",
}: {
  provenance?: ProvenanceRef[];
  align?: "left" | "right";
}) {
  if (!provenance || provenance.length === 0) return null;
  const summary = summarize(provenance);
  return (
    <span
      className="font-mono"
      style={{
        fontSize: 10,
        color: MESH.fgMute,
        letterSpacing: "0.04em",
        marginLeft: align === "right" ? "auto" : 0,
        whiteSpace: "nowrap",
      }}
    >
      {summary}
    </span>
  );
}

function summarize(prov: ProvenanceRef[]): string {
  // Group by source. If a granola group has count >1 surface "from N meetings".
  const byKey = new Map<string, number>();
  for (const p of prov) {
    const key = p.source;
    const count = p.count ?? 1;
    byKey.set(key, (byKey.get(key) ?? 0) + count);
  }
  const parts: string[] = [];
  for (const [src, count] of byKey) {
    const label = SOURCE_LABEL[src as ProvenanceRef["source"]] ?? src;
    if (src === "granola" && count > 1) parts.push(`from ${count} meetings`);
    else if (src === "user") parts.push(label);
    else if (count > 1) parts.push(`${count}× ${label}`);
    else parts.push(`from ${label}`);
  }
  return parts.join(" · ");
}
