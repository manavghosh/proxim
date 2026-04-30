# Implementation Plan: Job Discovery Agent (F2)

**Branch**: `001-job-discovery-agent` | **Date**: 2026-04-30 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `specs/001-job-discovery-agent/spec.md`

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan. Before writing any code invoke `superpowers:test-driven-development`. Before committing invoke `superpowers:verification-before-completion`.

## Summary

Introduce the Python LangGraph agent runtime for the first time alongside the existing Next.js app. Next.js enqueues pipeline trigger jobs in a new `pipeline_jobs` Neon table; the Python polling daemon picks them up via `FOR UPDATE SKIP LOCKED` and runs a LangGraph fan-out graph that scrapes LinkedIn (Playwright), Naukri (requests+BS4), iimjobs (requests+BS4), and target company careers pages (Playwright) in parallel. Discovered jobs are URL-exact and fuzzy-deduplicated, normalised, and persisted to a new `jobs` table. Next.js exposes trigger, status, and SSE stream endpoints; the Dashboard "Run Pipeline" button triggers the flow and shows live progress.

## Technical Context

**Language/Version**: TypeScript 5 (Next.js layer) + Python 3.11 (agent layer)
**Primary Dependencies**:
- Next.js: `next@^15`, `drizzle-orm`, `@neondatabase/serverless` (existing stack)
- Agent: `langgraph@^0.4`, `litellm@^1.40`, `asyncpg@^0.29`, `pydantic@^2.7`, `playwright@^1.44`, `beautifulsoup4`, `requests`, `rapidfuzz`, `structlog`, `langsmith@^0.1`, `fastapi@^0.115`, `uvicorn[standard]@^0.30`

**Storage**: Neon PostgreSQL — 4 new tables: `pipeline_jobs`, `pipeline_runs`, `jobs`, `scan_history`
**Testing**: Vitest + @testing-library/react (Next.js) + pytest with HTML/JSON fixtures (Python)
**Target Platform**: Next.js on Vercel + Python agent on Docker (self-hosted VPS)
**Performance Goals**: Full discovery run completes within 10 minutes; ≥ 15 new jobs per run
**Constraints**: Python daemon polls every 3s; `FOR UPDATE SKIP LOCKED` prevents concurrent pickup; max 50 LinkedIn results per query per run
**Scale/Scope**: Single candidate; single active run at a time; 4 scraper sources

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Status | Notes |
|---|---|---|
| I. Human Supremacy (HITL-First) | ✅ PASS | Discovery is fully automated. No outbound actions in this feature. No HITL gate required. |
| II. Agent Modularity | ✅ PASS | Each scraper is an isolated module with its own error handling. One scraper failure does not halt others. Discovery graph is independent of scoring/outreach graphs. |
| III. Factual Integrity | ✅ PASS | No LLM calls in discovery. Raw JD stored verbatim as extracted. No generation risk. |
| IV. Observability by Default | ✅ PASS | LangSmith tracing enabled via env vars in dev (`LANGCHAIN_TRACING_V2=true`). All LangGraph nodes traced automatically. structlog for structured daemon logs. |
| V. Provider-Agnostic LLM | ✅ PASS | No LLM calls in this feature. LiteLLM present in agent `pyproject.toml` for future phases. |
| VI. Technology Standards | ✅ PASS | Python 3.11, LangGraph ^0.4, asyncpg ^0.29, Pydantic ^2.7 — all per constitution. Playwright for JS-rendered pages. |
| VII. Dual-Runtime Architecture | ✅ PASS | Next.js writes `pipeline_jobs` row. Python polls Neon with `FOR UPDATE SKIP LOCKED` (3-second `asyncio.sleep`). Zero HTTP between runtimes. SSE uses native `ReadableStream`. Python exposes only `GET /health`. |

**Post-Phase 1 re-check: PASS** — data model and contracts reviewed; all column names, query patterns, and SSE implementation comply with constitution.

## Project Structure

