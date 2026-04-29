<!--
SYNC IMPACT REPORT
==================
Version change: 1.0.0 → 1.3.1
Ratification date: 2026-04-26
Last amended: 2026-04-26

Modified principles:
  - V. Provider-Agnostic LLM — scoped to two runtimes:
      • Next.js layer: Vercel AI SDK (ai@5.x + @ai-sdk/anthropic)
      • Python agent layer: LiteLLM (original principle, restored for agents)
    Rationale: Python LangGraph agents are the confirmed orchestration runtime.
  - VII. Dual-Runtime Architecture — trigger mechanism changed from HTTP POST to
    Neon job queue. Next.js writes a pipeline_jobs row; Python agent polls Neon
    for queued jobs. Eliminates HTTP coupling between runtimes entirely.
    Rationale: Neon job queue is resilient to service restarts, needs no service
    discovery, no shared secret, and is consistent with using Neon as the sole
    state bus for all inter-runtime communication.

Added sections:
  - VI. Technology Standards — canonical library versions and conventions.
  - VII. Dual-Runtime Architecture — runtime boundaries, Neon job queue trigger,
    HITL checkpoint flow, SSE for UI updates.

Removed sections: N/A

Templates reviewed:
  ✅ .specify/templates/plan-template.md — no update needed
  ✅ .specify/templates/spec-template.md — compatible with dual-runtime architecture
  ✅ .specify/templates/tasks-template.md — no update needed
  ✅ docs/proxim-prd-extended.md — aligns with confirmed architecture; no changes needed
  ✅ docs/user-journey.md — HITL pattern codified in Principle VII; no changes needed
  ⚠️  docs/superpowers/plans/2026-04-26-phase-1-foundation.md — OBSOLETE. Must be
     regenerated for Next.js 15 + Drizzle + confirmed dual-runtime architecture.

Deferred TODOs: Regenerate Phase 1 implementation plan with confirmed stack.
-->

# Proxim Constitution

## Core Principles

### I. Human Supremacy (HITL-First)

AI analyses, humans decide. No external action — email, LinkedIn connection request, job
application, or any outbound communication — MUST fire without explicit user approval on the
review dashboard.

- Every consequential pipeline transition MUST pass through a LangGraph `interrupt_before` HITL
  checkpoint before proceeding.
- Scoring, report generation, and resume building are fully automated. Outreach initiation is not.
- A/B-grade jobs MUST be surfaced to the user before any outbound action is taken, regardless of
  confidence in the match.
- The user's approve / reject / snooze decision is authoritative — agents MUST NOT override or
  auto-escalate it.

**Rationale:** Senior candidates have reputational stakes in every outreach they send. An
incorrect or poorly-timed application can damage relationships with target employers. User
control at the outreach gate is the product's primary trust mechanism.

### II. Agent Modularity

Each agent (Job Hunter, Match Analyst, Resume Builder, LinkedIn Connector, Outreach Mailer) MUST
be a single-responsibility LangGraph node or sub-graph with a clearly defined input schema, output
schema, and failure mode.

- No agent MUST depend directly on another agent's internal state — all inter-agent communication
  MUST flow exclusively through the LangGraph shared state schema stored in Neon.
- Each agent MUST be independently testable against a fixture or stub of the shared state — no
  end-to-end integration required to unit-test an individual agent.
- New data sources (scrapers, APIs) MUST be encapsulated as standalone modules within the relevant
  agent's sub-graph, not added to shared infrastructure.
- Agent failure MUST be isolated — one agent crashing or timing out MUST NOT halt the pipeline for
  unrelated jobs.

**Rationale:** A five-agent pipeline with implicit coupling becomes unmaintainable quickly.
Modularity enables independent development, testing, and deployment of each capability slice,
and makes it safe to swap or upgrade individual agents without regressions elsewhere.

### III. Factual Integrity (NON-NEGOTIABLE)

Resume personalisation MUST reframe and reorder existing proof points — it MUST NOT fabricate,
inflate, or invent job titles, company names, dates, quantified outcomes, patent numbers, or
credentials.

- Job titles, company names, and employment dates: MUST appear exactly as in the base CV.
- Quantified outcomes (e.g., "$2B platform", "25–30% revenue", "sub-2-second load times"):
  MUST NOT be altered numerically or directionally.
