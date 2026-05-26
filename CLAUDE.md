# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Library & Framework Documentation (MANDATORY)

**Always use the context7 MCP server to fetch current documentation** before using or configuring any library, framework, SDK, API, or CLI tool — even well-known ones like Next.js, Drizzle ORM, LangGraph, LiteLLM, WeasyPrint, xhtml2pdf, or shadcn/ui.

Use the `mcp__context7__resolve-library-id` and `mcp__context7__query-docs` tools to get up-to-date API syntax, configuration options, version-specific behaviour, and migration guides. Never rely solely on training data for library usage — APIs change, and outdated patterns cause bugs.

**Triggers**: any `import`, `require`, `poetry add`, or `npm install` of a new or existing library; any configuration of an external service; any question about "how do I use X".

<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan at:
specs/009-resume-tailoring-insights/plan.md
<!-- SPECKIT END -->

---

## UI Components — shadcn/ui + Tailwind CSS Only (MANDATORY)

All UI elements MUST use **shadcn/ui components** from `src/components/ui/`. Raw HTML elements are not permitted for interactive elements.

| Instead of | Use |
|---|---|
| `<button>` | `<Button>` from `@/components/ui/button` |
| `<input>` | `<Input>` from `@/components/ui/input` |
| `<a href>` | `<Button asChild><a href>...</a></Button>` |
| Custom drawer/modal | `<Sheet>` from `@/components/ui/sheet` |
| Custom card div | `<Card>` from `@/components/ui/card` |
| Custom badge span | `<Badge>` from `@/components/ui/badge` |
| Loading div | `<Skeleton>` from `@/components/ui/skeleton` |
| Custom dropdown | `<DropdownMenu>` from `@/components/ui/dropdown-menu` |

- Styling MUST use **Tailwind CSS v4** utility classes only — no inline `style={{}}` except for dynamic values (e.g. chart colours) that cannot be expressed as Tailwind utilities.
- New shadcn/ui components are added by creating a wrapper in `src/components/ui/` following the existing pattern (radix-ui primitives + `cn()` utility).
- `lucide-react` is the only permitted icon library.
- Never install a third-party UI library (MUI, Chakra, Ant Design, etc.).

---

## Database — Single Shared DB (MANDATORY)

Both the **Next.js UI layer** and the **Python agent** MUST always connect to the **same database**.

- `DATABASE_URL` in `.env.local` (Next.js) and `DATABASE_URL` in `agent/.env` (Python) MUST point to the **same file or server** at all times.
- Local development: both point to the SQLite file (e.g. `./proxim-dev.db` or `../proxim-dev.db`).
- Production: both point to the Neon PostgreSQL connection string.
- `src/db/index.ts` auto-detects the driver: SQLite (`better-sqlite3`) when `DATABASE_URL` is a file path; Neon HTTP when it starts with `postgresql://`.
- **Never configure one runtime to use SQLite while the other uses Neon** — data written by the agent will not be visible in the UI and vice versa.

---

## Pre-Commit / Pre-Push Gate

**Invoke `superpowers:verification-before-completion` before every commit, push, or completion claim.**

The skill requires running each verification command and reading its actual output — not assuming it passes. The mandatory checklist for this project is:

```bash
npm run test:run     # must show 0 failures
npx tsc --noEmit     # must show no output (zero errors)
npm run build        # must complete with exit 0 and no prerender errors
```

All three MUST pass with evidence before any `git push` or PR. A passing test suite does not imply a passing build — TypeScript and Next.js prerendering can fail independently.

---

## Task Tracking Discipline

When executing tasks from **any plan or task file** — including `tasks.md` files in `specs/` and implementation plans in `docs/superpowers/plans/`:

- Mark each step/task `[x]` in the file **immediately** after it is completed — not in a batch at the end.
- Use the pattern: change `- [ ]` → `- [x]` in the file as soon as the task's work is committed.
- Commit the plan/task file update together with the task's code, or at minimum before starting the next task.
- This applies to every `speckit-implement` run, every `executing-plans` / `subagent-driven-development` run, and any manual task execution.
- **Rule:** No task is considered done until its checkbox is marked `[x]` in the source file.

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

### Multi-candidate, multi-user

