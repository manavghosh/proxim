# Tasks: Job Discovery Agent (F2)

**Input**: Design documents from `specs/001-job-discovery-agent/`
**Branch**: `001-job-discovery-agent`
**Date**: 2026-04-30
**Spec**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md) | **Data Model**: [data-model.md](data-model.md) | **Contracts**: [contracts/api.md](contracts/api.md)

> **Skill gates embedded below.**
> — Before any implementation task: invoke `superpowers:test-driven-development`
> — Before any PR/completion claim: invoke `superpowers:verification-before-completion`
> — On any bug or test failure: invoke `superpowers:systematic-debugging`
> — On 2+ independent tasks: invoke `superpowers:dispatching-parallel-agents`

## Format: `[ID] [P?] [Story?] Description — file path`

- **[P]**: Parallelisable (different files, no unresolved dependencies)
- **[Story]**: Which user story this task serves (US1/US2/US3)
- **TDD gate** 🔴→🟢: Write the failing test first, confirm it fails, then implement

---

## Phase 1: Setup — Python Service + Docker

**Purpose**: Create the Python agent service structure and Docker config so both runtimes can be started.

- [x] T001 Create `agent/` directory at repository root with subdirectory structure: `agent/agent/scrapers/`, `agent/agent/graphs/`, `agent/tests/unit/`, `agent/tests/fixtures/`
- [x] T002 Create `agent/pyproject.toml` with pinned dependencies: `python = ">=3.11"`, `langgraph = "^0.4"`, `litellm = "^1.40"`, `asyncpg = "^0.29"`, `pydantic = "^2.7"`, `pydantic-settings = "^2.2"`, `playwright = "^1.44"`, `playwright-stealth = "^1.0"`, `beautifulsoup4 = "^4.12"`, `requests = "^2.31"`, `rapidfuzz = "^3.6"`, `structlog = "^24.1"`, `langsmith = "^0.1"`, `fastapi = "^0.115"`, `uvicorn = {extras=["standard"], version="^0.30"}` — dev: `pytest = "^8"`, `pytest-asyncio = "^0.23"`, `pytest-cov = "^5"`
- [x] T003 [P] Create `agent/Dockerfile` using base image `mcr.microsoft.com/playwright/python:v1.44.0-jammy`; `COPY pyproject.toml .`; `RUN pip install poetry && poetry install --no-dev`; `RUN playwright install chromium`; `CMD ["python", "-m", "agent.daemon"]`
- [x] T004 [P] Create `agent/.env.example` with keys: `DATABASE_URL=`, `LLM_PROVIDER=anthropic`, `LLM_MODEL=claude-sonnet-4-6`, `LANGCHAIN_TRACING_V2=false`, `LANGCHAIN_API_KEY=`, `LANGCHAIN_PROJECT=proxim-dev`, `ENVIRONMENT=development`, `POLLING_INTERVAL_SECONDS=3`, `AGENT_PORT=8001`
- [x] T005 Create `docker-compose.yml` at repo root with two services: `nextjs` (build context `.`, port `3000:3000`, env `DATABASE_URL`) and `agent` (build context `agent/`, env from `agent/.env`, depends_on nextjs)
- [x] T006 Create `agent/agent/__init__.py`, `agent/agent/scrapers/__init__.py`, `agent/agent/graphs/__init__.py`, `agent/tests/__init__.py`, `agent/tests/unit/__init__.py`, `agent/tests/fixtures/` (empty placeholder fixtures)
- [x] T007 Create `agent/tests/conftest.py` with `asyncio_mode = "auto"` pytest config and shared fixtures for DB mocking

**Checkpoint ✅**: `cd agent && poetry install && poetry run playwright install chromium` completes without errors.

---

## Phase 2: Foundational — DB Schema, Config, Daemon Skeleton, Next.js Routes

**Purpose**: Core infrastructure that ALL user stories depend on. Must be complete before any story work.

> ⚠️ **CRITICAL**: No user story work can begin until this phase is complete.

### 🔵 Superpowers gate: invoke `superpowers:test-driven-development` before T012 and T020.

#### 2A — Drizzle Schema + Migration (Next.js)

