import { NextResponse } from "next/server";
import { z } from "zod";
import {
  loadProfile,
  mergeProfile,
  PROFILE_DIMENSIONS,
  type BrainProfile,
  type ProfileDimension,
} from "@/lib/user-brain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  dim: z.enum(PROFILE_DIMENSIONS),
  text: z.string().min(1),
});

// Free-text answer to a profile gap-fill question. We do a very simple,
// deterministic merge: stash the raw user text on the relevant dimension
// (so it is never lost) and bump confidence to 0.85. The synthesizer
// can later normalize this into structured fields when the user reruns
// onboarding, but the value of the text alone is enough to inject as
// context into Build/Ship prompts.
export async function POST(req: Request) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 },
    );
  }

  const { dim, text } = parsed.data;
  const current = await loadProfile();
  const patch = applyTextAnswer(current, dim, text);
  patch.confidence = { ...current.confidence, [dim]: 0.85 };
  const profile = await mergeProfile(patch);
  return NextResponse.json({ profile });
}

function applyTextAnswer(
  current: BrainProfile,
  dim: ProfileDimension,
  text: string,
): Partial<BrainProfile> {
  const userProv = { source: "user" as const, at: new Date().toISOString() };
  switch (dim) {
    case "who": {
      const base = current.who ?? { provenance: [] };
      return {
        who: {
          ...base,
          bio: text,
          provenance: [...(base.provenance ?? []), userProv],
        },
      };
    }
    case "focus": {
      const base = current.focus ?? { areas: [], activeInitiatives: [], provenance: [] };
      return {
        focus: {
          ...base,
          summary: text,
          provenance: [...(base.provenance ?? []), userProv],
        },
      };
    }
    case "decisions": {
      const base = current.decisions ?? { rules: [], provenance: [] };
      // Split on newlines / "; " / "•" / numbered lists into discrete rules.
      const lines = text
        .split(/\n+|(?:;\s*)|(?:^|\s)\d+[\.)]\s+|(?:^|\s)[•\-—]\s+/m)
        .map((s) => s.trim())
        .filter(Boolean);
      const rules =
        lines.length > 1
          ? lines.map((rule) => ({ rule, source: userProv }))
          : [{ rule: text, source: userProv }];
      return {
        decisions: {
          ...base,
          rules: [...base.rules, ...rules],
          provenance: [...(base.provenance ?? []), userProv],
        },
      };
    }
    case "people": {
      const base = current.people ?? {
        stakeholders: [],
        reviewers: [],
        provenance: [],
      };
      // First non-empty line → escalation hint, rest → stakeholders.
      const all = text.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
      return {
        people: {
          ...base,
          stakeholders: Array.from(new Set([...base.stakeholders, ...all])),
          escalation: base.escalation ?? all[0] ?? text,
          provenance: [...(base.provenance ?? []), userProv],
        },
      };
    }
    case "sources": {
      const base = current.sources ?? { connected: [], preferred: [], provenance: [] };
      const tokens = text
        .toLowerCase()
        .split(/[,\s]+/)
        .map((s) => s.replace(/[.,;:]/g, "").trim())
        .filter(Boolean);
      return {
        sources: {
          ...base,
          lives: text,
          preferred: Array.from(new Set([...base.preferred, ...tokens])),
          provenance: [...(base.provenance ?? []), userProv],
        },
      };
    }
    case "comms": {
      const base = current.comms ?? { provenance: [] };
      const lower = text.toLowerCase();
      const style: BrainProfile["comms"] extends infer T
        ? T extends { style?: infer S }
          ? S
          : never
        : never =
        /(terse|breve|directo|corto|bullets?)/.test(lower)
          ? "terse"
          : /(detall|verbose|expli|profund)/.test(lower)
          ? "detailed"
          : "balanced";
      const lang = /(español|spanish|\bes\b)/.test(lower)
        ? "es"
        : /(english|inglés|\ben\b)/.test(lower)
        ? "en"
        : base?.lang;
      return {
        comms: {
          ...base,
          style,
          lang: lang ?? "en",
          format: text,
          provenance: [...(base.provenance ?? []), userProv],
        },
      };
    }
  }
}
