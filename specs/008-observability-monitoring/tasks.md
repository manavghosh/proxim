# Tasks: Observability & Monitoring (F8)

**Input**: Design documents from `specs/008-observability-monitoring/`
**Prerequisites**: plan.md ✅ spec.md ✅ research.md ✅ data-model.md ✅ contracts/api.md ✅ quickstart.md ✅

**Organization**: Tasks grouped by user story. **No Neon schema migrations** — all observability data lives in external services (LangDB cloud, Grafana Tempo Docker, LangSmith cloud).

## Format: `[ID] [P?] [Story?] Description — file path`

- **[P]**: Can run in parallel (different files, no shared dependencies)
- **[Story]**: Which user story this task belongs to

---

## Phase 1: Setup

**Purpose**: Install new packages in both runtimes.

- [x] T001 Add Python observability packages to `agent/pyproject.toml`: `langdb-sdk = "^0.1"`, `opentelemetry-sdk = "^1.27"`, `opentelemetry-exporter-otlp-proto-grpc = "^1.27"`, `opentelemetry-instrumentation-httpx = "^0.48"` — run `cd agent && poetry add langdb-sdk opentelemetry-sdk opentelemetry-exporter-otlp-proto-grpc opentelemetry-instrumentation-httpx`
- [x] T002 [P] Add Next.js observability packages to `package.json`: `"@vercel/otel"` and `"@opentelemetry/exporter-trace-otlp-http"` — run `npm install @vercel/otel @opentelemetry/exporter-trace-otlp-http`
- [x] T003 [P] Create the `observability/` directory scaffold with empty placeholder files: `observability/otel-collector-config.yml`, `observability/tempo-config.yml`, `observability/prometheus.yml`, `observability/grafana/provisioning/datasources/datasources.yml`, `observability/grafana/provisioning/dashboards/dashboard-provider.yml`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Environment variables, Docker Compose observability stack, and Grafana provisioning config. MUST complete before any user story.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [x] T004 Extend `agent/agent/config.py` `Settings` class with new fields: `langdb_api_key: str = ""`, `langdb_project_id: str = ""`, `otel_exporter_otlp_endpoint: str = "http://localhost:4317"`, `otel_service_name: str = "proxim-agent"` — `agent/agent/config.py`
- [x] T005 [P] Create `docker-compose.observability.yml` with four services: `otel-collector` (image: `otel/opentelemetry-collector-contrib:0.107.0`, ports 4317/4318), `tempo` (image: `grafana/tempo:2.5.0`, port 3200), `prometheus` (image: `prom/prometheus:v2.53.1`, port 9090), `grafana` (image: `grafana/grafana:11.1.0`, port 3001 mapped from 3000, mounts `observability/grafana/provisioning` to `/etc/grafana/provisioning`) — `docker-compose.observability.yml`
- [x] T006 [P] Fill `observability/otel-collector-config.yml`: receivers (otlp grpc 4317, http 4318), batch processor, exporters (otlp/tempo to `tempo:4317` with `tls.insecure: true`, prometheus on 8889), service pipelines for traces and metrics — `observability/otel-collector-config.yml`
- [x] T007 [P] Fill observability config files: `observability/tempo-config.yml` (local filesystem storage, OTLP receiver), `observability/prometheus.yml` (scrape target: `otel-collector:8889`), `observability/grafana/provisioning/datasources/datasources.yml` (Tempo datasource at `http://tempo:3200`, Prometheus datasource at `http://prometheus:9090`), `observability/grafana/provisioning/dashboards/dashboard-provider.yml` (file provider scanning `/etc/grafana/provisioning/dashboards`) — four files
- [x] T008 [P] Update `agent/.env.example` with new vars: `LANGDB_API_KEY`, `LANGDB_PROJECT_ID`, `OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4317`, `OTEL_SERVICE_NAME=proxim-agent`; update `.env.example` with `OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318`, `OTEL_SERVICE_NAME=proxim-nextjs` — `agent/.env.example` and `.env.example`

**Checkpoint**: `docker compose -f docker-compose.yml -f docker-compose.observability.yml up -d` starts all 4 observability services. `curl http://localhost:13133/` returns 200 (OTel Collector health). Grafana reachable at http://localhost:3001.

---