- [x] T008 Add `pipelineJobStatusEnum` pgEnum to `src/db/schema.ts`: values `queued`, `running`, `completed`, `failed`
- [x] T009 Add `jobStatusEnum` pgEnum to `src/db/schema.ts`: values `discovered`, `scored`, `awaiting`, `approved`, `rejected`, `snoozed`, `score_failed`, `resume_failed`
- [x] T010 Add `pipelineJobs` table to `src/db/schema.ts` per data-model.md: columns `id`, `status`, `jobType`, `candidateId`, `payload`, `createdAt`, `startedAt`, `completedAt`, `error`
- [x] T011 Add `pipelineRuns` table to `src/db/schema.ts` per data-model.md: columns `id`, `pipelineJobId`, `candidateId`, `status`, `sourcesAttempted`, `sourcesSuccessful`, `jobsDiscovered`, `jobsDeduplicated`, `startedAt`, `completedAt`, `summary`, `error`
- [x] T012 Add `jobs` table to `src/db/schema.ts` per data-model.md: all columns including `jdRaw`, `jdText`, `source`, `sourceUrl`, `applicationUrl`, `postedAt`, `status`. Add indexes: `(candidateId, status)`, `(candidateId, sourceUrl)`
- [x] T013 Add `scanHistory` table to `src/db/schema.ts` per data-model.md: unique constraint on `(candidateId, url)`
- [x] T014 Run `npm run db:generate` — review generated migration in `migrations/` for correctness
- [x] T015 Run `npm run db:migrate` — confirm all 4 tables created in Neon
- [x] T016 Run `npx tsc --noEmit` — confirm zero TypeScript errors after schema additions

#### 2B — Python Config + DB Layer (TDD)

> 🔴→🟢 TDD gate: Write T017 first, confirm it FAILS, then implement T018.

- [x] T017 Write failing tests in `agent/tests/unit/test_db.py`: `test_claim_pipeline_job_returns_job_when_queued` (mock asyncpg, insert fixture queued job, assert job returned with status changed to `running`); `test_claim_pipeline_job_returns_none_when_empty` (empty queue, assert `None`); `test_update_pipeline_job_status_sets_completed` (assert `completed_at` set)
- [x] T018 Create `agent/agent/config.py` using `pydantic-settings`: `Settings` class with `database_url`, `llm_provider`, `llm_model`, `langchain_tracing_v2`, `langchain_api_key`, `langchain_project`, `environment`, `polling_interval_seconds=3`, `agent_port=8001`; export singleton `settings = Settings()`
- [x] T019 Create `agent/agent/db.py`: asyncpg connection pool (`create_pool`, `close_pool`); `claim_pipeline_job(pool)` with `FOR UPDATE SKIP LOCKED` — returns `PipelineJobRow | None`; `update_pipeline_job_status(pool, job_id, status, error=None)`; `insert_pipeline_run(pool, pipeline_job_id, candidate_id)`; `update_pipeline_run(pool, run_id, **kwargs)`; `get_scan_history_urls(pool, candidate_id)`; `bulk_insert_jobs(pool, jobs: list[dict])`; `bulk_insert_scan_history(pool, entries: list[dict])`
- [x] T020 Run `poetry run pytest tests/unit/test_db.py -v` — confirm all tests pass 🟢

#### 2C — Python Models

- [x] T021 [P] Create `agent/agent/models.py` with Pydantic v2 models: `RawJob` (title, company, location, jd_raw, source: Literal, source_url, application_url, posted_at); `NormalisedJob(RawJob)` (jd_text, is_duplicate, duplicate_of_url); `SourceError` (source, error, retried); `RunSummary` (sources dict, total_new, total_deduped, total_failed_sources); `DiscoveryState` (candidate_id, pipeline_job_id, preferences, queries, raw_jobs: Annotated[list[RawJob], operator.add], deduplicated_jobs, run_summary, errors: Annotated[list[SourceError], operator.add])

#### 2D — Python Daemon Skeleton + Health Endpoint

- [x] T022 Create `agent/agent/daemon.py`: `async def main()` with `asyncio.sleep(settings.polling_interval_seconds)` loop; `claim_pipeline_job()` call; job dispatch stub (logs "would run {job_type}"); SIGTERM handler that sets a stop event; `asyncio.run(main())`
- [x] T023 [P] Add minimal `GET /health` FastAPI endpoint in `agent/agent/health.py`: returns `{"status": "ok", "daemon": "running", "db_connected": bool}`; run in background thread on `settings.agent_port`; start from `daemon.py` via `threading.Thread`

#### 2E — Next.js API Routes (TDD)

