---
name: single-source-pricing
description: All monetary arithmetic must live in src/services/billing.ts. Routes, middleware, UI, and other services must not compute prices inline.
allowed-tools:
  - Read
  - Grep
paths:
  - "flarebill-api/**/*.ts"
  - "flarebill-web/**/*.ts"
  - "flarebill-web/**/*.tsx"
disable-model-invocation: false
---

# single-source-pricing

Pricing arithmetic (discounts, tiers, referral bonuses, tax) is computed in
exactly one place: `flarebill-api/src/services/billing.ts`. Every other
surface — HTTP routes, middleware, the web app, analytics — must call into
that service instead of reimplementing the math.

## When this skill fires

A diff touches a file outside `services/billing.ts` and:

- introduces arithmetic on a price-like field (`amount`, `price`, `total`,
  `cents`, `discount`, `fee`),
- or reads a tier configuration (`plans.json`, `PRICING`) and multiplies or
  subtracts from it,
- or imports `decimal.js`, `big.js` in a file that is not `billing.ts`.

## What to do on violation

Refactor so the caller invokes a named function in `services/billing.ts`
(e.g. `calculateFirstCharge`, `calculateRecurringCharge`). If no such
function exists, add one to `billing.ts` and call it — keep the math in the
same module.

## Reference

- `flarebill-api/docs/decisions/0001-pricing-single-source.md`