## Phase 3: User Story 1 — LLM Cost Tracking and Audit Trail (Priority: P1) 🎯 MVP

**Goal**: Every `litellm.completion()` and `litellm.acompletion()` call in the Python agent is tracked by LangDB with agent name, feature, token counts, cost (USD), and latency. Instrumentation is fire-and-forget — no LLM call ever blocks on observability failure.

**Independent Test**: Run a scoring pipeline job, then open the LangDB dashboard. Verify 3 call records exist for the scoring run (score_job, _score_block_a, _generate_report), each with `agent_name: "scoring_engine"`, `feature: "scoring"`, and non-zero token counts. Verify a call with invalid API key still completes (no exception propagation).

- [x] T015 [US1] **[TDD: RED — run first, confirm failing before T009]** Write unit tests for LangDB tracker in `agent/tests/unit/test_llm_tracker.py`: (a) `configure_langdb` is a no-op when `langdb_api_key` is empty — `litellm.callbacks` must remain empty; (b) `configure_langdb` does not raise even if the LangDB SDK import fails (mock `importlib.import_module` to raise `ImportError`); run `cd agent && poetry run pytest tests/unit/test_llm_tracker.py` and confirm both tests FAIL (ImportError or NameError expected) before proceeding to T009 — `agent/tests/unit/test_llm_tracker.py`
- [x] T009 [US1] **[TDD: GREEN — after T015 confirmed failing]** Create `agent/agent/llm_tracker.py` with `configure_langdb(settings: Settings) -> None`: if `settings.langdb_api_key` is empty string, return immediately (no-op); otherwise import `langdb` SDK, create a callback instance with api_key and project_id, register via `litellm.callbacks = [callback]`; wrap entire function in try/except that logs WARNING and returns on any exception (graceful degradation — see Edge Cases in spec) — `agent/agent/llm_tracker.py`
- [x] T010 [US1] Wire `configure_langdb(settings)` call at the start of `main()` in `agent/agent/daemon.py`, BEFORE the polling loop starts — `agent/agent/daemon.py`
- [x] T011 [P] [US1] Add `metadata={"agent_name": "scoring_engine", "feature": "scoring", "job_id": job_id, "run_id": run_id}` kwarg to all 3 `litellm.completion()` calls in `agent/agent/scoring_engine.py`: `score_job()` (line ~271), `_score_block_a()` (line ~366), `_generate_report()` (line ~383); pass `job_id` and `run_id` through function signatures as needed — `agent/agent/scoring_engine.py`
- [x] T012 [P] [US1] Add `metadata={"agent_name": "resume_engine", "feature": "resume", "job_id": job_id, "run_id": run_id}` kwarg to `litellm.completion()` in `_call_llm()` function in `agent/agent/resume_engine.py`; update `_call_llm` signature to accept `job_id: str | None = None` and `run_id: str | None = None` params and thread them from the calling graph node via graph state — do NOT hardcode `None` (preserves FR-003 aggregate views per job) — `agent/agent/resume_engine.py`
- [x] T013 [P] [US1] Add `metadata={"agent_name": "linkedin_connector", "feature": "linkedin", "job_id": job_id, "run_id": None}` kwarg to 2 `litellm` call sites in `agent/agent/nodes/linkedin_connector.py`: `generate_notes_node()` (litellm.completion) and `determine_target_roles()` (litellm.acompletion) — `agent/agent/nodes/linkedin_connector.py`
- [x] T014 [P] [US1] Add `metadata={"agent_name": "outreach_mailer", "feature": "email", "job_id": job_id, "run_id": None}` kwarg to the 2 `litellm.acompletion()` calls in `agent/agent/nodes/outreach_mailer.py` (both email draft generation calls at lines ~189 and ~231) — `agent/agent/nodes/outreach_mailer.py`

**Checkpoint**: Run `cd agent && poetry run pytest tests/unit/test_llm_tracker.py` — 2 tests pass. With `LANGDB_API_KEY` set in `agent/.env`, run one scoring job and verify LangDB dashboard shows call records.

---

## Phase 4: User Story 2 — End-to-End Distributed Tracing (Priority: P2)

