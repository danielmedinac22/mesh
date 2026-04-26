import type {
  ProfileDimension,
  Role,
} from "./user-brain";

// Maps each user role to the sources we offer in the empty state, and to
// the question copy used for gap-fill across the 6 profile dimensions.
// The synthesizer (api/brain/onboard) consumes this to (a) decide which
// connect cards to render, and (b) pick the prompt template used when
// asking the user to fill a low-confidence dimension.

export type SourceKind = "granola" | "linear" | "jira" | "github" | "notion" | "figma";

export type RolePlaybook = {
  id: Role;
  label: string;
  pitch: string;
  sources: {
    primary: SourceKind[];
    placeholder: SourceKind[];
  };
  questions: Record<ProfileDimension, { prompt: string; hint: string }>;
};

const PLAYBOOKS: Record<Role, RolePlaybook> = {
  ceo: {
    id: "ceo",
    label: "CEO / Founder",
    pitch:
      "Mesh learns how you decide, what keeps you up at night, and who you operate with. Imports from your meetings + a few short questions, 3 min.",
    sources: {
      primary: ["granola"],
      placeholder: ["notion"],
    },
    questions: {
      who: {
        prompt: "How do you introduce yourself in one sentence? (role, company, stage)",
        hint: "e.g. Founder/CEO of Acme, team of 12, post-seed.",
      },
      focus: {
        prompt: "What's keeping you up this quarter? Top 1-3.",
        hint: "e.g. Closing Series A, hiring VP Eng, launching product v2.",
      },
      decisions: {
        prompt: "Which decisions always go through you? What hard rules do you have?",
        hint: "e.g. 'Senior hires >$150k go through me', 'no soft-launch without retention metrics'.",
      },
      people: {
        prompt: "Who are your key stakeholders and who do you escalate a blocker to?",
        hint: "e.g. Board, lead investor, COO. Escalation: chairman.",
      },
      sources: {
        prompt: "Where does the context Mesh should read live? Granola, email, Notion, Slack…",
        hint: "Mark the ones you use most — Mesh will prioritize them when pulling context.",
      },
      comms: {
        prompt: "How do you want Mesh to talk to you, and where should decisions get logged?",
        hint: "e.g. 'terse, bullets, in English. Decisions to Notion + Slack #leadership'.",
      },
    },
  },
  founder: {
    id: "founder",
    label: "Founder",
    pitch:
      "Mesh learns how you build and decide. Connect your meetings, I ask you the gaps. 3 minutes.",
    sources: {
      primary: ["granola", "linear"],
      placeholder: ["notion"],
    },
    questions: {
      who: {
        prompt: "Who are you and what are you building?",
        hint: "e.g. Technical founder of Acme. Treasury SaaS for LatAm.",
      },
      focus: {
        prompt: "What are you focused on for the next 4-6 weeks?",
        hint: "e.g. New onboarding flow + 2 partnerships + hiring a designer.",
      },
      decisions: {
        prompt: "What rules does the product / team have that don't get broken?",
        hint: "e.g. 'Nothing ships without testing with 5 real users', 'no open fundraise'.",
      },
      people: {
        prompt: "Co-founders, first hires, key advisors?",
        hint: "Names + brief role.",
      },
      sources: {
        prompt: "Where does your context live? (Granola, Linear, Notion, email…)",
        hint: "Whatever you turn on here, Mesh will read before proposing anything.",
      },
      comms: {
        prompt: "Preferred style and language for Mesh to respond?",
        hint: "e.g. 'direct, in English, decisions logged as Linear issues tagged decision'.",
      },
    },
  },
  pm: {
    id: "pm",
    label: "Product Manager",
    pitch:
      "Mesh understands which area you own, how you decide what to ship, and who you consult. Connect your tickets + meetings.",
    sources: {
      primary: ["granola", "linear", "jira"],
      placeholder: ["figma", "notion"],
    },
    questions: {
      who: {
        prompt: "What's your product area and seniority?",
        hint: "e.g. Senior PM in checkout/payments, team of 6.",
      },
      focus: {
        prompt: "Which initiatives are you leading right now?",
        hint: "e.g. Checkout v2, fraud rules, pricing A/B.",
      },
      decisions: {
        prompt: "What processes do you NOT skip before shipping?",
        hint: "e.g. 'Nothing without prior user research', 'PRD approved by design lead', 'flag-gating mandatory'.",
      },
      people: {
        prompt: "Your closest peers: design, eng, sales/ops?",
        hint: "Names + what they do — Mesh pings them when it detects relevant changes.",
      },
      sources: {
        prompt: "Where does the product context live?",
        hint: "Figma, Linear, Granola customer calls, dashboards…",
      },
      comms: {
        prompt: "Preferred format — long specs, bullets, decisions?",
        hint: "e.g. 'Detailed specs in Notion. Terse updates in Slack. Decisions logged in Linear'.",
      },
    },
  },
  designer: {
    id: "designer",
    label: "Product Designer",
    pitch:
      "Mesh learns which flows you design, what guidelines you follow, and who you iterate with. Connect what you use most.",
    sources: {
      primary: ["granola", "linear"],
      placeholder: ["figma"],
    },
    questions: {
      who: {
        prompt: "Your role and design focus?",
        hint: "e.g. Senior product designer · web app · design system maintainer.",
      },
      focus: {
        prompt: "Which projects / flows do you have active?",
        hint: "e.g. Onboarding redesign, icon system v2, admin dashboards.",
      },
      decisions: {
        prompt: "Hard design rules that don't get broken?",
        hint: "e.g. 'every new component goes through design system review', 'minimum AA contrast'.",
      },
      people: {
        prompt: "Who do you iterate with daily and who do you escalate decisions to?",
        hint: "PM pair, eng lead, design manager.",
      },
      sources: {
        prompt: "Where does the design context live?",
        hint: "Figma, Linear/Jira for tickets, Granola for crit sessions and customer calls.",
      },
      comms: {
        prompt: "How do you like to receive feedback / decisions?",
        hint: "e.g. 'comments in Figma; decisions in short Slack threads'.",
      },
    },
  },
  engineer: {
    id: "engineer",
    label: "Engineer",
    pitch:
      "Mesh learns which repos you own, your hard code rules, and who you ask for review. Connect GitHub + tickets.",
    sources: {
      primary: ["granola", "linear", "jira", "github"],
      placeholder: [],
    },
    questions: {
      who: {
        prompt: "Seniority, squad, and which repos feel like yours?",
        hint: "e.g. Senior eng · squad Platform · payments-api + ledger-worker.",
      },
      focus: {
        prompt: "What are you focused on this sprint / month?",
        hint: "e.g. Postgres 16 migration, auth refactor, on-call rotation.",
      },
      decisions: {
        prompt: "Hard rules in your code / infra that don't get broken?",
        hint: "e.g. 'no DB mocks in tests', 'every PR passes green CI', 'feature flags via GrowthBook'.",
      },
      people: {
        prompt: "Who reviews your PRs almost always, and who do you escalate to?",
        hint: "e.g. Tech lead Ana, on-call rotation #payments.",
      },
      sources: {
        prompt: "Where should Mesh pull technical context from?",
        hint: "GitHub, Linear/Jira, Granola for architecture syncs.",
      },
      comms: {
        prompt: "Style for PRs, comments, and technical decisions?",
        hint: "e.g. 'Terse in PRs. Comments in English. Technical decisions → ADR in repo'.",
      },
    },
  },
  other: {
    id: "other",
    label: "Other",
    pitch:
      "Tell me what you do and we'll connect what you use most. Mesh learns with you in 3 minutes.",
    sources: {
      primary: ["granola"],
      placeholder: [],
    },
    questions: {
      who: {
        prompt: "What's your role and what do you do?",
        hint: "Be specific — company, team, area.",
      },
      focus: {
        prompt: "What are you focused on right now?",
        hint: "The 1-3 things that take up most of your time.",
      },
      decisions: {
        prompt: "What rules or principles do you always follow?",
        hint: "What you DON'T do, what you ALWAYS do.",
      },
      people: {
        prompt: "Who do you work with and who do you escalate to?",
        hint: "Close peers, manager, stakeholders.",
      },
      sources: {
        prompt: "Where does your work context live?",
        hint: "Apps you use daily.",
      },
      comms: {
        prompt: "How do you prefer Mesh to talk to you?",
        hint: "Style, language, where to log decisions.",
      },
    },
  },
};