> 🔴→🟢 TDD gate: Write T024, T026, T028 first, confirm they FAIL, then implement T025, T027, T029.

- [x] T024 Write failing Vitest tests in `src/__tests__/api/pipeline/trigger.test.ts`: mock Drizzle client; `test_returns_201_with_jobId_on_success`; `test_returns_409_when_job_already_running`; `test_returns_400_on_missing_jobType`
- [x] T025 Create `src/app/api/pipeline/trigger/route.ts`: `POST` handler; call `getOrCreateCandidate()`; query `pipeline_jobs` for existing `queued`/`running` row → 409; insert new `pipeline_jobs` row; return `{ jobId, status: 'queued', createdAt }` with 201
- [x] T026 Write failing Vitest tests in `src/__tests__/api/pipeline/status.test.ts`: `test_returns_200_snapshot_with_run_data`; `test_returns_404_for_unknown_jobId`
- [x] T027 Create `src/app/api/pipeline/[jobId]/status/route.ts`: `GET` handler; `await params`; join `pipeline_jobs` + `pipeline_runs`; validate candidate ownership; return snapshot per contracts/api.md
- [x] T028 Write failing Vitest tests in `src/__tests__/api/pipeline/stream.test.ts`: `test_emits_status_update_event`; `test_emits_completed_event_on_terminal_status`; `test_closes_stream_after_completed`
- [x] T029 Create `src/app/api/pipeline/[jobId]/stream/route.ts`: native `ReadableStream`; 2s Neon poll via `setInterval`; push `event: status_update\ndata: {...}` on change; push `event: completed` or `event: failed` and close on terminal state
- [x] T030 Add `triggerPipeline(jobType: string)` and `getPipelineStatus(jobId: string)` to `src/lib/api.ts`
- [x] T031 Run `npm run test:run` — all existing + new tests pass; `npx tsc --noEmit` — zero errors

**Checkpoint ✅ Foundation Ready**: 4 tables in Neon, daemon polls Neon every 3s, 3 Next.js routes return correct responses, all TypeScript and Python tests green.

---

## Phase 3: User Story 1 — Automated Job Discovery Run (Priority: P1) 🎯 MVP

**Goal**: Trigger a pipeline run; system generates queries, scrapes Naukri + iimjobs in parallel, stores discovered jobs with status `discovered`.

**Independent Test**: Run `POST /api/pipeline/trigger`, observe daemon picks up the job, verify ≥1 job record in `jobs` table after the run completes, `pipeline_runs.status = 'completed'`.

> 🔵 Invoke `superpowers:test-driven-development` before implementing T033 and T035.

### Abstract Scraper Base

- [x] T032 [P] Create `agent/agent/scrapers/base.py`: abstract class `AbstractScraper` with `async def scrape(self, queries: list[str], preferences: dict) -> list[RawJob]`; `source_name: str` class attribute; default retry wrapper logging errors + returning `[]` on exception

### Naukri Scraper (TDD)

- [x] T033 [P] [US1] Create fixture `agent/tests/fixtures/naukri_response.json` — capture real Naukri job search JSON response structure with 3 anonymised jobs (real field names, fake data)
- [x] T034 [P] [US1] Write failing tests in `agent/tests/unit/test_naukri.py`: `test_extracts_title_company_sourceurl`; `test_skips_records_missing_title`; `test_returns_empty_list_on_empty_results`; `test_returns_rawjob_with_correct_source_field` — all using `naukri_response.json` fixture, no live network calls
- [x] T035 [US1] Run `poetry run pytest tests/unit/test_naukri.py -v` — confirm all FAIL 🔴
- [x] T036 [US1] Create `agent/agent/scrapers/naukri.py`: `NaukriScraper(AbstractScraper)`; `source_name = "naukri"`; `scrape()` makes GET to `https://www.naukri.com/jobapi/v3/search` with `keyword`, `noOfResults=50`, `jobAge=3` params and realistic headers; parse JSON response; build `RawJob` list; 30s retry on error
- [x] T037 [US1] Run `poetry run pytest tests/unit/test_naukri.py -v` — confirm all PASS 🟢

### iimjobs Scraper (TDD)

