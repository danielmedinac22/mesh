---
name: cross-repo-router
description: When a change touches one Flarebill repo, check the cross-repo flows in mesh memory and flag other repos that must change together.
allowed-tools:
  - Read
  - Grep
paths:
  - "**/*"
disable-model-invocation: false
---

# cross-repo-router

Flarebill flows (checkout, refunds, tier upgrades) cross multiple repos.
A change to an event emitted in `flarebill-api` usually needs a matching
update in `flarebill-analytics` (schema) and `flarebill-content` (strings
shown to the user). This skill enforces that a single-repo diff is not a
coherent landing unit for a cross-repo flow.

## When this skill fires

Any diff that:

- adds, renames, or changes the shape of an event in `flarebill-api` or
  `flarebill-analytics` (look for `track(`, `emit(`, `Event.` usages,
  `events/*.ts` schemas),
- changes a price or tier label in `flarebill-api` without also updating
  `flarebill-content`'s `pricing-en.json` or `checkout-en.json`.

## What to do on violation

Block. Ask the plan agent to expand the plan to include the matching
repo(s). Reference the cross-repo flow id from memory (e.g.
`checkout-flow`, `refund-flow`) and name the specific file that must
change alongside.
