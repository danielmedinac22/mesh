---
name: flarebill-stack
description: Flarebill's 4 repos — what stack each uses, where data lives, and how they communicate. Read this before planning any change that touches Flarebill.
kind: knowledge
allowed-tools:
  - Read
  - Grep
paths:
  - "flarebill-api/**/*"
  - "flarebill-web/**/*"
  - "flarebill-analytics/**/*"
  - "flarebill-content/**/*"
disable-model-invocation: false
---

# flarebill-stack

Flarebill is a synthetic SaaS billing product split across four repos. These
facts are stable — they change only via explicit architectural decisions
(ADRs under each repo's `docs/decisions/`).

## Repos

- **flarebill-api** — Node.js + TypeScript, Express-style routes under
  `src/routes/*.ts`. Billing math lives in `src/services/billing.ts`
  (single source of truth, see ADR-0001). Persists via Prisma to Postgres;
  schema in `prisma/schema.prisma`. All routes run through
  `withTenant()` middleware — tenant scope is never optional.
- **flarebill-web** — Next.js 14 App Router (pages under `app/`). Calls
  `flarebill-api` via a typed client in `lib/api.ts`. Never performs
  pricing math locally — always requests a quote (see skill
  `billing-through-service`). Styling is Tailwind; do not introduce CSS
  modules or a different UI library.
- **flarebill-analytics** — event consumer. Ingests events emitted by
  `flarebill-api` into a warehouse. Schemas live in `events/*.ts` —
  a change in `flarebill-api`'s emitted events requires a matching change
  here (see skill `cross-repo-router`).
- **flarebill-content** — copy and pricing labels. `pricing-en.json` and
  `checkout-en.json` hold the strings the UI renders. Price labels in
  `flarebill-api` must stay in sync with this repo's JSON files.

## Cross-repo flows

- **checkout-flow**: `flarebill-web` → `flarebill-api` (quote → charge) →
  `flarebill-analytics` (events) → `flarebill-content` (user-facing strings).
- **refund-flow**: `flarebill-api` owns; `flarebill-analytics` consumes
  the refund event; `flarebill-content` owns the receipt copy.
- **tier-upgrade**: `flarebill-web` triggers; `flarebill-api` computes;
  analytics + content both see the resulting strings/events.

## Constraints agents should assume

- Money is stored as integer cents (field names end in `Cents`).
- Discounts and tax are computed only inside `services/billing.ts`.
- First-charge logic is isolated from recurring-charge logic (ADR-0002).
- No repo ships without a matching update to `flarebill-analytics` when an
  event's shape changes.

## When planning a Flarebill change

1. Identify which flow the ticket touches (checkout / refund / tier-upgrade).
2. Open the repos that flow traverses — don't stop at the first one.
3. Check the corresponding invariant skills before writing code.