- [x] T038 [P] [US1] Create fixture `agent/tests/fixtures/iimjobs_page.html` — capture real iimjobs search results HTML (anonymised, 3 job cards)
- [x] T039 [P] [US1] Write failing tests in `agent/tests/unit/test_iimjobs.py`: `test_extracts_all_job_cards`; `test_pagination_marker_detected`; `test_empty_page_returns_empty_list`; use `iimjobs_page.html` fixture
- [x] T040 [US1] Run `poetry run pytest tests/unit/test_iimjobs.py -v` — confirm all FAIL 🔴
- [x] T041 [US1] Create `agent/agent/scrapers/iimjobs.py`: `IimjobsScraper(AbstractScraper)`; `source_name = "iimjobs"`; requests GET with 1–2s delay between pages; BS4 parse job cards; follow pagination up to 3 pages; 30s retry on error
- [x] T042 [US1] Run `poetry run pytest tests/unit/test_iimjobs.py -v` — confirm all PASS 🟢

### LangGraph Discovery Graph — US1 Core

- [x] T043 [US1] Create `agent/agent/graphs/discovery.py`: define `DiscoveryState` (import from models.py); implement `build_queries` node — generates 5–8 queries per source from `preferences` (seniority_levels + geographic_preference); returns updated state with `queries` populated
- [x] T044 [US1] Implement `fan_out` node in `agent/agent/graphs/discovery.py`: returns `[Send("scrape_naukri", state), Send("scrape_iimjobs", state)]` (US1 scope — LinkedIn + careers page added in Phase 5)
- [x] T045 [US1] Implement `scrape_naukri` and `scrape_iimjobs` nodes in `agent/agent/graphs/discovery.py`: instantiate scraper, call `scrape(queries[source])`, append results to `raw_jobs` via reducer; catch errors → append to `errors` reducer
- [x] T046 [US1] Implement `persist_jobs` node in `agent/agent/graphs/discovery.py`: for each job in `deduplicated_jobs` where `is_duplicate = False`, call `bulk_insert_jobs()` and `bulk_insert_scan_history()`; update `pipeline_runs` via `update_pipeline_run()`
- [x] T047 [US1] Implement `write_run_summary` node in `agent/agent/graphs/discovery.py`: build `RunSummary`; call `update_pipeline_run()` with `status='completed'`, counts, summary JSON; call `update_pipeline_job_status()` with `'completed'`
- [x] T048 [US1] Wire LangGraph graph: `StateGraph(DiscoveryState)` → add all nodes → add edges; compile to `discovery_graph`
- [x] T049 [US1] Update `agent/agent/daemon.py`: replace stub dispatch with `await discovery_graph.ainvoke(state, config=RunnableConfig(tags=[candidate_id, pipeline_job_id]))`; set `LANGCHAIN_PROJECT` in `RunnableConfig` metadata
- [x] T050 [US1] Write integration test in `agent/tests/unit/test_discovery_graph.py`: mock both scrapers to return 2 fixture jobs each; mock DB calls; assert `deduplicated_jobs` has 4 entries, `run_summary.total_new == 4`, final `pipeline_jobs.status = 'completed'`
- [x] T051 [US1] Run `poetry run pytest tests/ -v` — all tests pass

### Wire Dashboard Trigger

- [x] T052 [US1] Update `src/app/dashboard/page.tsx`: wire "▶ Run Pipeline" button to `triggerPipeline('discovery_only')`; show toast/status pill when job is queued; poll `getPipelineStatus(jobId)` every 5s while status is `running`; show "Pipeline complete" on `completed`
- [x] T053 [US1] Run `npm run test:run` — all Next.js tests pass; `npx tsc --noEmit` — zero errors

**Checkpoint ✅ US1**: Trigger from Dashboard → daemon picks up → Naukri + iimjobs scraped in parallel → jobs in DB with status `discovered`. Verify via `npm run db:studio`.

---

## Phase 4: User Story 2 — Deduplication Across Sources (Priority: P2)

**Goal**: URL-exact and rapidfuzz dedup prevents duplicate jobs from appearing in the `jobs` table or pipeline.

**Independent Test**: Insert 2 fixture jobs with identical company + fuzzy title; trigger a mock run; assert only 1 job record in `jobs`, 2 entries in `scan_history` (one with `job_id=null`).

> 🔵 Invoke `superpowers:test-driven-development` before T055.

### Normalisation + Dedup (TDD)