**Goal**: Every pipeline run produces a root OTel span with child spans for each agent stage. Spans include `job_id`, `agent_name`, `model`, `source`, and duration. All spans visible in Grafana Tempo within 30 seconds of run completion. Three Grafana dashboards provisioned: System Health, Pipeline Performance, Cost Monitoring.

**Independent Test**: Run a full pipeline job end-to-end with the observability stack running. In Grafana Tempo (`http://localhost:3001/explore`), search `service_name="proxim-agent"` — verify a root `pipeline_run` span exists with child spans for `discovery`, `scoring`, `resume_generation`. Verify `score_job` child span has `job_id` and `model` attributes. Open http://localhost:3001/dashboards — verify three dashboards exist and load within 3 seconds.

- [x] T016 [US2] Create `agent/agent/telemetry.py`: `init_telemetry(settings: Settings) -> None` initialises the OTel SDK with `Resource({"service.name": settings.otel_service_name})`; if `settings.otel_exporter_otlp_endpoint` is empty, sets up a `NoOpTracer` (graceful degradation); otherwise configures `OTLPSpanExporter` (GRPC) + `BatchSpanProcessor` + `TracerProvider`; exports `get_tracer() -> Tracer` singleton; also calls `HTTPXClientInstrumentor().instrument()` for automatic outbound HTTP spans — `agent/agent/telemetry.py`
- [x] T017 [US2] Wire `init_telemetry(settings)` call in `agent/agent/daemon.py` `main()`, immediately after `configure_langdb(settings)` — `agent/agent/daemon.py`
- [x] T018 [P] [US2] Wrap key node functions in `agent/agent/graphs/scoring.py` with OTel spans using `tracer.start_as_current_span(...)`: create a root `scoring` span at graph entry, and `score_job` child span per job with attributes `agent_name="scoring"`, `job_id`, `pipeline_run_id`, `model`; set `span.set_attribute("error", True)` and `span.set_attribute("error.message", str(exc))` on exceptions — `agent/agent/graphs/scoring.py`
- [x] T019 [P] [US2] Wrap key node functions in `agent/agent/graphs/resume_builder.py` with OTel spans: root `resume_generation` span with `agent_name="resume_builder"`, `job_id`, `pipeline_run_id`; child spans for `personalise_resume` and `self_review` with `model` attribute; also add a `hitl_checkpoint` child span at the `interrupt_before` HITL node with attributes `agent_name="hitl"`, `job_id`, `pipeline_run_id`, `checkpoint_type="outreach_approval"` — fulfils FR-007 HITL checkpoint span requirement — `agent/agent/graphs/resume_builder.py`
- [x] T020 [P] [US2] Wrap key node functions in `agent/agent/graphs/discovery.py` with OTel spans: root `discovery` span with `agent_name="discovery"`, `pipeline_run_id`; child spans for each scraper invocation with `source` attribute (e.g. `"linkedin"`, `"naukri"`) — `agent/agent/graphs/discovery.py`
- [x] T021 [P] [US2] Wrap the fetch_jds graph entry in `agent/agent/graphs/fetch_jds.py` with a single OTel span: `fetch_jds` with `agent_name="fetch_jds"`, `pipeline_run_id`, `candidate_id` — `agent/agent/graphs/fetch_jds.py`
- [x] T021a [P] [US2] Wrap outreach node functions in `agent/agent/nodes/linkedin_connector.py` and `agent/agent/nodes/outreach_mailer.py` with OTel spans: `outreach_linkedin` span wrapping `generate_notes_node()` with attributes `agent_name="linkedin_connector"`, `job_id`, `pipeline_run_id`; `outreach_email` span wrapping each email draft generation call in `outreach_mailer.py` with `agent_name="outreach_mailer"`, `job_id`, `pipeline_run_id`; set `span.set_attribute("error", True)` and `span.set_attribute("error.message", str(exc))` on exceptions — fulfils FR-007 outreach span requirement — `agent/agent/nodes/linkedin_connector.py`, `agent/agent/nodes/outreach_mailer.py`
- [x] T022 [US2] Create `src/instrumentation.ts`: import `registerOTel` from `@vercel/otel`; export `register()` function that calls `registerOTel({ serviceName: process.env.OTEL_SERVICE_NAME ?? 'proxim-nextjs' })`; this auto-instruments all Next.js Route Handlers — `src/instrumentation.ts`
- [x] T023 [P] [US2] Add `experimental: { instrumentationHook: true }` to the existing `config` object in `next.config.ts` — `next.config.ts`
- [x] T024 [P] [US2] Create three Grafana dashboard JSON files with UID, title, and panels using Tempo/Prometheus datasources: `system-health.json` (panels: API p50/p99 latency from Tempo `http.route` spans, error rate), `pipeline-performance.json` (panels: scoring latency, resume generation latency by `pipeline_run_id`), `cost-monitoring.json` (panels: `llm.token_count.prompt + llm.token_count.completion` summed per `agent_name` per day, estimated cost via Grafana variable `$token_cost_per_k` defaulting to `0.003`) — three files in `observability/grafana/provisioning/dashboards/`