### Documentation (this feature)

```text
specs/001-job-discovery-agent/
├── plan.md              ← This file
├── research.md          ← Phase 0 output
├── data-model.md        ← Phase 1 output
├── quickstart.md        ← Phase 1 output
├── contracts/
│   └── api.md           ← Phase 1 output
└── tasks.md             ← /speckit-tasks output (NOT created here)
```

### Source Code

```text
# NEW: Python agent service
agent/
├── pyproject.toml                      ← Poetry (Python 3.11+)
├── Dockerfile                          ← playwright/python:v1.44.0-jammy base
├── .env.example                        ← DATABASE_URL, LLM_*, LANGCHAIN_*, ENVIRONMENT
├── agent/
│   ├── daemon.py                       ← asyncio polling loop (3s, FOR UPDATE SKIP LOCKED)
│   ├── config.py                       ← pydantic-settings
│   ├── db.py                           ← asyncpg pool + query functions
│   ├── models.py                       ← RawJob, NormalisedJob, DiscoveryState (Pydantic)
│   ├── normalise.py                    ← URL normalisation + rapidfuzz dedup
│   ├── graphs/
│   │   └── discovery.py                ← LangGraph fan-out graph
│   └── scrapers/
│       ├── base.py                     ← AbstractScraper ABC
│       ├── linkedin.py                 ← Playwright + playwright-stealth
│       ├── naukri.py                   ← requests + BS4 (JSON endpoint)
│       ├── iimjobs.py                  ← requests + BS4 (HTML)
│       └── careers_page.py             ← Playwright (JS-rendered)
└── tests/
    ├── conftest.py
    ├── unit/
    │   ├── test_normalise.py
    │   ├── test_naukri.py
    │   ├── test_iimjobs.py
    │   └── test_linkedin.py
    └── fixtures/
        ├── naukri_response.json
        ├── iimjobs_page.html
        └── linkedin_search.html

# MODIFIED: Next.js app
src/
├── db/
│   └── schema.ts               ← +pipelineJobStatusEnum, +jobStatusEnum,
│                                  +pipelineJobs, +pipelineRuns, +jobs, +scanHistory
├── app/api/pipeline/
│   ├── trigger/route.ts        ← POST: enqueue pipeline_jobs row
│   └── [jobId]/
│       ├── status/route.ts     ← GET: snapshot from Neon
│       └── stream/route.ts     ← GET: SSE via native ReadableStream
├── lib/
│   └── api.ts                  ← +triggerPipeline(), +getPipelineStatus()
└── app/dashboard/page.tsx      ← Wire "Run Pipeline" button to trigger endpoint

# NEW: Docker Compose
docker-compose.yml              ← nextjs + agent services

# NEW: Drizzle migration (auto-generated)
migrations/XXXX_job_discovery_tables.sql
```

## Complexity Tracking

*No constitution violations.*

---

## Phase 0 — Research Summary

All unknowns resolved. See [research.md](research.md) for full rationale.

| Question | Decision |
|---|---|
| LinkedIn scraping | Playwright + playwright-stealth; 50 results/query; skip on 429 |
| Naukri / iimjobs | requests + BS4; Naukri JSON API endpoint; iimjobs paginated HTML |
| Fuzzy dedup | `rapidfuzz token_sort_ratio ≥ 85` on normalised `(company + title)` |
| LangGraph fan-out | `Send` API; per-source nodes; `Annotated[list, operator.add]` reducer |
| Python service layout | `agent/` at repo root; Poetry; Playwright Docker base image |
| Table ownership | Drizzle schema (Next.js) owns tables; Python reads via asyncpg |

---

## Phase 1 — Design Artifacts

- **[data-model.md](data-model.md)** — 4 tables, enums, indexes, Pydantic models, state machine, migration steps
- **[contracts/api.md](contracts/api.md)** — POST /trigger, GET /status, GET /stream, GET /health with full request/response schemas
- **[quickstart.md](quickstart.md)** — local dev (both services) + Docker Compose + LangSmith + common issues

