# Roadmap: Mesh

## Overview

Mesh es una capa de gobernanza poly-repo sobre Claude Opus 4.7 que convierte tickets en PRs coordinados a través de múltiples repos, respetando invariants y patrones del código. El roadmap cubre la trayectoria del producto después del MVP del hackathon (v0.4): convertir a Mesh de orquestador técnico a *codebase viva* para perfiles no-técnicos, con entendimiento por repo, razonamiento multi-rol y skills que guían el código desde el primer token.

## Current Milestone

**v0.5 — Codebase viva** (v0.5)
Status: In progress
Phases: 0 of 6 complete

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with [INSERTED])

Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6

| Phase | Name | Plans | Status | Completed |
|-------|------|-------|--------|-----------|
| 1 | Ficha por repo (RepoBrief) | 3 | Not started | - |
| 2 | Home dashboard | 2 | Not started | - |
| 3 | Skills con kind (invariant/pattern/knowledge) | 4 | Not started | - |
| 4 | Agentes pre-creados + master dispatch dinámico | 5 | Not started | - |
| 5 | Limpieza UI (ContextFooter) | 1 | Not started | - |
| 6 | Run guiado en Connect (raise repo locally) | 4 | Not started | - |

## Phase Details

### Phase 1: Ficha por repo (RepoBrief)

**Goal:** Al terminar Connect, cada repo tiene una ficha legible (purpose, stack, entry points, data model, key modules, cross-repo role) accesible desde `/repos/<name>`. Esto convierte Mesh en un lugar donde el usuario puede *leer* su código, no solo orquestarlo.
**Depends on:** Nothing (primera fase del milestone)
**Research:** Unlikely (reusa engine + ingest existentes)

**Scope:**
- Generación por repo durante Connect (paralela al extract de invariants)
- Persistencia dual: `.mesh/repos/<name>/BRIEF.md` human-readable + campo `brief` en `memory.json` para consumo estructurado
- Ruta `/repos/[name]` nueva con tab Overview + Env vars
- Link desde Connect y desde `/repos` grid

**Plans:**
- [ ] 01-01: `lib/repo-brief.ts` + prompt `buildRepoBriefSystem` + evento SSE `repo-brief` en `/api/connect`
- [ ] 01-02: Schema `RepoBrief` en `lib/memory.ts` + `get/setRepoBrief` en `lib/mesh-state.ts` + render markdown
- [ ] 01-03: `/repos/[name]/page.tsx` con tabs + cards clickeables en `/repos/page.tsx`

### Phase 2: Home dashboard

**Goal:** La ruta `/` muestra status vivo del proyecto (repos conectados, invariants, flows, última sesión) arriba de los capability cards. Un solo sitio que sirve de launchpad y de resumen del estado actual.
**Depends on:** Phase 1 (consume el count de briefs/invariants/flows de memory.json)
**Research:** Unlikely

**Scope:**
- Status rail: 4 cards vivas con links a `/repos`, `/skills`, `/build`, última actividad
- Capability cards actuales intactas debajo
- Item `Home` en sidebar NAV (primer item)

**Plans:**
- [ ] 02-01: Refactor `mesh/app/page.tsx` con status rail + cards existentes
- [ ] 02-02: Añadir `Home` a NAV en `mesh/components/mesh/sidebar.tsx` (+ icono si falta)

### Phase 3: Skills con kind (invariant/pattern/knowledge)

**Goal:** Los skills dejan de ser solo prohibiciones. Se clasifican en 3 tipos y alimentan a Build desde el razonamiento, no como filtro posterior en Ship. El código ya nace respetando el design system, los patrones de DB, los invariants de pricing.
**Depends on:** Phase 2 (no bloqueante, pero Skills se ven en el Home rail)
**Research:** Unlikely

**Scope:**
- Campo opcional `kind: invariant | pattern | knowledge` en frontmatter (default `invariant`)
- `lib/skills-context.ts` para inyectar skills filtrados por paths/kinds al system prompt de sub-agentes
- `skill-runner` filtra solo `kind=invariant` (pattern/knowledge nunca corren regex)
- UI `/skills`: filtro por kind, badges coloreados, selector en editor
- Seed: `mesh-design-tokens` (pattern). El seed `flarebill-stack` (knowledge) era demo del dataset sintético y se removió para el alpha.

**Plans:**
- [ ] 03-01: Extender parser de skills con campo `kind` + migración backwards-compat
- [ ] 03-02: `lib/skills-context.ts` con `buildSkillsContext({ repos, paths, kinds })`
- [ ] 03-03: Filtrado en `skill-runner.ts` + UI filtro/badges/editor en `mesh/app/skills/page.tsx`
- [ ] 03-04: Crear 2 seed skills de ejemplo

### Phase 4: Agentes pre-creados + master dispatch dinámico

**Goal:** Build deja de ser 1 engine → 1 plan. El master recibe el ticket y decide dinámicamente qué agentes desplegar (frontend, backend, product, qa) con rationale visible. Los sub-agentes razonan con skills como contexto y producen un plan coordinado.
**Depends on:** Phase 3 (los sub-agentes consumen `buildSkillsContext`)
**Research:** Likely (validar cómo inyectar system prompts de agentes al engine existente sin reescribirlo)
**Research topics:** Estrategia de streaming paralelo multi-engine; formato de recolección de outputs del master