- [x] T054 [P] [US2] Write failing tests in `agent/tests/unit/test_normalise.py`:
  `test_url_normalisation_lowercases_url`;
  `test_url_normalisation_strips_irrelevant_query_params`;
  `test_exact_url_dedup_marks_duplicate_true`;
  `test_fuzzy_dedup_head_of_ai_variants_are_duplicate` (same company, "Head of AI" vs "Head, Artificial Intelligence");
  `test_fuzzy_dedup_different_roles_not_duplicate` ("Head of AI" vs "Head of Data" same company);
  `test_abbreviation_expansion_vp_equals_vice_president`
- [x] T055 [US2] Run `poetry run pytest tests/unit/test_normalise.py -v` — confirm all FAIL 🔴
- [x] T056 [US2] Create `agent/agent/normalise.py`: `normalise_url(url: str) -> str`; `build_dedup_key(company: str, title: str) -> str` (lowercase, strip punctuation, expand abbreviations); `is_fuzzy_duplicate(key_a: str, key_b: str, threshold=85) -> bool` using `rapidfuzz.fuzz.token_sort_ratio`; `deduplicate_batch(jobs: list[RawJob], seen_urls: set[str], seen_keys: list[str]) -> list[NormalisedJob]`
- [x] T057 [US2] Run `poetry run pytest tests/unit/test_normalise.py -v` — confirm all PASS 🟢

### Wire Dedup into Discovery Graph

- [x] T058 [US2] Add `normalise_and_dedup` node to `agent/agent/graphs/discovery.py`: call `get_scan_history_urls()` from DB; call `deduplicate_batch()` against seen URLs and fuzzy keys; populate `state.deduplicated_jobs`; set `is_duplicate=True` on duplicates with `duplicate_of_url`
- [x] T059 [US2] Update graph edges in `agent/agent/graphs/discovery.py`: insert `normalise_and_dedup` between `collect` (fan-out merge point) and `persist_jobs`
- [x] T060 [US2] Update integration test `agent/tests/unit/test_discovery_graph.py`: add duplicate fixture (same URL as existing scan_history entry); assert `run_summary.total_deduped == 1`, duplicate not in `jobs` table, present in `scan_history` with `job_id=null`
- [x] T061 [US2] Run `poetry run pytest tests/ -v` — all tests pass

**Checkpoint ✅ US2**: Run with mock scraper returning duplicate URLs; verify `scan_history` has 2 entries, `jobs` table has 1, `pipeline_runs.jobs_deduplicated = 1`.

---

## Phase 5: User Story 3 — Target Company Direct Scraping (Priority: P3)

**Goal**: Candidate-configured target company careers pages scraped via Playwright. LinkedIn added as 4th parallel source.

**Independent Test**: Add 1 target company URL to preferences; trigger run with mocked Playwright returning fixture HTML; verify jobs from that page appear in `jobs` table with `source = 'careers_page'`.

> 🔵 Invoke `superpowers:test-driven-development` before T063 and T069.

### LinkedIn Scraper (TDD)

- [x] T062 [P] [US3] Create fixture `agent/tests/fixtures/linkedin_search.html` — rendered LinkedIn job search results HTML (anonymised, 3 job cards, realistic DOM structure)
- [x] T063 [P] [US3] Write failing tests in `agent/tests/unit/test_linkedin.py`: `test_parses_job_cards_from_fixture_html`; `test_returns_empty_list_on_429_response`; `test_source_field_is_linkedin` — use `linkedin_search.html` fixture; mock Playwright
- [x] T064 [US3] Run `poetry run pytest tests/unit/test_linkedin.py -v` — confirm FAIL 🔴
- [x] T065 [US3] Create `agent/agent/scrapers/linkedin.py`: `LinkedInScraper(AbstractScraper)`; `source_name = "linkedin"`; Playwright async context; apply `playwright_stealth`; navigate to LinkedIn job search; `page.wait_for_selector('.job-card-container')` with timeout; extract job cards; 2–4s random delay between navigations; on HTTP 429 or CAPTCHA detection → log warning + return `[]`
- [x] T066 [US3] Run `poetry run pytest tests/unit/test_linkedin.py -v` — confirm PASS 🟢

### Careers Page Scraper (TDD)