- Patent numbers and grant dates: MUST be exact.
- Education, certifications, and awards: MUST be unchanged.
- Every LLM output containing factual claims MUST pass a self-review coherence check before
  being written to Neon or rendered to PDF.
- The self-repair loop MUST retry and flag — not silently accept — any output that fails
  Pydantic validation of factual fields.

**Rationale:** Fabricated credentials or inflated metrics constitute professional fraud. This
principle is the non-negotiable ethical floor of the product — no performance optimisation,
latency target, or UX improvement justifies weakening it.

### IV. Observability by Default

Every LLM call, agent state transition, HITL decision, and outbound action MUST be traceable
from the moment it enters the pipeline.

- Development / staging: LangSmith tracing MUST be enabled via `LANGCHAIN_TRACING_V2=true`.
  Every LangGraph run, node execution, checkpoint, and LLM call MUST be automatically traced.
- Production: LangDB SDK instrumentation MUST be applied to all LLM calls (no proxy mode).
  Grafana Tempo MUST receive OpenTelemetry spans from Next.js Route Handlers, LangGraph agents,
  and background jobs. LangSmith MUST be disabled in production.
- Structured JSON output MUST be used for all LLM-generated structured data (10D scores, report
  blocks, archetype detection) — via Vercel AI SDK `generateObject` + Zod validation.
  Free-text parsing with regex MUST NOT be used for machine-consumed outputs.
- P99 observability overhead MUST NOT exceed 5ms per LLM call.

**Rationale:** A multi-agent pipeline with LLM calls at every stage is a black box without
structured tracing. Observability is what makes scoring errors debuggable, cost spikes
attributable, and interview callback data actionable.

### V. Provider-Agnostic LLM

Proxim runs two runtimes. Each has a mandatory LLM abstraction layer — no runtime MUST import
a provider SDK directly.

**Next.js runtime (UI + single-step LLM calls):**
- All LLM calls MUST use the Vercel AI SDK (`ai@5.x`). Provider adapters permitted:
  `@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google` — nothing else.
- A single provider factory in `src/lib/llm.ts` MUST export `getModel()`. No provider-selection
  logic is permitted anywhere else in the Next.js codebase.
- All structured output MUST use `generateObject` with a Zod schema. `JSON.parse` on raw LLM
  text MUST NOT be used for machine-consumed output.
- When `LLM_PROVIDER=anthropic`, set `structuredOutputMode: 'outputFormat'` in `providerOptions`
  to enable native structured outputs (requires claude-sonnet-4-5 or later).
- Streaming MUST use `streamText` or `streamObject` — never raw SSE construction.
- Provider packages MUST satisfy the AI SDK v2 spec: `@ai-sdk/*` at `^2.0.0` or later.

**Python agent runtime (LangGraph pipeline):**
- All LLM calls MUST be routed through LiteLLM. No agent MUST import the Anthropic, OpenAI,
  or Google SDK directly.
- The active provider is controlled exclusively by `LLM_PROVIDER` env var. Supported values:
  `anthropic` (default), `openai`, `google`.
- Model version MUST be pinned in `.env` — e.g. `LLM_MODEL=claude-sonnet-4-6`.
- Prompt caching MUST be enabled when `LLM_PROVIDER=anthropic`; skipped silently otherwise.
- Structured output MUST use `response_format` JSON schema + Pydantic validation.

**Shared rule (both runtimes):**
- `LLM_PROVIDER` and `LLM_MODEL` MUST be the same value across both runtimes in any given
  deployment environment — no per-runtime provider divergence in production.

**Rationale:** Python LangGraph is the confirmed orchestration runtime for multi-step agents.
LiteLLM is the right abstraction there. The Next.js layer handles single-step LLM calls
(CV parsing, report snippets) where Vercel AI SDK provides native TypeScript integration and
Zod-validated structured output. Both layers honour the same provider-agnostic contract.

### VI. Technology Standards

#### Canonical Library Versions

All new features MUST use the versions below. Upgrading a library requires a constitution PATCH
amendment noting the old and new version.

**Next.js runtime (`package.json`)**

