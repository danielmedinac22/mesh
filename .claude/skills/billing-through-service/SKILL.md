---
name: billing-through-service
description: The web app and checkout UI never call billing math directly. They request a quote from the API, which is the single source of truth for amounts.
allowed-tools:
  - Read
  - Grep
paths:
  - "flarebill-web/**/*.ts"
  - "flarebill-web/**/*.tsx"
disable-model-invocation: false
---

# billing-through-service

Per ADR-0003, the web application (`flarebill-web`) never computes or
mutates money. It requests a quote from `flarebill-api` (e.g.
`POST /api/quote`) and renders whatever the API returns. If a price is
missing, render a skeleton — do not fall back to a local calculation.

## When this skill fires

A diff in `flarebill-web/**` performs numeric arithmetic on a field named
`amount`, `price`, `total`, `discount`, `cents`, or a field typed as
`Money` — or hardcodes a tier price (e.g. `49.00`, `19.99`).

## What to do on violation

Replace the local math with a call to the API's quote endpoint. If the
endpoint does not yet expose the needed shape, add a field to the quote
response in `flarebill-api` — do not duplicate the math.

## Reference

- `flarebill-api/docs/decisions/0003-billing-through-service.md`
