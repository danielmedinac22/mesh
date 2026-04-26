import { NextRequest } from "next/server";
import {
  appendBrainEntry,
  loadProfile,
  mergeProfile,
  type BrainEntry,
  type BrainProfile,
  type ProfileDimension,
  type Role,
} from "@/lib/user-brain";
import { getPlaybook } from "@/lib/role-playbooks";
import { listRepos } from "@/lib/mesh-state";
import { listIntegrations, recordImport } from "@/lib/integrations";
import { getEngine, DEFAULT_MODEL } from "@/lib/engine";
import {
  fetchRecentMeetings,
  GRANOLA_DEFAULT_DAYS,
  GranolaNotLinkedError,
} from "@/lib/granola-mcp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// SSE event shapes — frontend consumes the same `data: {json}\n\n` pattern
// used by /api/connect.
type OnboardEvent =
  | {
      type: "phase";
      id: "intake" | "fetch" | "read" | "synthesize" | "questions" | "save";
      label: string;
      source?: string;
      tone?: "amber" | "signal" | "green" | "dim";
    }
  | { type: "source-fetched"; source: string; count: number }
  | { type: "entry"; entry: BrainEntry }
  | { type: "thinking"; delta: string }
  | { type: "text"; delta: string }
  | { type: "meta"; ttft_ms: number }
  | {
      type: "profile-delta";
      dim: ProfileDimension;
      value: BrainProfile[ProfileDimension];
      confidence: number;
    }
  | {
      type: "question";
      dim: ProfileDimension;
      prompt: string;
      hint: string;
    }
  | {
      type: "done";
      duration_ms: number;
      profile: BrainProfile;
      input_tokens?: number;
      output_tokens?: number;
    }
  | { type: "error"; message: string };