**Checkpoint**: Grafana Tempo shows spans from `proxim-agent` service. `service_name="proxim-nextjs"` spans visible for Next.js route calls. Three dashboards load in Grafana at http://localhost:3001/dashboards.

---

## Phase 5: User Story 3 — Development Tracing with LangSmith (Priority: P3)

**Goal**: In dev/staging, `LANGCHAIN_TRACING_V2=true` enables automatic LangSmith tracing for all LangGraph runs with zero code changes. A startup assertion warns (but does not crash) if LangSmith is accidentally enabled in production.

**Independent Test**: Set `LANGCHAIN_TRACING_V2=true` and `LANGCHAIN_API_KEY` in `agent/.env` with `ENVIRONMENT=development`. Run a scoring job. Open LangSmith → `proxim-dev` project — verify a run exists with all nodes, state transitions, and LLM call prompts/responses visible. Then set `ENVIRONMENT=production` and restart daemon — verify CRITICAL log warning appears and daemon still starts.

- [x] T025 [US3] Add `_check_langsmith_guard(settings: Settings) -> None` function to `agent/agent/daemon.py`: if `settings.environment == "production"` and `settings.langchain_tracing_v2 is True`, call `logger.critical("langsmith_active_in_production", message="LANGCHAIN_TRACING_V2=true in production — set to false immediately")` — warning only, do NOT raise or exit; call `_check_langsmith_guard(settings)` from `main()` before the polling loop — `agent/agent/daemon.py`
- [x] T026 [P] [US3] Update `agent/.env.example` to document LangSmith vars with production-safety comments: `LANGCHAIN_TRACING_V2=false  # Set true in dev/staging ONLY — never production`, `LANGCHAIN_API_KEY=  # LangSmith API key`, `LANGCHAIN_PROJECT=proxim-dev  # LangSmith project name`, `ENVIRONMENT=development  # development | staging | production` — `agent/.env.example`
- [x] T027 [P] [US3] Verify LangSmith auto-wiring: confirm `agent/agent/config.py` already exposes `langchain_tracing_v2`, `langchain_api_key`, `langchain_project` fields (they do — set by LangChain env var auto-detection); add a doc comment in `daemon.py` explaining that LangGraph reads `LANGCHAIN_TRACING_V2` and `LANGCHAIN_API_KEY` from env automatically — no explicit wiring needed; document in `agent/.env.example` that `LANGCHAIN_PROJECT` env var (not `langchain_project` settings field) is used by LangSmith — `agent/agent/daemon.py` (comment only)

**Checkpoint**: LangSmith dashboard shows `proxim-dev` project with traces when `LANGCHAIN_TRACING_V2=true`. Production guard CRITICAL log visible in daemon stdout when `ENVIRONMENT=production` + `LANGCHAIN_TRACING_V2=true`.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [x] T028 [P] Run `cd agent && poetry run pytest tests/unit/test_llm_tracker.py -v` — must show 2 tests passing with no warnings
- [x] T029 [P] Run `npm run build` — must complete with exit 0 and zero prerender errors (verifies `instrumentation.ts` compiles cleanly with Next.js 15)
- [x] T030 Run end-to-end quickstart validation per `specs/008-observability-monitoring/quickstart.md`: start observability stack, verify Grafana reachable, run a scoring job, check LangDB dashboard for call records, check Tempo for spans, verify all 3 Grafana dashboards load

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (Foundational)**: Depends on Phase 1 — BLOCKS all user stories (Docker Compose + config must be ready)
- **Phase 3 (US1)**: Depends on Phase 2 — needs `config.py` settings and `poetry add` complete
- **Phase 4 (US2)**: Depends on Phase 2 (needs config + Docker stack) and Phase 3 (daemon.py already has startup wiring from T010/T017)
- **Phase 5 (US3)**: Depends on Phase 2 only — LangSmith is already wired in config.py
- **Phase 6 (Polish)**: Depends on all desired story phases