| Layer | Package | Version |
|---|---|---|
| Framework | `next` | `^15` |
| Language | `typescript` | `^5` |
| Styling | `tailwindcss` | `^4.1` |
| Tailwind PostCSS plugin | `@tailwindcss/postcss` | `^4.1` |
| Component library | `shadcn/ui` (CLI) | `shadcn@latest` (v4.1-compatible) |
| Component primitives | `@radix-ui/react-*` | installed by shadcn CLI |
| Icons | `lucide-react` | installed by shadcn CLI |
| Class utilities | `clsx`, `tailwind-merge`, `class-variance-authority` | installed by shadcn CLI |
| ORM | `drizzle-orm` | latest compatible with drizzle-kit `0.31.x` |
| Migrations | `drizzle-kit` | `^0.31.5` (dev) |
| DB driver | `@neondatabase/serverless` | `^1.0.0` |
| AI SDK core | `ai` | `^5.0.0` |
| Anthropic adapter | `@ai-sdk/anthropic` | `^2.0.0` |
| Schema validation | `zod` | `^4.1.8` |

**Python agent runtime (`pyproject.toml`)**

| Layer | Package | Version | Notes |
|---|---|---|---|
| Runtime | `python` | `>=3.11` | |
| Agent framework | `langgraph` | `^0.4` | |
| LLM abstraction | `litellm` | `^1.40` | |
| DB driver | `asyncpg` | `^0.29` | `FOR UPDATE SKIP LOCKED` polling |
| Schema validation | `pydantic` | `^2.7` | |
| Tracing (dev/staging) | `langsmith` | `^0.1` | |
| Health server | `fastapi` + `uvicorn[standard]` | `^0.115` / `^0.30` | Optional — `GET /health` only |

#### shadcn/ui Conventions

- shadcn/ui is initialized with `npx shadcn@latest init`. The generated `components.json`
  MUST have `tailwind.config` set to `""` (empty string) for Tailwind v4 compatibility.
- UI primitives MUST be added via `npx shadcn@latest add <component>` — never hand-copied.
  Added components land in `src/components/ui/` and MUST NOT be edited directly.
- The `cn()` utility from `src/lib/utils.ts` (generated by shadcn init) MUST be used for
  all conditional class merging — never raw string concatenation or `clsx` imported directly.
- Custom application components (CVUploader, PreferencesForm, etc.) live in
  `src/components/cv/`, `src/components/preferences/`, `src/components/shared/` and
  import from `src/components/ui/` — never the other way around.
- `lucide-react` is the sole icon library. No other icon packages are permitted.
- Style: `new-york`. Base colour: `neutral`. CSS variables: enabled.

#### Next.js 15 Conventions

- All routes live under `src/app/`. API endpoints use Route Handler files (`route.ts`).
- `params` in Route Handlers is a `Promise` and MUST be `await`ed before property access.
- Server Components are the default; add `"use client"` only when browser APIs or React state
  are required.
- Environment variables accessed server-side use `process.env.VAR`; client-side variables MUST
  be prefixed `NEXT_PUBLIC_` and contain no secrets.
- All secrets MUST live in `.env.local` (gitignored). `.env.example` documents required keys
  with placeholder values only.

#### Drizzle ORM Conventions

- Schema MUST be defined in `src/db/schema.ts` using `pgTable` from `drizzle-orm/pg-core`.
- Column names in schema use `camelCase`; Drizzle maps to `snake_case` in the database via the
  `casing: 'snake_case'` config option in `drizzle.config.ts`.
- UUID primary keys MUST use `.uuid().defaultRandom().primaryKey()`.
- JSONB columns MUST use `.$type<YourType>()` to attach a TypeScript type.
- Migrations are generated with `drizzle-kit generate` and applied with `drizzle-kit migrate`.
  Handwritten SQL migrations MUST NOT be used.
- The DB singleton MUST be exported from `src/db/index.ts` using `drizzle-orm/neon-http`.
  Connection strings come exclusively from `process.env.DATABASE_URL`.

#### Vercel AI SDK Conventions

- The provider factory MUST live in `src/lib/llm.ts` and export a single `getModel()` function.
- `generateObject` is the only permitted function for structured outputs; the Zod schema MUST be
  co-located with the call site or exported from `src/lib/schemas/`.
- `streamText` / `streamObject` MUST be used for any user-facing streaming response.
- LLM calls MUST NOT be placed directly in React Server Components — use Route Handlers or
  server actions.

### VII. Dual-Runtime Architecture

Proxim is composed of two runtimes. All communication between them MUST flow exclusively through
Neon — never via direct HTTP calls, shared memory, or in-process imports.

#### Runtime Responsibilities

