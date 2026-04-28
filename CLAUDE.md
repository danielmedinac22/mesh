# CLAUDE.md — Mesh

> Guía operativa para Claude (Code) trabajando sobre este fork de Mesh.
> Lee esto antes de tocar el repo. Se mantiene corto a propósito; cuando una sección no aplique, sáltala.

## 1. Qué es Mesh (resumen funcional)

Mesh es una capa de gobernanza poly-repo construida sobre **Claude Opus 4.7**: tickets entran, PRs cross-repo salen. El usuario no quiere "un asistente más" — quiere un sistema que **lea** y **opere** la organización completa de repos, respetando invariants y patrones existentes.

Los 3 flujos del producto:
- **Connect** — clona repos via `gh` CLI, hace ingest con token budgeting, construye memoria cross-repo (invariants + flows + call graph).
- **Build** — clasifica el ticket, despliega sub-agentes (frontend/backend/product/qa) con razonamiento visible y produce un plan multi-repo.
- **Ship** — ejecuta el plan, intercepta con skills (regex runner), abre branches/commits/PRs reales.

Milestone actual: **v0.5 "Codebase viva"** (ver `ROADMAP.md`).

## 2. Stack y comandos

- **Framework:** Next.js 14 (app router, RSC), React 18, TypeScript estricto.
- **UI:** Tailwind + shadcn/ui (style `new-york`, baseColor `zinc`, alias `@/*`). Iconos `lucide-react`.
- **Storage:** `better-sqlite3` (server-only — está en `serverComponentsExternalPackages`).
- **AI:** `@anthropic-ai/claude-agent-sdk` (modo recomendado) + `@anthropic-ai/sdk` (fallback raw).
- **Package manager:** **pnpm** (ver `pnpm-lock.yaml`). No usar npm/yarn.
- **Engines:** Node `>=20`.

```sh
pnpm install
pnpm dev          # next dev — golden path para iterar UI/API
pnpm build        # next build
pnpm typecheck    # tsc --noEmit  ← correr antes de declarar terminado
pnpm lint         # next lint
```

`.env.example` lista las variables necesarias (`ANTHROPIC_API_KEY`, `GITHUB_TOKEN`). Nunca commitear `.env`.

## 3. Layout del repo (qué vive dónde)

```
app/                  Rutas Next.js. Subcarpetas = features (build, connect, ship, skills, repos, brain, projects, settings).
  api/                Endpoints. Cada feature suele tener su propio /api/<feature>/route.ts con SSE para streaming.
lib/                  Núcleo del engine. Aquí va la lógica: engine.ts, build-pipeline.ts, repo-ingest.ts, skill-runner.ts, github*.ts, memory.ts, mesh-state.ts, etc.
  prompts/            Prompts del sistema agrupados.
  streaming/          Helpers de SSE.
components/           UI compartida. `mesh/` (componentes propios), `brain/`, `settings/`. shadcn primitives bajo `components/ui` (alias `@/components/ui`).
.claude/              ⚠️ Artefactos del PRODUCTO Mesh, NO del IDE Claude Code.
  agents/             frontend.md, backend.md, product.md, qa.md — system prompts de los sub-agentes que Mesh despacha.
  skills/             Skills empaquetados con Mesh (ej. mesh-design-tokens).
.mesh/                Estado local generado en runtime. Gitignored, nunca commitear.
bin/mesh.mjs          CLI de onboarding (`npx github:danielmedinac22/mesh onboard`).
```

> **Importante:** modificar `.claude/agents/*.md` o `.claude/skills/*` cambia el comportamiento del producto Mesh en producción, no de la sesión del IDE. Tratarlo como código.

## 4. Convenciones que ya están en el código

- **TypeScript estricto** (`strict: true`, `noEmit`). Sin `any` salvo justificación.
- **Imports con alias `@/*`** (ver `tsconfig.json`). No usar rutas relativas largas (`../../../`).
- **Server vs client:** preferir Server Components. Agregar `"use client"` solo cuando haga falta estado/eventos. `better-sqlite3` y el agent SDK son **server-only**.
- **Estilos:** usar tokens existentes (`MESH.*` y shadcn vars `hsl(var(--…))`). No pegar hex crudos en componentes — eso es lo mismo que pide el agente `frontend.md`.
- **API routes:** patrón SSE (Server-Sent Events) para flujos largos (build, connect, ship). Ver cómo `app/api/connect/route.ts` o `app/api/plan/route.ts` emiten eventos tipados.
- **Memoria/estado:** persistir en `.mesh/` via `lib/mesh-state.ts` y `lib/memory.ts`. Nada de lectura/escritura ad-hoc al sistema de archivos.
- **Errores:** sin `catch` silenciosos. Si capturas, loggea estructurado o re-lanza.

## 5. Flujo de desarrollo (Daniel / Simetrik)

- **Branching:** tronco es `main`. Trabajar siempre en feature branches: `feat/<scope>`, `fix/<scope>`, `chore/<scope>`, `refactor/<scope>`, `docs/<scope>`.
- **Commits convencionales en inglés**, imperativo, una sola idea por commit.
  - Formato: `<type>(<scope>)?: <subject>` — types: `feat`, `fix`, `chore`, `refactor`, `docs`, `perf`, `style`, `test`, `build`, `ci`.
  - Ejemplos: `feat(connect): stream repo-brief events via SSE`, `fix(skill-runner): escape regex in path filter`.
  - Body opcional explica el *por qué*, no el *qué*.
- **PRs:** Claude **no abre PRs** salvo que se le pida explícitamente. Cuando se pidan, título + body **en inglés** con:
  ```
  ## Summary
  ## Test plan
  ```
- **Antes de declarar terminado:** correr `pnpm typecheck` (y `pnpm lint` si se tocaron muchos archivos). Si tocó UI, `pnpm dev` y probarlo en el navegador — golden path + un caso borde. Si no fue posible probarlo, decirlo explícitamente en lugar de afirmar éxito.
- **Tests:** el repo no tiene suite hoy y **se mantiene así por ahora**. No introducir Vitest/Playwright/Jest ni tests ad-hoc sin acordarlo primero.
- **Idioma:**
  - Código, identificadores, commits, mensajes de PR, comentarios en código → **inglés**.
  - Conversación con el usuario (este chat, explicaciones, preguntas) → **español**.
  - Docs internos (`CLAUDE.md`, `ROADMAP.md`) → quedan en español por ahora.

## 6. Cosas que NO hacer

- No commitear `.env`, `.mesh/`, `node_modules`, ni archivos con credenciales.
- No introducir librerías nuevas sin justificación (ya hay zod, lucide, tailwind-merge, clsx, etc.).
- No reescribir `lib/engine.ts`, `lib/skill-runner.ts` o `lib/repo-ingest.ts` "de paso" — son el corazón del producto.
- No mezclar refactors grandes con bug fixes en el mismo commit.
- No usar `npm` ni `yarn` — solo `pnpm`.
- No crear `README.md`, `CLAUDE.md` o docs nuevos sin que el usuario los pida.

## 7. Cuando dudes

- Lee `ROADMAP.md` (milestone actual + scope por fase). El plan vive ahí, no en mi cabeza.
- `.claude/agents/*.md` documentan cómo debe pensar cada rol — útil aunque sean artefactos del producto.
- Para decisiones de arquitectura no triviales: pausa y pregunta antes de implementar.

---
*Última actualización: 2026-04-27. Si una sección queda desactualizada, edítala — este archivo es para nosotros.*