**Scope:**
- 4 archivos `.claude/agents/{frontend,backend,product,qa}.md` con frontmatter estilo skills
- `lib/agents.ts` con `loadAgents` + `renderAgentRoster`
- `/api/plan`: master dispatch → JSON `{agents_to_deploy, rationale, instructions_per_agent}` → ejecución paralela
- Eventos SSE: `dispatch`, `agent-start`, `agent-thinking`, `agent-done`
- UI Build: multi-agent panel (columnas por agente desplegado) + rationale visible arriba
- Tab `Agents` en `/skills` (reusa editor)

**Plans:**
- [ ] 04-01: Crear los 4 archivos de agentes con system prompts por rol
- [ ] 04-02: `lib/agents.ts` + `buildMasterDispatchSystem` prompt
- [ ] 04-03: Refactor `/api/plan/route.ts` con dispatch + paralelización
- [ ] 04-04: UI multi-agent en `mesh/app/build/page.tsx`
- [ ] 04-05: Tab `Agents` en `/skills` page

### Phase 5: Limpieza UI (ContextFooter)

**Goal:** El sidebar queda limpio. Los botones manuales de compact/reset y el recuadro de uso de contexto se eliminan — esas decisiones corresponden a la sesión de Claude, no al usuario.
**Depends on:** Nothing (se puede hacer en paralelo, pero se deja al final para no reintroducir desde otras fases)
**Research:** Unlikely

**Scope:**
- Borrar `ContextFooter` + helpers asociados de `mesh/components/mesh/sidebar.tsx`
- Endpoint `/api/session/archive` queda deferred (no se borra por si se reusa luego)

**Plans:**
- [ ] 05-01: Eliminar `ContextFooter` + `STATE_COLOR`/`STATE_COPY`/`formatK`/`formatSignedK` + `useSessionUsage` si es huérfano

### Phase 6: Run guiado en Connect (raise repo locally)

**Goal:** Después de conectar un repo, Mesh guía al usuario a levantarlo localmente con un click. Detecta el script de arranque, qué env vars necesita, hints de federation/monorepo, y arranca el proceso reusando `lib/preview-server.ts`. El usuario pasa de "tengo el código clonado" a "tengo el servicio corriendo en `localhost:3xxx`" sin abrir terminal.
**Depends on:** Phase 1 (idealmente la ficha de repo ya está, pero puede empezar antes — el panel se inserta en `/repos/<name>`)
**Research:** Unlikely (la infra de preview-server ya existe, falta detección + UI)

**Scope:**
- `lib/repo-runner.ts`: detector que lee `package.json` (scripts + packageManager), `.env.example` (reusa `lib/env-detect.ts`), `module-federation.config.{js,ts}`, `nx.json`/`turbo.json`/`lerna.json`, `docker-compose.{yml,yaml}`, README hints. Output: `RepoRunPlan { script, packageManager, envRequired, federationHints[], dockerCompose?, port? }`.
- `/api/preview/plan`: endpoint que devuelve el `RepoRunPlan` para un repo registrado.
- `/api/preview/start` extendido: `ticket_id` opcional; si falta, sintetiza `run-${repo}` para sesión "run-only" sin amarrar a un ticket.
- UI nueva en `/repos/[name]/page.tsx`: panel "Run locally" con script detectado, formulario de env vars faltantes (persistidas via `setRepoEnv`), avisos de federation hints (no resuelve cross-repo en esta fase, solo informa), botón "Start" que arranca y muestra log tail + URL ready.
- Federation hints son **informativos**: "veo `module-federation.config.js` apuntando a `host:3001` — eso parece otro repo, levántalo aparte". Trampolín a Phase 7+ (orquestación cross-repo).

**Plans:**
- [ ] 06-01: `lib/repo-runner.ts` con detection + tests manuales contra `simetrik-inc/fc-frontend`
- [ ] 06-02: `/api/preview/plan/route.ts` que sirve el plan
- [ ] 06-03: Relajar `/api/preview/start` para aceptar sesiones run-only (sin `ticket_id`)
- [ ] 06-04: Panel "Run locally" en `/repos/[name]/page.tsx` con env form + Start + log tail

---

## Completed Milestones

<details>
<summary>v0.4 — Connect + Build + Ship MVP (Hackathon deadline 2026-04-26)</summary>

### Phase 0: Hackathon MVP
**Goal:** Demo de 3 min mostrando los 3 flujos (Connect ingest cross-repo → Build classify+plan → Ship con skill interception + PRs reales).

- [x] Connect: clone vía gh CLI, ingest con token budgeting, memoria cross-repo (invariants + flows + call graph)
- [x] Build: classifier + plan agent con thinking visible
- [x] Ship: ejecución con skills regex runner, branches + commits + PRs reales en GitHub
- [x] Skills editor con AI improver
- [x] Motor configurable (raw SDK / agent SDK toggle)
- [x] Env vars por repo en `.mesh/repos/<name>/.env.json`

**Milestone archive:** Ver `ROADMAP.md` de la raíz (plan de 5 días del hackathon).

</details>

---

*Roadmap created: 2026-04-23*
*Last updated: 2026-04-23*