| Runtime | Responsibilities | LLM abstraction |
|---|---|---|
| **Next.js 15** | UI, Route Handler API, CV upload/convert, single-step LLM calls (CV parsing), job queue writes, SSE streams | Vercel AI SDK |
| **Python agent service** | LangGraph pipeline execution, Neon polling loop, HITL checkpoint writes, background job processing | LiteLLM |

#### Trigger: Neon Job Queue

Next.js MUST NOT make HTTP calls to the Python service to trigger agents. Instead, Next.js
writes a row to `pipeline_jobs` in Neon; the Python service polls for queued jobs.

```
Next.js Route Handler
  POST /api/pipeline/trigger
    └─► INSERT INTO pipeline_jobs
          (id, status='queued', job_type, candidate_id, payload, created_at)
        returns 201 { jobId } to browser immediately

Python agent service  (polling daemon)
  loop every 3 s:
    SELECT * FROM pipeline_jobs
      WHERE status = 'queued'
      ORDER BY created_at
      LIMIT 1
      FOR UPDATE SKIP LOCKED          ← prevents double-pickup
    └─► UPDATE pipeline_jobs SET status='running', started_at=now()
    └─► asyncio.create_task(run_langgraph(job))
```

**`pipeline_jobs` schema (managed by Drizzle migration):**

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | Job identifier returned to browser |
| `status` | enum | `queued` → `running` → `completed` \| `failed` |
| `job_type` | text | e.g. `full_pipeline`, `single_match` |
| `candidate_id` | uuid FK | Links to candidates table |
| `payload` | jsonb | Trigger parameters |
| `created_at` | timestamptz | When Next.js enqueued the job |
| `started_at` | timestamptz | When Python agent picked it up |
| `completed_at` | timestamptz | When agent finished |
| `error` | text | Failure message if status = failed |

#### State & HITL Flow

```
Python agent service
  LangGraph node execution
    └─► writes to Neon: pipeline_runs, job_matches, hitl_checkpoints

Next.js Route Handler
  GET /api/pipeline/[jobId]/status
    └─► reads pipeline_jobs + pipeline_runs from Neon → returns state snapshot

  GET /api/pipeline/[jobId]/stream  (SSE)
    └─► ReadableStream polling Neon every 2 s
    └─► pushes state-change events to browser until status = completed | failed

  POST /api/pipeline/[jobId]/resume
    └─► writes decision (approve | reject | snooze) → hitl_checkpoints
    └─► Python agent detects decision via Neon poll → resumes graph
```

#### HITL Checkpoint Flow

1. Agent hits `interrupt_before` node → inserts `hitl_checkpoints` row:
   `status = 'awaiting'`, `payload` = serialised job match / draft outreach data.
2. Next.js SSE stream detects `status = 'awaiting'` → pushes `hitl_required` event to browser.
3. UI renders approval card with checkpoint payload.
4. User clicks Approve / Reject / Snooze → `POST /api/pipeline/[jobId]/resume` →
   updates `hitl_checkpoints.status` and `.decision`.
5. Python agent polls Neon → sees decision → resumes or terminates graph branch.
6. Agent writes final state to `pipeline_runs` → SSE pushes `completed` event → UI updates.

#### Rules

- Python agent service MUST NOT call any Next.js Route Handler. All output flows to Neon only.
- Next.js MUST NOT import Python modules, shell out to Python, or make HTTP calls to the
  agent service for any purpose related to job triggering or state retrieval.
- `SELECT ... FOR UPDATE SKIP LOCKED` MUST be used in the Python polling query to prevent
  two agent workers from picking up the same job.
- Polling interval in the Python daemon MUST be 3 seconds. MUST use `asyncio.sleep` — never
  a blocking sleep.
- SSE endpoints in Next.js MUST use the native `ReadableStream` Web API — never Node.js
  `res.write` or EventEmitter patterns.
- The Python service MAY expose a `GET /health` endpoint for deployment health checks.
  No other HTTP endpoints are permitted on the agent service.

#### Phase Applicability

- **Phase 1 (Foundation):** Python service NOT required. CV parsing is a single
  `generateObject` call in a Next.js Route Handler (Vercel AI SDK). `pipeline_jobs` table
  is NOT created yet — no agent pipeline in Phase 1.
- **Phase 2+ (Pipeline):** Python polling daemon introduced. `pipeline_jobs`,
  `pipeline_runs`, `job_matches`, `hitl_checkpoints` tables added via Drizzle migration.

## Security & Data Residency