---

## Implementation Phases

### Phase A — Database Schema + Drizzle Migration

**Deliverable**: 4 new tables in Neon. TypeScript types exported.

**Skill gate**: `superpowers:test-driven-development` — write type-level tests (TypeScript `satisfies`) for new Drizzle insert types before schema changes land.

| Step | File | Action |
|---|---|---|
| A1 | `src/db/schema.ts` | Add `pipelineJobStatusEnum` pgEnum: `queued`, `running`, `completed`, `failed` |
| A2 | `src/db/schema.ts` | Add `jobStatusEnum` pgEnum: `discovered`, `scored`, `awaiting`, `approved`, `rejected`, `snoozed`, `score_failed`, `resume_failed` |
| A3 | `src/db/schema.ts` | Add `pipelineJobs` table (per data-model.md) |
| A4 | `src/db/schema.ts` | Add `pipelineRuns` table |
| A5 | `src/db/schema.ts` | Add `jobs` table with composite indexes on `(candidate_id, status)` and `(candidate_id, source_url)` |
| A6 | `src/db/schema.ts` | Add `scanHistory` table with unique constraint on `(candidate_id, url)` |
| A7 | CLI | `npm run db:generate` → review generated SQL migration |
| A8 | CLI | `npm run db:migrate` → apply to Neon |
| A9 | CLI | `npx tsc --noEmit` → zero errors |

---

### Phase B — Next.js API Layer (TDD)

**Deliverable**: 3 Route Handlers, tested, with mocked Drizzle client.

**Skill gate**: `superpowers:test-driven-development` — failing Vitest tests written before each route.

| Step | File | Action |
|---|---|---|
| B1 | `src/__tests__/api/pipeline/trigger.test.ts` | Write failing tests: happy path returns `{jobId, status:'queued'}` as 201; 409 when job already running; 400 on missing jobType |
| B2 | `src/app/api/pipeline/trigger/route.ts` | Implement: `getOrCreateCandidate()`, check for existing running job (409), insert `pipeline_jobs`, return 201 |
| B3 | Verify | `npx vitest run src/__tests__/api/pipeline/trigger.test.ts` — all pass |
| B4 | `src/__tests__/api/pipeline/status.test.ts` | Write failing tests: 200 with run data; 404 for unknown jobId |
| B5 | `src/app/api/pipeline/[jobId]/status/route.ts` | Implement: join `pipeline_jobs` + `pipeline_runs`, validate ownership, return snapshot |
| B6 | Verify | Tests pass |
| B7 | `src/__tests__/api/pipeline/stream.test.ts` | Write failing tests: SSE events emitted in correct order; stream closes on terminal state |
| B8 | `src/app/api/pipeline/[jobId]/stream/route.ts` | Implement: `ReadableStream`, 2s poll, push `status_update` / `completed` / `failed` events |
| B9 | Verify | Tests pass |
| B10 | `src/lib/api.ts` | Add `triggerPipeline()`, `getPipelineStatus()` |
| B11 | `src/app/dashboard/page.tsx` | Wire "Run Pipeline" button: call `triggerPipeline()`, show status pill |
| B12 | CLI | `npm run test:run` — all 45+ tests pass; `npx tsc --noEmit` — zero errors |

---

### Phase C — Python Agent Service Bootstrap

**Deliverable**: Daemon starts, connects to Neon, polls every 3s, handles SIGTERM.

**Skill gate**: `superpowers:test-driven-development` — test `claim_pipeline_job()` with asyncpg fixtures before implementation.

