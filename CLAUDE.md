# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan at:
docs/superpowers/plans/2026-04-27-phase-1-foundation.md
<!-- SPECKIT END -->

---

## Commands

```bash
npm run dev          # start Next.js dev server (http://localhost:3000)
npm run build        # production build — run this before every PR
npm run test         # vitest watch mode
npm run test:run     # vitest single run (use for CI / pre-commit checks)
npm run db:generate  # generate a new Drizzle migration from schema changes
npm run db:migrate   # apply pending migrations to the DB
npm run db:studio    # open Drizzle Studio (visual DB browser)
```

Run a single test file:
```bash
npx vitest run src/__tests__/lib/readiness-service.test.ts
```

TypeScript check (no emit):
```bash
npx tsc --noEmit
```

---

## Architecture

### Single-user, single-table MVP

All candidate data lives in one `candidates` row (Neon PostgreSQL via Drizzle ORM). The `candidate_id` FK is nullable — no auth in Phase 1. `getOrCreateCandidate()` in `src/lib/cv-service.ts` always returns the first (and only) row, creating one on first call.

### Data flow: CV save → parse

```
POST /api/cv/save
  → saveCVMarkdown()       // computes SHA-256; skips DB write if hash unchanged
  → parseCV()              // synchronous: awaited inline, not fire-and-forget
  → markParseReady() or markParseFailed()
  → return final candidate row
```

Parsing runs **synchronously** in the route handler (not via `after()`). The client receives the definitive `parseStatus` (`ready` | `failed`) in the same response.

### Layer map

| Layer | Path | Role |
|---|---|---|
| DB schema + types | `src/db/schema.ts` | Single `candidates` table; `Preferences` and `ParsedProfile` stored as JSONB; `Candidate` type inferred from Drizzle |
| App-level types | `src/types/candidate.ts` | `CandidateState`, `Preferences`, `PipelineReadiness` — used on both client and server |
| Services (pure, testable) | `src/lib/*-service.ts` | `cv-service`, `preferences-service`, `readiness-service` — no HTTP concerns; all business logic lives here |
| LLM | `src/lib/llm.ts` + `src/lib/cv-parser.ts` | `getModel()` reads `LLM_PROVIDER` + `LLM_MODEL` env vars; `parseCV()` calls `generateObject` (Vercel AI SDK) with `ParsedProfileSchema` (Zod) |
| API client | `src/lib/api.ts` | All `fetch` calls from client components; auto-retries 500s up to 3× |
| Route handlers | `src/app/api/` | Thin wrappers over service functions; no business logic |
| UI shell | `src/components/layout/` | `Sidebar` (client, `usePathname`) + `Topbar` (server) — composed in `src/app/layout.tsx` |
| Pages | `src/app/dashboard/`, `settings/`, `pipeline/`, `applications/` | All `'use client'`; Dashboard fetches `GET /api/cv` + `GET /api/candidate/readiness` in parallel via `Promise.all` |

### CSS / theming

Tailwind CSS v4 with **no `tailwind.config.js`**. Colors are shadcn CSS variables (`--primary`, `--background`, etc.) defined in `src/app/globals.css` under `@layer base { :root { … } }`. The `@theme inline` block below them maps each variable to a Tailwind utility (`--color-primary: hsl(var(--primary))` → `bg-primary`). Without this block the token-based classes are no-ops.

### Key invariants

- `geographic_preference` in `Preferences` is `string[]` (multi-select), not `string`. The readiness check uses `Array.isArray(x) && x.length > 0`.
- The `Button` component (`src/components/ui/button.tsx`) exposes `isLoading?: boolean`. When true: renders a `<Spinner>` (ring style, `src/components/ui/spinner.tsx`), forces `disabled`, and sets `aria-busy`. The `Slot.Root` path is never taken when `isLoading` is true.
- Placeholder pages (`/pipeline`, `/applications`) and `PlaceholderPage` are all `'use client'` — required because they pass Lucide icon components as props, which React 19 cannot serialize across the server→client boundary.

### Testing

Tests live in `src/__tests__/` mirroring the `src/` tree. Component tests use `@testing-library/react` + jsdom. Service tests mock `@/db` at the module level (`vi.mock('@/db', ...)`). There are no API route tests — route handlers are thin enough to be covered by service-layer tests + manual smoke testing.

---

## Environment

Required `.env.local` keys:

```
DATABASE_URL=        # Neon PostgreSQL connection string
ANTHROPIC_API_KEY=   # Claude API key
LLM_PROVIDER=anthropic
LLM_MODEL=claude-sonnet-4-6
```

---

## Skill Triggers

Invoke the listed skill BEFORE taking any action in the corresponding situation.
If a skill applies, invoking it is mandatory — not optional.

### Development lifecycle

| Situation | Skill |
|---|---|
| Any new feature, component, or behaviour to design | `superpowers:brainstorming` |
| Writing a multi-step implementation plan from a spec | `superpowers:writing-plans` |
| Executing a written implementation plan | `superpowers:executing-plans` or `superpowers:subagent-driven-development` |
| Implementing any feature or bugfix (before writing code) | `superpowers:test-driven-development` |
| Before committing, opening a PR, or claiming work is done | `superpowers:verification-before-completion` |
| Encountering any bug, test failure, or unexpected behaviour | `superpowers:systematic-debugging` |
| 2+ independent tasks that can run without shared state | `superpowers:dispatching-parallel-agents` |
| Starting feature work that needs isolation from the workspace | `superpowers:using-git-worktrees` |
| Implementation complete — deciding how to integrate | `superpowers:finishing-a-development-branch` |
| Major feature step complete, pre-merge | `superpowers:requesting-code-review` |
| Receiving code review feedback | `superpowers:receiving-code-review` |

### Next.js / React code

| Situation | Skill |
|---|---|
| Writing or reviewing any React component, hook, or Next.js page | `vercel-react-best-practices` |
| Building any new UI page, layout, or component | `frontend-design` |
| Verifying frontend behaviour in the browser | `webapp-testing` |

### SpecKit workflows

| Situation | Skill |
|---|---|
| Creating or updating a feature specification | `speckit-specify` |
| Clarifying an underspecified spec before planning | `speckit-clarify` |
| Producing an implementation plan from design artifacts | `speckit-plan` |
| Generating a task list from design artifacts | `speckit-tasks` |
| Executing tasks defined in tasks.md | `speckit-implement` |
| Cross-checking spec, plan, and tasks for consistency | `speckit-analyze` |
| Creating or amending the project constitution | `speckit-constitution` |