### Within-Phase Dependencies

**Phase 3 (US1)**:
- T015 must complete FIRST (TDD RED phase) — confirm tests fail before T009 starts
- T009 (`llm_tracker.py`) must complete after T015 (GREEN phase) and before T010 (daemon wiring)
- T011, T012, T013, T014 can run in parallel (different files, after T010)

**Phase 4 (US2)**:
- T016 (`telemetry.py`) must complete before T017 (daemon wiring)
- T017 must complete before T018–T021a (graphs and node files import `get_tracer()` from telemetry)
- T018, T019, T020, T021, T021a can run in parallel (different graph/node files)
- T022, T023 can run in parallel with T016–T021a (Next.js — different runtime)
- T024 can run in parallel with T016–T023 (JSON files only)

**Phase 5 (US3)**:
- T025, T026, T027 can run in parallel (different aspects, different files)

---

## Parallel Execution Examples

### Phase 2 — All foundational tasks are independent

```
T005 (docker-compose.observability.yml)   ← parallel
T006 (otel-collector-config.yml)          ← parallel
T007 (grafana provisioning files)         ← parallel
T008 (.env.example files)                 ← parallel
```

### Phase 3 — US1 LLM call site metadata

```
T015 (test_llm_tracker.py)                ← FIRST (TDD RED — must fail before T009)
T009 (llm_tracker.py)                     ← SECOND (TDD GREEN — after T015 confirmed failing)
T010 (daemon.py wiring)                   ← THIRD (after T009)
T011 (scoring_engine.py)                  ← parallel after T010
T012 (resume_engine.py)                   ← parallel after T010
T013 (linkedin_connector.py)              ← parallel after T010
T014 (outreach_mailer.py)                 ← parallel after T010
```

### Phase 4 — US2 graph spans (all different graph/node files)

```
T018  (graphs/scoring.py)                 ← parallel
T019  (graphs/resume_builder.py)          ← parallel (now includes HITL checkpoint span)
T020  (graphs/discovery.py)               ← parallel
T021  (graphs/fetch_jds.py)               ← parallel
T021a (nodes/linkedin_connector.py +      ← parallel (new — fulfils FR-007 outreach span)
       nodes/outreach_mailer.py)
T022  (src/instrumentation.ts)            ← parallel
T024  (grafana dashboards JSON)           ← parallel
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 (T001–T003)
2. Complete Phase 2 (T004–T008)
3. Complete Phase 3 / US1 (T009–T015)
4. **STOP and VALIDATE**: LangDB dashboard shows all 7 LLM call sites tracked with correct metadata
5. Ship US1 — full LLM cost visibility with zero pipeline impact

### Incremental Delivery

1. Phase 1 + Phase 2 → Infra ready (Docker stack + config)
2. Phase 3 (US1) → LangDB cost tracking → **Ship/Demo**
3. Phase 4 (US2) → Distributed traces in Grafana Tempo → **Ship/Demo**
4. Phase 5 (US3) → LangSmith dev guard → **Ship/Demo**
5. Phase 6 → Tests + validation

---

## Notes

- `agent/agent/daemon.py` is modified in T010, T017, T025, and T027 — execute sequentially in phase order
- LangSmith is already wired in `config.py` and `pyproject.toml` (`langsmith >= 0.3.45` already present) — US3 is 80% pre-done; T025 is the only new code
- The `configure_langdb()` and `init_telemetry()` functions MUST both be no-ops when their respective API keys / endpoints are not set (graceful degradation per FR-013)
- OTel `BatchSpanProcessor` handles export failures internally with backoff — no additional error handling needed in graph code
- Grafana dashboard JSON files should use `__inputs` for datasource references so they are portable across environments
- `CAST(x AS TEXT)` pattern (not `::text`) must be used for any raw SQL in this project — SQLite compatibility requirement from F7