| Step | File | Action |
|---|---|---|
| C1 | `agent/pyproject.toml` | Create Poetry manifest with all pinned dependencies |
| C2 | `agent/agent/config.py` | pydantic-settings: `DATABASE_URL`, `LLM_PROVIDER`, `LLM_MODEL`, `LANGCHAIN_*`, `ENVIRONMENT`, `POLLING_INTERVAL_SECONDS=3` |
| C3 | `agent/tests/unit/test_db.py` | Write failing tests: `claim_pipeline_job()` returns job when one is queued; returns `None` when queue is empty |
| C4 | `agent/agent/db.py` | asyncpg pool; `claim_pipeline_job()` with `FOR UPDATE SKIP LOCKED`; `update_pipeline_job_status()`; `insert_pipeline_run()`; `update_pipeline_run()` |
| C5 | Verify | `poetry run pytest tests/unit/test_db.py -v` — all pass |
| C6 | `agent/agent/models.py` | `RawJob`, `NormalisedJob`, `SourceError`, `RunSummary`, `DiscoveryState` Pydantic models |
| C7 | `agent/agent/daemon.py` | `asyncio` main loop: poll every 3s, `asyncio.sleep`, claim job, dispatch to LangGraph, SIGTERM handler |
| C8 | `agent/agent/` | Minimal `GET /health` FastAPI endpoint on port 8001 in background thread |
| C9 | `agent/Dockerfile` | `mcr.microsoft.com/playwright/python:v1.44.0-jammy`; `poetry install --no-dev`; `playwright install chromium` |
| C10 | `docker-compose.yml` | `nextjs` service + `agent` service; shared `DATABASE_URL` env |
| C11 | Smoke test | Start daemon locally; confirm 3s polling logs; confirm SIGTERM exits cleanly |

---

### Phase D — Scrapers (TDD per source)

**Deliverable**: 4 scrapers passing fixture-based unit tests. Zero live network calls in tests.

**Skill gate**: `superpowers:test-driven-development` — fixture created and test written before each scraper implementation.

**D1 — Abstract Base**:
| Step | File | Action |
|---|---|---|
| D1a | `agent/scrapers/base.py` | `AbstractScraper` ABC: `async def scrape(queries: list[str], preferences: dict) -> list[RawJob]` |

**D2 — Naukri (TDD)**:
| Step | File | Action |
|---|---|---|
| D2a | `agent/tests/fixtures/naukri_response.json` | Capture real Naukri API response structure (anonymised) |
| D2b | `agent/tests/unit/test_naukri.py` | Failing tests: extracts title/company/location/source_url from fixture; skips records missing title; handles empty results |
| D2c | `agent/scrapers/naukri.py` | Implement: requests GET to Naukri JSON endpoint; parse response; 30s retry on failure; return `list[RawJob]` |
| D2d | Verify | `poetry run pytest tests/unit/test_naukri.py -v` — all pass |

**D3 — iimjobs (TDD)**:
| Step | File | Action |
|---|---|---|
| D3a | `agent/tests/fixtures/iimjobs_page.html` | Capture real iimjobs search result page (anonymised) |
| D3b | `agent/tests/unit/test_iimjobs.py` | Failing tests: extracts all job cards; handles pagination marker; empty page returns `[]` |
| D3c | `agent/scrapers/iimjobs.py` | Implement: requests GET; BS4 parse; follow pagination up to 3 pages |
| D3d | Verify | Tests pass |

**D4 — LinkedIn (TDD with fixture HTML)**:
| Step | File | Action |
|---|---|---|
| D4a | `agent/tests/fixtures/linkedin_search.html` | Capture rendered LinkedIn search results HTML (anonymised) |
| D4b | `agent/tests/unit/test_linkedin.py` | Failing tests: parses job cards from fixture HTML; returns `[]` on 429 fixture response |
| D4c | `agent/scrapers/linkedin.py` | Implement: Playwright async; playwright-stealth; 2–4s random delay; parse job cards; skip (log + return `[]`) on 429 / CAPTCHA |
| D4d | Verify | Tests pass |