Multiple candidates are supported. Each candidate has their own row in the `candidates` table, and all downstream data (jobs, pipeline runs, resume versions, HITL checkpoints, scan history) is scoped by `candidateId` FK. There is no auth layer yet — candidate identity is passed explicitly via query params or request context.

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
| DB schema + types | `src/db/schema.ts` | `candidates`, `jobs`, `pipeline_jobs`, `pipeline_runs`, `pipeline_logs`, `scan_history`, `resume_versions`, `hitl_checkpoints` — all job/pipeline/resume tables FK to `candidates.id`; `Preferences` and `ParsedProfile` stored as JSONB; `Candidate` type inferred from Drizzle |
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

## Two Separate Workflows — Do Not Mix

This project uses **two distinct planning and implementation workflows**. They must never be mixed.

---

### Workflow A — SpecKit (for named features in `specs/`)

**Use this when**: working on a feature that has or will have a spec directory under `specs/###-feature-name/`.

**SpecKit commands** produce a specific folder structure in `specs/###-feature-name/`:

```
specs/###-feature-name/
├── spec.md          ← /speckit-specify
├── research.md      ← /speckit-plan (Phase 0)
├── data-model.md    ← /speckit-plan (Phase 1)
├── quickstart.md    ← /speckit-plan (Phase 1)
├── contracts/       ← /speckit-plan (Phase 1)
│   └── api.md
├── plan.md          ← /speckit-plan (filled template)
└── tasks.md         ← /speckit-tasks
```

**Rules for SpecKit:**
- `/speckit-plan` generates `research.md`, `data-model.md`, `contracts/`, `quickstart.md`, and fills `plan.md` — output lives in `specs/###-feature-name/`, **never** in `docs/superpowers/plans/`
- `/speckit-tasks` generates `tasks.md` in `specs/###-feature-name/` — tasks follow the `T001 [P] [US?] Description — file path` format seen in `specs/001-job-discovery-agent/tasks.md`
- `/speckit-implement` executes `tasks.md` tasks one at a time, marking `[x]` as each completes
- **Do NOT invoke `superpowers:writing-plans` or `superpowers:executing-plans` for SpecKit features** — these produce output in the wrong location and wrong format
- Superpowers skill gates (`superpowers:test-driven-development`, `superpowers:verification-before-completion`, etc.) ARE still invoked at the gates marked inside `tasks.md`

| SpecKit command | When to use |
|---|---|
| `/speckit-specify` | Creating or updating a feature spec |
| `/speckit-clarify` | Clarifying underspecified areas before planning |
| `/speckit-plan` | Generating research + design artifacts from spec |
| `/speckit-tasks` | Generating the task list from design artifacts |
| `/speckit-implement` | Executing tasks defined in `tasks.md` |
| `/speckit-analyze` | Cross-checking spec, plan, and tasks for consistency |
| `/speckit-constitution` | Creating or amending the project constitution |

---

### Workflow B — Superpowers (for ad-hoc work outside `specs/`)

**Use this when**: fixing bugs, building small features without a spec, exploring architecture, or for any work that doesn't have a `specs/###-feature-name/` directory.

**Output location**: `docs/superpowers/plans/YYYY-MM-DD-<feature>.md`

| Situation | Skill |
|---|---|
| Any new feature or behaviour to design | `superpowers:brainstorming` |
| Writing an implementation plan from a spec | `superpowers:writing-plans` → saves to `docs/superpowers/plans/` |
| Executing a written implementation plan | `superpowers:executing-plans` or `superpowers:subagent-driven-development` |
| Implementing any feature or bugfix (before writing code) | `superpowers:test-driven-development` |
| Before committing, pushing, opening a PR, or claiming work is done | `superpowers:verification-before-completion` — must run `test:run` + `tsc --noEmit` + `build` |
| Encountering any bug, test failure, or unexpected behaviour | `superpowers:systematic-debugging` |
| 2+ independent tasks that can run without shared state | `superpowers:dispatching-parallel-agents` |
| Starting feature work that needs isolation from the workspace | `superpowers:using-git-worktrees` |
| Implementation complete — deciding how to integrate | `superpowers:finishing-a-development-branch` |
| Major feature step complete, pre-merge | `superpowers:requesting-code-review` |
| Receiving code review feedback | `superpowers:receiving-code-review` |

### Next.js / React code (applies to both workflows)

| Situation | Skill |
|---|---|
| Writing or reviewing any React component, hook, or Next.js page | `vercel-react-best-practices` |
| Building any new UI page, layout, or component | `frontend-design` |
| Verifying frontend behaviour in the browser | `webapp-testing` |