- [x] T067 [P] [US3] Create fixture `agent/tests/fixtures/careers_page.html` — representative JS-rendered careers page HTML (anonymised)
- [x] T068 [P] [US3] Write failing tests in `agent/tests/unit/test_careers_page.py`: `test_renders_js_content_before_parsing`; `test_returns_empty_list_when_no_jobs_found`; `test_source_field_is_careers_page`; mock Playwright page
- [x] T069 [US3] Run `poetry run pytest tests/unit/test_careers_page.py -v` — confirm FAIL 🔴
- [x] T070 [US3] Create `agent/agent/scrapers/careers_page.py`: `CareersPageScraper(AbstractScraper)`; `source_name = "careers_page"`; Playwright `page.goto(url)` + `page.wait_for_load_state('networkidle')`; heuristic selectors for common ATS platforms (Lever, Greenhouse, Workday, generic `<li>` job lists); extract title, company (from URL domain), job URL; map to `RawJob`
- [x] T071 [US3] Run `poetry run pytest tests/unit/test_careers_page.py -v` — confirm PASS 🟢

### Extend Graph to All 4 Sources

- [x] T072 [US3] Update `fan_out` node in `agent/agent/graphs/discovery.py`: add `Send("scrape_linkedin", state)` and `Send("scrape_careers_page", state)` alongside existing Naukri + iimjobs sends; read target company URLs from `preferences.target_companies`; skip careers page fan-out if no target companies configured
- [x] T073 [US3] Add `scrape_linkedin` and `scrape_careers_page` nodes to `agent/agent/graphs/discovery.py` following same pattern as existing scraper nodes
- [x] T074 [US3] Update integration test to include LinkedIn + careers page mock scraper; assert `run_summary.sources_attempted == 4`
- [x] T075 [US3] Run `poetry run pytest tests/ -v` — all tests pass

**Checkpoint ✅ US3**: All 4 sources scraped in parallel; careers page and LinkedIn jobs stored with correct `source` field.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Production hardening, final verification, documentation.

> 🔵 Invoke `superpowers:verification-before-completion` at T083 before final commit.

- [x] T076 [P] Add `structlog` structured logging throughout `agent/agent/daemon.py` and all scraper modules: log `candidate_id`, `pipeline_job_id`, `source`, `jobs_found`, `jobs_deduped` at INFO; log scraper errors at WARNING; log daemon poll cycle at DEBUG
- [x] T077 [P] Add run completion summary log to `write_run_summary` node: `structlog.info("discovery_run_complete", jobs_new=N, jobs_deduped=M, sources_ok=K, sources_failed=J)`
- [x] T078 [P] Add graceful Playwright browser cleanup to `agent/agent/scrapers/linkedin.py` and `agent/agent/scrapers/careers_page.py`: use `async with async_playwright()` context managers; ensure browser closes on error
- [x] T079 Update `specs/001-job-discovery-agent/quickstart.md` with any deviations found during implementation (port numbers, env var names, actual Docker Compose service names)
- [x] T080 Run full Next.js test suite: `npm run test:run` — all tests pass
- [x] T081 Run full Python test suite: `cd agent && poetry run pytest tests/ -v --cov=agent --cov-report=term-missing` — all tests pass, coverage ≥ 80% on `normalise.py`, `db.py`, scrapers
- [x] T082 Run `npx tsc --noEmit` — zero TypeScript errors
- [x] T083 Run `npm run build` — clean production build, zero prerender errors
- [x] T084 🔵 **Invoke `superpowers:verification-before-completion`** — complete all skill checklist items before proceeding to T085
- [x] T085 Manual smoke test: start both services locally; click "Run Pipeline" on Dashboard; watch browser Network tab for SSE `status_update` events; open `npm run db:studio` and confirm `pipeline_runs.status = 'completed'` and ≥1 row in `jobs`
- [x] T086 Final commit: `git add -A && git commit -m "feat: job discovery agent — F2 complete"`

---

## Dependencies & Execution Order

### Phase Dependencies

```
Phase 1 (Setup)
    └─► Phase 2 (Foundational) — BLOCKS all user stories
              ├─► Phase 3 (US1 — Automated Discovery) — MVP deliverable
              │       └─► Phase 4 (US2 — Deduplication)
              │               └─► Phase 5 (US3 — Target Company Scraping)
              │                       └─► Phase 6 (Polish)
              └─► (phases 4, 5 can start once Phase 3 graph is wired)
```

### User Story Dependencies

- **US1 (P1)**: Requires Phase 2 complete. Independent — delivers working discovery with Naukri + iimjobs.
- **US2 (P2)**: Requires Phase 3 complete (needs `DiscoveryState` + `persist_jobs` node to wire into). Dedup is a graph node, not a separate service.
- **US3 (P3)**: Requires Phase 3 complete (extends existing `fan_out` node). Can run in parallel with US2 after Phase 3.

