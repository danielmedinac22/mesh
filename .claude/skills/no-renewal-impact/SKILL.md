---
name: no-renewal-impact
description: Changes to first-charge behavior must never modify the recurring-charge code path. The two paths share no discount helpers.
allowed-tools:
  - Read
  - Grep
paths:
  - "flarebill-api/src/services/billing.ts"
  - "flarebill-api/src/services/**/*.ts"
disable-model-invocation: false
---

# no-renewal-impact

Per ADR-0002, `calculateFirstCharge` and `calculateRecurringCharge` are
isolated. They do not share discount helpers, promo lookups, or tax
calculators. A change scoped to the "first charge" must not touch the
recurring path.

## When this skill fires

A diff modifies `calculateRecurringCharge`, any function it calls
transitively, or a helper used by it — while the intent (ticket or PR
title) only mentions first charge, signup, first payment, or initial
billing.

## What to do on violation

Move the logic into a helper that is only reachable from the first-charge
branch. If the helper genuinely needs to serve both, stop and ask the
human — crossing that boundary is an architectural decision, not a
refactor.

## Reference

- `flarebill-api/docs/decisions/0002-no-renewal-impact.md`