- All pipeline state — LangGraph checkpoints, job records, resume versions, cadence state,
  user preferences — MUST be stored in the self-controlled Neon PostgreSQL instance.
- Third-party managed orchestration services (e.g., LangGraph Platform) MUST NOT be used for
  production pipeline state while candidate data (CV, compensation targets, outreach content)
  is in scope.
- All outbound API keys (Proxycurl, Hunter.io, Exa AI, Gmail OAuth2) MUST be stored as
  environment variables — never committed to source control.
- Candidate email credentials MUST remain in the candidate's own Gmail OAuth2 session — Proxim
  MUST NOT store or re-use email passwords or refresh tokens beyond the OAuth2 session scope.
- The `--no-verify` git flag MUST NOT be used to bypass pre-commit hooks in production branches.

## Development Workflow

- All changes to `main` MUST go through a pull request — direct pushes are prohibited.
- Every PR MUST be scoped to a single feature, fix, or documented exception.
- Feature branches MUST follow the naming convention `###-feature-name` matching the spec
  directory.
- Each `plan.md` MUST include a Constitution Check gate (verified before Phase 0 research and
  re-checked after Phase 1 design). Any constitution violation MUST be documented in the
  Complexity Tracking table with justification.
- Tests for critical paths (10D scoring, resume factual integrity, HITL state transitions) MUST
  be written before implementation — Red-Green-Refactor applies.
- Secrets MUST NOT be committed. `.env` files MUST be listed in `.gitignore`.

### Skill Invocation Policy

Project skills live in `.claude/skills/`. Invoking the correct skill at the correct moment is
MANDATORY. An agent that skips a required skill MUST NOT claim the associated step is complete.

**Development lifecycle**

| Moment | Required skill |
|---|---|
| Before designing any new feature, component, or behaviour | `superpowers:brainstorming` |
| Before writing a multi-step implementation plan | `superpowers:writing-plans` |
| Before writing implementation code for any feature or bugfix | `superpowers:test-driven-development` |
| Before committing, opening a PR, or claiming work is done | `superpowers:verification-before-completion` |
| When encountering any bug, test failure, or unexpected behaviour | `superpowers:systematic-debugging` |
| When executing a written implementation plan | `superpowers:executing-plans` or `superpowers:subagent-driven-development` |
| When 2+ independent tasks can run without shared state | `superpowers:dispatching-parallel-agents` |
| When starting feature work in an isolated branch | `superpowers:using-git-worktrees` |
| When implementation is complete and ready to integrate | `superpowers:finishing-a-development-branch` |
| When a major feature step is complete, pre-merge | `superpowers:requesting-code-review` |
| When receiving code review feedback | `superpowers:receiving-code-review` |

**React / Next.js code**

| Moment | Required skill |
|---|---|
| Writing or reviewing any React component, hook, or Next.js page | `vercel-react-best-practices` |
| Building any new UI page, layout, or component | `frontend-design` |
| Verifying frontend behaviour in the browser | `webapp-testing` |

**SpecKit workflows**

| Moment | Required skill |
|---|---|
| Creating or updating a feature specification | `speckit-specify` |
| Clarifying an underspecified spec before planning | `speckit-clarify` |
| Producing an implementation plan from design artifacts | `speckit-plan` |
| Generating a task list from design artifacts | `speckit-tasks` |
| Executing tasks defined in tasks.md | `speckit-implement` |
| Cross-checking spec, plan, and tasks for consistency | `speckit-analyze` |
| Creating or amending the project constitution | `speckit-constitution` |

## Governance

This constitution supersedes all other practices, conventions, or agent-specific instructions.
Where a conflict exists between a plan, spec, or task and this constitution, the constitution wins.

**Amendment procedure:**
1. Open a PR targeting `main` with the proposed change to this file.
2. Document the rationale, the version bump type (MAJOR / MINOR / PATCH per the versioning
   policy below), and any templates or docs requiring updates.
3. PR MUST be approved before merge — no self-merge on constitution amendments.

**Versioning policy:**
- MAJOR: Backward-incompatible governance or principle removal / redefinition.
- MINOR: New principle or section added, or materially expanded guidance.
- PATCH: Clarifications, wording, or non-semantic refinements.

**Compliance:** All PR reviewers MUST verify that the proposed implementation passes the
Constitution Check in the associated `plan.md` before approving.

**Version**: 1.3.2 | **Ratified**: 2026-04-26 | **Last Amended**: 2026-04-27
