---
name: mesh-design-tokens
description: Mesh UI code must use the MESH.* tokens and existing primitives (AppShell, Pill, Dot, NavIcon). Never hand-roll new colors, borders, or layout shells.
kind: pattern
allowed-tools:
  - Read
  - Grep
paths:
  - "mesh/app/**/*.tsx"
  - "mesh/components/**/*.tsx"
disable-model-invocation: false
---

# mesh-design-tokens

All visual surfaces inside the Mesh app share a single token palette defined
in `mesh/components/mesh/tokens.ts` and mirrored as CSS variables in
`mesh/app/globals.css`. When you add or edit a UI, consume those tokens.

## How to apply

- Colors: import `MESH` and use `MESH.bg`, `MESH.bgElev`, `MESH.border`,
  `MESH.fg`, `MESH.fgDim`, `MESH.fgMute`, `MESH.amber`, `MESH.green`,
  `MESH.red`, `MESH.blue`, `MESH.purple`. Never paste raw hex values.
- Layout shell: wrap pages in `<AppShell title=… subtitle=… topRight=…>`.
  Do not build ad-hoc sidebars or headers.
- Primitives: `<Pill tone="amber|green|red|dim|default">`, `<Dot color={MESH.green} />`,
  `<NavIcon kind="connect|converse|ship|skills|home|branch|...">` — reuse
  before introducing new SVGs.
- Font: body is Inter by default; monospace via the `font-mono` class
  (JetBrains Mono). Don't set `fontFamily` inline.
- Accent is amber (`MESH.amber`, `#F5A524`). Success is `MESH.green`,
  destructive is `MESH.red`. Don't invent new meanings.

## Checklist before writing JSX

1. Can I reuse `AppShell` instead of writing my own `<main>` + header?
2. Can I reuse `<Pill>` / `<Dot>` / `<NavIcon>` instead of a div with styles?
3. Am I about to write a color value that isn't on `MESH.*`? If yes, stop
   and pick the nearest token.
4. If a new primitive seems necessary, add it to
   `mesh/components/mesh/` so it joins the system — don't fork inline.

## Reference

- Tokens: `mesh/components/mesh/tokens.ts`
- Primitives: `mesh/components/mesh/{app-shell,sidebar,topbar,pill,icons,thinking-panel}.tsx`
- CSS vars: `mesh/app/globals.css`