### Within Each Phase

- TDD tasks (test writing) MUST complete and tests must **FAIL** before implementation tasks begin
- Models before services; services before graph nodes; graph nodes before daemon wiring
- `db.py` must pass tests before graph nodes call its functions

### Parallel Opportunities

Within Phase 2: T008–T013 (schema additions) can run in parallel with T018–T019 (Python config/db) since they touch different files.

Within Phase 3: T033–T034 (Naukri fixture+test) and T038–T039 (iimjobs fixture+test) are fully parallel — different files, no dependency.

Within Phase 5: T062–T063 (LinkedIn fixture+test) and T067–T068 (careers page fixture+test) are fully parallel.

Polish tasks T076, T077, T078 are all parallel (different files).

---

## Parallel Example: Phase 3 (US1)

```bash
# These 4 tasks can be dispatched in parallel (different files):
Task T033: Create agent/tests/fixtures/naukri_response.json
Task T034: Write agent/tests/unit/test_naukri.py (failing)
Task T038: Create agent/tests/fixtures/iimjobs_page.html
Task T039: Write agent/tests/unit/test_iimjobs.py (failing)

# Then sequentially (T035 before T036, T040 before T041):
Task T035: Confirm naukri tests fail
Task T036: Implement agent/agent/scrapers/naukri.py
Task T040: Confirm iimjobs tests fail
Task T041: Implement agent/agent/scrapers/iimjobs.py
```

---

## Implementation Strategy

### MVP First (US1 Only — ~4 days)

1. Complete Phase 1 (Setup)
2. Complete Phase 2 (Foundational)
3. Complete Phase 3 (US1)
4. **STOP and VALIDATE**: Trigger a run, verify jobs appear in DB from Naukri + iimjobs
5. MVP delivered: working end-to-end discovery pipeline

### Incremental Delivery

1. Phases 1–3 → US1 MVP: discovery running with 2 sources
2. Phase 4 → US2: deduplication prevents re-processing jobs across runs
3. Phase 5 → US3: 2 more sources (LinkedIn + target companies) added
4. Phase 6 → Production-hardened, fully verified

### Parallel Team Strategy

Once Phase 2 (Foundational) is complete:
- **Developer A**: US1 (Naukri + iimjobs scrapers + graph core)
- **Developer B**: US2 (normalise.py dedup + tests) — can work in parallel once T043 defines `DiscoveryState`
- **Developer C**: US3 fixture creation (T062–T063, T067–T068) — no code dependencies until graph extension (T072)

---

## Task Tracker Summary

| Phase | Tasks | Completed | Status |
|---|---|---|---|
| Phase 1: Setup | T001–T007 | 7/7 | ✅ Done |
| Phase 2: Foundational | T008–T031 | 24/24 | ✅ Done |
| Phase 3: US1 (Discovery) | T032–T053 | 22/22 | ✅ Done |
| Phase 4: US2 (Dedup) | T054–T061 | 8/8 | ✅ Done |
| Phase 5: US3 (Careers+LinkedIn) | T062–T075 | 14/14 | ✅ Done |
| Phase 6: Polish | T076–T086 | 11/11 | ✅ Done |
| **Total** | **T001–T086** | **86/86** | **100% complete** |

---

## Superpowers Skill Gate Summary

| Gate | When | Task ref |
|---|---|---|
| `superpowers:test-driven-development` | Before T017 (DB layer tests) | Phase 2 |
| `superpowers:test-driven-development` | Before T024 (Next.js route tests) | Phase 2 |
| `superpowers:test-driven-development` | Before T034 (Naukri scraper tests) | Phase 3 |
| `superpowers:test-driven-development` | Before T039 (iimjobs scraper tests) | Phase 3 |
| `superpowers:test-driven-development` | Before T054 (normalise tests) | Phase 4 |
| `superpowers:test-driven-development` | Before T063 (LinkedIn scraper tests) | Phase 5 |
| `superpowers:test-driven-development` | Before T068 (careers page tests) | Phase 5 |
| `superpowers:systematic-debugging` | On any test failure or unexpected behaviour | Any phase |
| `superpowers:dispatching-parallel-agents` | T033+T038 in parallel (Phase 3); T062+T067 in parallel (Phase 5) | Phases 3, 5 |
| `superpowers:verification-before-completion` | Before T085 (final smoke test and commit) | Phase 6 |