export function getPlaybook(role: Role): RolePlaybook {
  return PLAYBOOKS[role] ?? PLAYBOOKS.other;
}

export function listPlaybooks(): RolePlaybook[] {
  return [
    PLAYBOOKS.ceo,
    PLAYBOOKS.pm,
    PLAYBOOKS.designer,
    PLAYBOOKS.engineer,
    PLAYBOOKS.founder,
    PLAYBOOKS.other,
  ];
}

export const SOURCE_META: Record<
  SourceKind,
  { label: string; tagline: string; live: boolean }
> = {
  granola: {
    label: "Granola",
    tagline: "Your latest meetings via MCP. Decisions, accountabilities, themes.",
    live: true,
  },
  linear: {
    label: "Linear",
    tagline: "Recent issues. Mesh detects active areas and patterns.",
    live: true,
  },
  jira: {
    label: "Jira",
    tagline: "Tickets and epics. Mesh extracts priorities and owners.",
    live: true,
  },
  github: {
    label: "GitHub",
    tagline: "Repos connected via gh. Mesh already reads them when planning changes.",
    live: true,
  },
  notion: {
    label: "Notion",
    tagline: "Strategy docs, OKRs, planning. Coming soon.",
    live: false,
  },
  figma: {
    label: "Figma",
    tagline: "Visual specs and design system. Coming soon.",
    live: false,
  },
};