**D5 — Careers Page (TDD)**:
| Step | File | Action |
|---|---|---|
| D5a | `agent/tests/fixtures/careers_page.html` | Fixture for a JS-rendered careers page |
| D5b | `agent/tests/unit/test_careers_page.py` | Failing tests: renders JS content before parsing; returns `[]` on no jobs found |
| D5c | `agent/scrapers/careers_page.py` | Implement: Playwright; `page.wait_for_selector` before parse; heuristic CSS selectors for common career page frameworks |
| D5d | Verify | Tests pass |

---

### Phase E — Normalisation & Deduplication (TDD)

**Deliverable**: Dedup logic with 100% test coverage on known duplicate and non-duplicate pairs.

**Skill gate**: `superpowers:test-driven-development` — all test cases written and confirmed failing before `normalise.py` is touched.

| Step | File | Action |
|---|---|---|
| E1 | `agent/tests/unit/test_normalise.py` | Write failing tests covering: URL normalisation (lowercase, strip irrelevant query params); exact URL dedup returns `is_duplicate=True`; "Head of AI" vs "Head, AI" at same company → duplicate; "Head of AI" vs "Head of Data" same company → NOT duplicate; abbreviation expansion (`vp` → `vice president`) |
| E2 | Verify | `poetry run pytest tests/unit/test_normalise.py -v` — all fail (not yet implemented) |
| E3 | `agent/normalise.py` | Implement: URL normaliser, `build_dedup_key()`, `is_fuzzy_duplicate()` (rapidfuzz token_sort_ratio ≥ 85), `deduplicate_batch()` |
| E4 | Verify | All tests pass |

---

### Phase F — LangGraph Discovery Graph

**Deliverable**: Full fan-out graph wired. Integration test with mocked scrapers confirms end-to-end flow.

| Step | File | Action |
|---|---|---|
| F1 | `agent/graphs/discovery.py` | Implement `build_queries` node: generates 5–8 queries per source from `preferences` |
| F2 | `agent/graphs/discovery.py` | Implement `fan_out` node: returns `[Send("scrape_linkedin", ...), Send("scrape_naukri", ...), ...]` |
| F3 | `agent/graphs/discovery.py` | Implement `scrape_<source>` nodes: call respective scraper, append to `raw_jobs` via reducer |
| F4 | `agent/graphs/discovery.py` | Implement `normalise_and_dedup` node: calls `normalise.py`, checks scan_history, splits new vs duped |
| F5 | `agent/graphs/discovery.py` | Implement `persist_jobs` node: bulk-insert `NormalisedJob` records to `jobs` + `scan_history` |
| F6 | `agent/graphs/discovery.py` | Implement `write_run_summary` node: updates `pipeline_runs` status, counts, per-source summary |
| F7 | `agent/daemon.py` | Wire daemon to invoke `discovery_graph.ainvoke(state)` on `discovery_only` jobs |
| F8 | `agent/graphs/discovery.py` | Add LangSmith trace tags: `candidate_id`, `pipeline_job_id` via `RunnableConfig` |
| F9 | `agent/tests/unit/test_discovery_graph.py` | Integration test with all scrapers mocked: assert `jobs` records created, `pipeline_runs.status = completed`, `scan_history` populated |
| F10 | Verify | `poetry run pytest tests/ -v` — all pass |

---

### Phase G — Final Verification

**Deliverable**: Both services working end-to-end. All tests green. Clean build.

**Skill gate**: `superpowers:verification-before-completion` — mandatory before PR.

| Step | Action |
|---|---|
| G1 | `npm run test:run` — all Next.js tests pass |
| G2 | `poetry run pytest tests/ -v` — all Python tests pass |
| G3 | `npx tsc --noEmit` — zero TypeScript errors |
| G4 | `npm run build` — clean production build, no prerender errors |
| G5 | Manual smoke test: start both services; click "Run Pipeline"; verify SSE updates in browser Network tab; verify `pipeline_runs` + `jobs` rows in `npm run db:studio` |
| G6 | Invoke `superpowers:verification-before-completion` — confirm all checklist items pass |
| G7 | Final commit + push |