type Body = {
  role?: Role;
  sources?: string[];
  lang?: "es" | "en";
};

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Body;
  const role: Role = body.role ?? "other";
  const sources = (body.sources ?? []).filter(
    (s): s is "granola" | "linear" | "jira" | "github" =>
      s === "granola" || s === "linear" || s === "jira" || s === "github",
  );
  const lang = body.lang ?? "en";
  const playbook = getPlaybook(role);

  const encoder = new TextEncoder();
  const startedAt = Date.now();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (ev: OnboardEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
      };

      try {
        // ── 1. INTAKE — record role + connected sources on the profile ──
        send({
          type: "phase",
          id: "intake",
          label: `Receiving profile (${playbook.label})`,
          tone: "amber",
        });

        const initialPatch: Partial<BrainProfile> = {
          who: {
            role,
            roleLabel: playbook.label,
            provenance: [{ source: "user", at: new Date().toISOString() }],
          },
          sources: {
            connected: sources,
            preferred: sources,
            provenance: [
              { source: "user", at: new Date().toISOString() },
            ],
          },
          confidence: {
            who: 0.5,
            focus: 0,
            decisions: 0,
            people: 0,
            sources: sources.length > 0 ? 0.7 : 0.2,
            comms: 0,
          } as BrainProfile["confidence"],
        };
        await mergeProfile(initialPatch);

        // ── 2. FETCH — pull items from each connected source ──
        const allItems: SourceItem[] = [];
        for (const src of sources) {
          send({
            type: "phase",
            id: "fetch",
            label: `Pulling signals from ${src}`,
            source: src,
            tone: "signal",
          });
          const items = await fetchSourceItems(src, role);
          for (const it of items) {
            const entry = await appendBrainEntry({
              kind: it.kind,
              body: it.body,
              title: it.title,
              source: src,
              ref: it.ref,
              tags: it.tags ?? [],
            });
            send({ type: "entry", entry });
          }
          await recordImport(src as never, items.length).catch(() => {});
          allItems.push(...items);
          send({ type: "source-fetched", source: src, count: items.length });
        }

        // ── 3. READ — show that Opus is reading the corpus ──
        send({
          type: "phase",
          id: "read",
          label: `Reading ${allItems.length} signals with 1M context`,
          tone: "signal",
        });

        // ── 4. SYNTHESIZE — Opus builds a structured profile ──
        send({
          type: "phase",
          id: "synthesize",
          label: "Synthesizing your profile",
          tone: "amber",
        });

        const synth = await synthesizeProfile({
          role,
          roleLabel: playbook.label,
          items: allItems,
          lang,
          send,
        });

        const profile = await mergeProfile({
          ...synth.patch,
          confidence: synth.confidence,
        });

        for (const [dim, value] of Object.entries(synth.patch) as Array<
          [ProfileDimension, BrainProfile[ProfileDimension]]
        >) {
          if (!value) continue;
          send({
            type: "profile-delta",
            dim,
            value,
            confidence: synth.confidence[dim] ?? 0,
          });
        }

        // ── 5. QUESTIONS — emit gap-fill prompts for low-confidence dims ──
        send({
          type: "phase",
          id: "questions",
          label: "Closing the gaps",
          tone: "green",
        });

        const lowDims = (
          Object.entries(profile.confidence) as Array<[ProfileDimension, number]>
        )
          .filter(([, c]) => c < 0.7)
          .sort((a, b) => a[1] - b[1])
          .map(([d]) => d);

        for (const dim of lowDims) {
          const q = playbook.questions[dim];
          send({
            type: "question",
            dim,
            prompt: q.prompt,
            hint: q.hint,
          });
        }

        send({
          type: "phase",
          id: "save",
          label: "Done",
          tone: "green",
        });
        send({
          type: "done",
          duration_ms: Date.now() - startedAt,
          profile,
        });
      } catch (err) {
        send({
          type: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

// ── Source ingestion ────────────────────────────────────────────────────
//
// For the hackathon demo we lean on synthetic-but-realistic seed items
// per role — the demo must be 100% reliable even without live MCP or
// API tokens. GitHub uses real repo records since that path is wired.
// When MCP / Linear / Jira tokens are added later the same shape can
// be returned by a real fetcher.

type SourceItem = {
  kind: "meeting" | "ticket" | "note" | "link";
  title: string;
  body: string;
  ref?: string;
  tags?: string[];
};

async function fetchSourceItems(
  source: string,
  role: Role,
): Promise<SourceItem[]> {
  if (source === "github") {
    const repos = await listRepos().catch(() => []);
    return repos.slice(0, 6).map((r) => ({
      kind: "note" as const,
      title: r.name,
      body: `Connected repo: ${r.name}. Default branch: ${r.defaultBranch}. ${
        r.tokensEst ? `Indexed: ~${Math.round(r.tokensEst / 1000)}K tokens.` : ""
      }`,
      ref: r.githubOwner && r.githubRepo
        ? `${r.githubOwner}/${r.githubRepo}`
        : r.name,
      tags: ["repo", role],
    }));
  }

  if (source === "granola") {
    try {
      const meetings = await fetchRecentMeetings({ days: GRANOLA_DEFAULT_DAYS });
      if (meetings.length > 0) {
        return meetings.map((m) => ({
          kind: "meeting" as const,
          title: m.title,
          body:
            [m.summary, m.privateNotes].filter((s) => s && s.trim()).join("\n\n") ||
            "(empty)",
          ref: m.id,
          tags: m.attendees.slice(0, 3),
        }));
      }
    } catch (err) {
      // GranolaNotLinkedError or transient MCP failure — fall through to seeds
      // so the demo never breaks. The Settings card surfaces the link state.
      void (err instanceof GranolaNotLinkedError);
    }
    return granolaSeeds()[role] ?? granolaSeeds().other;
  }

  // Synthetic seeds — small, plausible, rotated by role so the cinema
  // feels real. Demo deterministic; we slice to 4 per source.
  const seedsByRoleAndSource: Record<string, Record<Role, SourceItem[]>> = {
    linear: linearSeeds(),
    jira: jiraSeeds(),
  };
  const bucket = seedsByRoleAndSource[source];
  if (!bucket) return [];
  return bucket[role] ?? bucket.other;
}

function granolaSeeds(): Record<Role, SourceItem[]> {
  return {
    ceo: [
      {
        kind: "meeting",
        title: "Board sync · Q2 update",
        body: "Board meeting. Focus: Series A progress, VP Eng hire, retention metrics. Agreement: any hire >$150k goes through me. Lead investor asked for cohort analysis for the June board meeting.",
        tags: ["board", "fundraising"],
      },
      {
        kind: "meeting",
        title: "1:1 with COO · ops review",
        body: "Discussed collections bottleneck, month close, and hiring plan. Decision: pause non-critical hires until the round closes. COO runs day-to-day; I focus on investors.",
        tags: ["ops", "fundraising"],
      },
      {
        kind: "meeting",
        title: "Customer call · enterprise pilot",
        body: "Call with enterprise prospect. Objections: SOC2, multi-region. Commitment: compliance roadmap in 60 days. Owner: VP Eng (once we have one).",
        tags: ["sales", "compliance"],
      },
      {
        kind: "meeting",
        title: "Strategy off-site · brief",
        body: "Off-site with c-suite. North star: NRR >120% before Series B. Bets for the next 6 months: enterprise tier, LatAm expansion, AI feature. Nothing ships without an associated retention metric.",
        tags: ["strategy"],
      },
    ],
    founder: [
      {
        kind: "meeting",
        title: "Investor update · monthly",
        body: "Monthly investor update. Metrics: MRR +18%, churn 3.2%, runway 14m. Priority for the month: close 3 strategic partnerships.",
        tags: ["investors"],
      },
      {
        kind: "meeting",
        title: "Co-founder sync",
        body: "Weekly sync. Decided: no fundraise until we have product-market fit in the enterprise segment. Ana leads GTM, I run product/tech.",
        tags: ["cofounder"],
      },
      {
        kind: "meeting",
        title: "Customer interview #14",
        body: "Enterprise customer. Main pain point: integration with their ERP. Asked for API webhooks. Promised a prototype in 3 weeks.",
        tags: ["customer", "research"],
      },
      {
        kind: "meeting",
        title: "Hiring loop · Designer",
        body: "Hiring loop for senior designer. Agreement: candidate must pass a design system take-home. We don't lower the bar.",
        tags: ["hiring"],
      },
    ],
    pm: [
      {
        kind: "meeting",
        title: "Discovery · checkout v2",
        body: "Discovery session with 5 users. Finding: 80% drop off at step 3 due to confusion around payment methods. Decision: simplify to 2 steps. Figma prototype ready for review on Friday.",
        tags: ["discovery", "checkout"],
      },
      {
        kind: "meeting",
        title: "Sprint planning · Payments squad",
        body: "Sprint planning. Capacity 28 points. Top stories: PAY-1234 fraud rules, PAY-1240 webhook v2, PAY-1255 refund UI. Blocker: we depend on the auth team for JWT renewal.",
        tags: ["sprint", "payments"],
      },
      {
        kind: "meeting",
        title: "Design crit · refunds flow",
        body: "Crit with design lead. Approved the new refunds flow. Commitment: A/B test before full rollout. Agreed not to ship without prior user research.",
        tags: ["design", "refunds"],
      },
      {
        kind: "meeting",
        title: "Stakeholder sync · sales feedback",
        body: "Sales reported top 3 requested features: bulk invoicing, custom roles, audit log. Owner: I prioritize, eng lead estimates next week.",
        tags: ["sales", "roadmap"],
      },
    ],
    designer: [
      {
        kind: "meeting",
        title: "Design system review",
        body: "Weekly DS review. Approved: new Button variant (ghost-amber), Tooltip update, deprecation of legacy IconButton. Rule: every new component goes through design system review.",
        tags: ["design-system"],
      },
      {
        kind: "meeting",
        title: "Onboarding redesign · crit 2",
        body: "Onboarding v2 crit. Feedback: the connect-sources step needs more visual hierarchy. Iterate and show on Friday. PM asked to keep AA contrast minimum.",
        tags: ["onboarding", "crit"],
      },
      {
        kind: "meeting",
        title: "Customer call · UX feedback",
        body: "Call with 3 power users. Pain: they can't find advanced settings. Proposal: settings shell with tabs. Eng lead validated feasibility.",
        tags: ["research"],
      },
      {
        kind: "meeting",
        title: "1:1 with design manager",
        body: "Biweekly 1:1. Career growth: target promo Q3, focus on DS ownership. Agreement: lead the admin dashboards redesign.",
        tags: ["1on1"],
      },
    ],
    engineer: [
      {
        kind: "meeting",
        title: "Architecture sync · payments",
        body: "Discussion of Postgres 16 migration. Risks: pg_partman extension changes behavior. Action: Ana runs benchmarks on staging. Rule: we don't mock the DB in tests, everything runs against real Postgres.",
        tags: ["architecture", "postgres"],
      },
      {
        kind: "meeting",
        title: "On-call retro",
        body: "On-call retro. Main incident: webhook backlog from a race condition in the idempotency key. Fix shipped. Agreed: add an ADR on the idempotency pattern.",
        tags: ["oncall", "retro"],
      },
      {
        kind: "meeting",
        title: "Sprint planning · Platform",
        body: "Sprint planning. Top items: refactor auth middleware, payments-api migration to strict TS, CI flaky tests. Capacity 24 points.",
        tags: ["sprint"],
      },
      {
        kind: "meeting",
        title: "1:1 with tech lead",
        body: "1:1 with Ana. Approved the auth migration plan. Reminder: large PRs land on Wednesdays so they're ready before the Friday freeze.",
        tags: ["1on1"],
      },
    ],
    other: [
      {
        kind: "meeting",
        title: "Weekly meeting",
        body: "Team general sync. Discussed priorities, blockers, and next steps. Agreements still pending documentation.",
        tags: ["weekly"],
      },
      {
        kind: "meeting",
        title: "1:1 with manager",
        body: "Biweekly 1:1. Positive feedback on recent deliverables. Q2 growth plan: take more ownership of cross-team initiatives.",
        tags: ["1on1"],
      },
    ],
  };
}

function linearSeeds(): Record<Role, SourceItem[]> {
  const empty: SourceItem[] = [];
  return {
    ceo: empty,
    founder: [
      {
        kind: "ticket",
        title: "ACME-12 · Roadmap Q2",
        body: "Tracking Q2 initiatives: enterprise tier, LatAm expansion, AI feature. Owner: founder. Status: in-progress.",
        ref: "ACME-12",
        tags: ["roadmap"],
      },
      {
        kind: "ticket",
        title: "ACME-18 · Hiring senior designer",
        body: "Hiring loop active. Stage: 2 finalists. Decision by founder.",
        ref: "ACME-18",
        tags: ["hiring"],
      },
    ],
    pm: [
      {
        kind: "ticket",
        title: "PAY-1234 · Fraud rules engine",
        body: "Fraud rules engine. Rules configurable per merchant. Blocked on: final design of the config UI. Owner: PM (me).",
        ref: "PAY-1234",
        tags: ["payments", "fraud"],
      },
      {
        kind: "ticket",
        title: "PAY-1240 · Webhook v2",
        body: "Migration to webhook v2 with retry policy and signed payloads. In progress. Owner: eng lead.",
        ref: "PAY-1240",
        tags: ["payments", "infra"],
      },
      {
        kind: "ticket",
        title: "PAY-1255 · Refund UI",
        body: "New refunds UI. Awaiting design crit approval.",
        ref: "PAY-1255",
        tags: ["payments", "ui"],
      },
      {
        kind: "ticket",
        title: "PAY-1290 · Bulk invoicing",
        body: "Requested by sales. Discovery in progress. Decision: ship MVP in 4 weeks if user research validates it.",
        ref: "PAY-1290",
        tags: ["payments", "sales-driven"],
      },
    ],
    designer: [
      {
        kind: "ticket",
        title: "DS-42 · Button ghost-amber",
        body: "New Button variant. Tokens defined, still need to document usage in Storybook.",
        ref: "DS-42",
        tags: ["design-system"],
      },
      {
        kind: "ticket",
        title: "ONB-7 · Onboarding v2",
        body: "Full onboarding redesign. Iteration 2. Next crit: Friday.",
        ref: "ONB-7",
        tags: ["onboarding"],
      },
      {
        kind: "ticket",
        title: "DASH-3 · Admin dashboards",
        body: "Admin dashboards redesign. Owner: me. Eng partner: tbd.",
        ref: "DASH-3",
        tags: ["dashboards"],
      },
    ],
    engineer: [
      {
        kind: "ticket",
        title: "PLAT-201 · Postgres 16 migration",
        body: "Migration from Postgres 14 to 16. Risk: pg_partman behavior change. Plan: benchmarks on staging, blue-green deploy.",
        ref: "PLAT-201",
        tags: ["infra", "db"],
      },
      {
        kind: "ticket",
        title: "PLAT-218 · Auth middleware refactor",
        body: "Auth middleware refactor. Reason: legal/compliance flagged session token storage. This is NOT a technical debt cleanup; it's compliance.",
        ref: "PLAT-218",
        tags: ["auth", "compliance"],
      },
      {
        kind: "ticket",
        title: "PLAT-225 · CI flaky tests",
        body: "Flaky tests in CI. Suspected: race condition in fixture setup. Owner: me.",
        ref: "PLAT-225",
        tags: ["ci", "tests"],
      },
      {
        kind: "ticket",
        title: "PAY-1240 · Webhook v2 (eng impl)",
        body: "Webhook v2 implementation. Blocked on retry policy design. Waiting for input from tech lead.",
        ref: "PAY-1240",
        tags: ["payments", "webhook"],
      },
    ],
    other: empty,
  };
}

function jiraSeeds(): Record<Role, SourceItem[]> {
  return {
    ceo: [],
    founder: [],
    pm: [
      {
        kind: "ticket",
        title: "EPIC-44 · Checkout v2",
        body: "Checkout v2 epic. 12 stories. Status: 60% complete.",
        ref: "EPIC-44",
        tags: ["epic", "checkout"],
      },
      {
        kind: "ticket",
        title: "BUG-998 · Tax calculation edge case",
        body: "Bug reported by enterprise customer. VAT calculation on split-payments incorrect in certain countries.",
        ref: "BUG-998",
        tags: ["bug", "tax"],
      },
    ],
    designer: [],
    engineer: [
      {
        kind: "ticket",
        title: "INFRA-512 · Migrate to Bun",
        body: "Spike: evaluate migrating workers from Node to Bun. Owner: me. Result: ADR pending.",
        ref: "INFRA-512",
        tags: ["infra", "spike"],
      },
    ],
    other: [],
  };
}

// ── Synthesis ───────────────────────────────────────────────────────────
//
// Feed Opus the role + all gathered items, ask for a structured profile
// JSON. Stream extended thinking for the cinema. Best-effort: if parsing
// fails, we still hand back what we got from explicit user inputs (role,
// connected sources) and let questions fill the rest.

type SynthResult = {
  patch: Partial<BrainProfile>;
  confidence: BrainProfile["confidence"];
};

async function synthesizeProfile(args: {
  role: Role;
  roleLabel: string;
  items: SourceItem[];
  lang: "es" | "en";
  send: (ev: OnboardEvent) => void;
}): Promise<SynthResult> {
  const { role, roleLabel, items, lang, send } = args;
  const current = await loadProfile();
  const baseConfidence = { ...current.confidence };

  if (items.length === 0) {
    return { patch: {}, confidence: baseConfidence };
  }

  const corpus = items
    .map((i, idx) => {
      const head = `[${idx + 1}] ${i.kind} · ${i.title}`;
      return `${head}\n${i.body}${i.tags ? `\ntags: ${i.tags.join(", ")}` : ""}`;
    })
    .join("\n\n");

  const system = `You are Mesh, a poly-repo governance assistant building a personal profile for the user that gets injected as context into every future plan.

The user is: ${roleLabel} (role=${role}).
Response language: ${lang === "es" ? "Spanish" : "English"}.

You'll receive a corpus of signals (meetings, tickets, notes) that the user imported from their sources (Granola, Linear, Jira, GitHub). Your job is to distill a compact JSON profile from it across six dimensions. DO NOT invent — if there's no evidence for a dimension, return it empty.

Output: emit ONLY valid JSON after your reasoning, no markdown fences.

Expected schema:
{
  "who": { "name"?: string, "company"?: string, "team"?: string, "bio"?: string },
  "focus": { "summary"?: string, "areas": string[], "activeInitiatives": Array<{title: string, note?: string}> },
  "decisions": { "rules": Array<{rule: string, why?: string}> },
  "people": { "stakeholders": string[], "reviewers": string[], "escalation"?: string },
  "sources": { "lives"?: string },
  "comms": { "style"?: "terse"|"detailed"|"balanced", "lang"?: "es"|"en", "format"?: string },
  "confidence": { "who": 0..1, "focus": 0..1, "decisions": 0..1, "people": 0..1, "sources": 0..1, "comms": 0..1 }
}

Rules:
- Be specific. "Launching checkout v2" > "working on product".
- For "decisions", extract hard rules (what the user explicitly said "always" / "never" / "nothing ships without"). This is the most valuable signal.
- If a dimension has insufficient evidence, leave it empty and set its confidence to 0.2 or less.
- "comms" is rarely inferable from signals; if there's no hint, leave it empty with confidence 0.
- "sources" — only if the user explicitly mentions tools / channels in the meetings.`;

  const userPrompt = `Corpus (${items.length} signals):\n\n${corpus}\n\n---\n\nDistill the profile. Reason first (what dominant themes you see, what hard rules show up, who is central) and then emit the JSON.`;

  const engine = getEngine("raw");
  let textBuf = "";
  let thinkingBuf = "";

  for await (const ev of engine.run({
    prompt: userPrompt,
    system,
    cacheSystem: false,
    wrapThinking: true,
  })) {
    if (ev.type === "thinking") {
      thinkingBuf += ev.delta;
      send({ type: "thinking", delta: ev.delta });
    } else if (ev.type === "text") {
      textBuf += ev.delta;
      send({ type: "text", delta: ev.delta });
    } else if (ev.type === "meta") {
      send({ type: "meta", ttft_ms: ev.ttft_ms });
    } else if (ev.type === "error") {
      // Soft-fail — propagate as a single error event, then stop synth.
      send({ type: "error", message: ev.message });
      return { patch: {}, confidence: baseConfidence };
    }
  }

  // Best-effort JSON extraction. Opus may wrap in fences despite instruction;
  // strip them and grab the largest balanced object.
  const raw = extractJson(textBuf);
  if (!raw) {
    return { patch: {}, confidence: baseConfidence };
  }
  // Normalize to a loose shape so the destructuring below typechecks.
  const json = raw as {
    who?: { name?: string; company?: string; team?: string; bio?: string };
    focus?: {
      summary?: unknown;
      areas?: unknown;
      activeInitiatives?: unknown;
    };
    decisions?: { rules?: unknown };
    people?: { stakeholders?: unknown; reviewers?: unknown; escalation?: unknown };
    sources?: { lives?: unknown };
    comms?: { style?: unknown; lang?: unknown; format?: unknown };
    confidence?: Partial<Record<ProfileDimension, unknown>>;
  };

  const patch: Partial<BrainProfile> = {};
  const userProv = {
    source: "synthesized" as const,
    at: new Date().toISOString(),
    count: items.length,
  };

  if (json.who && typeof json.who === "object") {
    patch.who = {
      ...current.who,
      ...pick(json.who, ["name", "company", "team", "bio"]),
      role,
      roleLabel,
      provenance: [...(current.who?.provenance ?? []), userProv],
    };
  }
  if (json.focus && typeof json.focus === "object") {
    patch.focus = {
      summary: stringOr(json.focus.summary),
      areas: arrayOfStrings(json.focus.areas),
      activeInitiatives: arrayOfInitiatives(json.focus.activeInitiatives),
      provenance: [...(current.focus?.provenance ?? []), userProv],
    };
  }
  if (json.decisions && typeof json.decisions === "object") {
    const rules = Array.isArray(json.decisions.rules)
      ? json.decisions.rules
          .map((r: unknown) => {
            if (typeof r === "string") return { rule: r, source: userProv };
            if (r && typeof r === "object") {
              const o = r as { rule?: string; why?: string };
              return o.rule
                ? { rule: o.rule, why: o.why, source: userProv }
                : null;
            }
            return null;
          })
          .filter((x): x is { rule: string; why?: string; source: typeof userProv } => x !== null)
      : [];
    patch.decisions = {
      rules: [...(current.decisions?.rules ?? []), ...rules],
      provenance: [...(current.decisions?.provenance ?? []), userProv],
    };
  }
  if (json.people && typeof json.people === "object") {
    patch.people = {
      stakeholders: arrayOfStrings(json.people.stakeholders),
      reviewers: arrayOfStrings(json.people.reviewers),
      escalation: stringOr(json.people.escalation),
      provenance: [...(current.people?.provenance ?? []), userProv],
    };
  }
  if (json.sources && typeof json.sources === "object") {
    patch.sources = {
      connected: current.sources?.connected ?? [],
      preferred: current.sources?.preferred ?? [],
      lives: stringOr(json.sources.lives),
      provenance: [...(current.sources?.provenance ?? []), userProv],
    };
  }
  if (json.comms && typeof json.comms === "object") {
    const styleRaw = json.comms.style;
    const langRaw = json.comms.lang;
    patch.comms = {
      ...current.comms,
      style:
        styleRaw === "terse" || styleRaw === "detailed" || styleRaw === "balanced"
          ? styleRaw
          : current.comms?.style,
      lang: langRaw === "es" || langRaw === "en" ? langRaw : current.comms?.lang ?? lang,
      format: stringOr(json.comms.format),
      provenance: [...(current.comms?.provenance ?? []), userProv],
    };
  }

  const c = json.confidence ?? {};
  const confidence: BrainProfile["confidence"] = {
    who: clamp01(c.who, baseConfidence.who),
    focus: clamp01(c.focus, baseConfidence.focus),
    decisions: clamp01(c.decisions, baseConfidence.decisions),
    people: clamp01(c.people, baseConfidence.people),
    sources: clamp01(c.sources, baseConfidence.sources),
    comms: clamp01(c.comms, baseConfidence.comms),
  };

  return { patch, confidence };
}

// ── Small helpers ───────────────────────────────────────────────────────

function pick<T extends Record<string, unknown>, K extends keyof T>(
  obj: T,
  keys: K[],
): Partial<T> {
  const out: Partial<T> = {};
  for (const k of keys) if (typeof obj[k] === "string") out[k] = obj[k];
  return out;
}

function stringOr(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v : undefined;
}

function arrayOfStrings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];
}

function arrayOfInitiatives(
  v: unknown,
): Array<{ title: string; note?: string }> {
  if (!Array.isArray(v)) return [];
  return v
    .map((it) => {
      if (typeof it === "string") return { title: it };
      if (it && typeof it === "object") {
        const o = it as { title?: string; note?: string };
        return o.title ? { title: o.title, note: o.note } : null;
      }
      return null;
    })
    .filter((x): x is { title: string; note?: string } => x !== null);
}

function clamp01(v: unknown, fallback: number): number {
  if (typeof v !== "number" || Number.isNaN(v)) return fallback;
  return Math.max(0, Math.min(1, v));
}

function extractJson(text: string): Record<string, unknown> | null {
  const stripped = text
    .replace(/```json\s*/gi, "")
    .replace(/```\s*$/g, "")
    .trim();
  // Find first balanced object. Tolerate trailing prose.
  const start = stripped.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < stripped.length; i++) {
    const c = stripped[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        const slice = stripped.slice(start, i + 1);
        try {
          return JSON.parse(slice);
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

// Suppress unused-import lint for DEFAULT_MODEL — kept around for future
// usage when we wire the agent SDK path with explicit model overrides.
void DEFAULT_MODEL;
void listIntegrations;
