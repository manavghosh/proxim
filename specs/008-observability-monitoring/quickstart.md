# Quickstart: Observability & Monitoring (F8)

**Branch**: `proxim-mvp` | **Date**: 2026-05-22

---

## Prerequisites

- Docker and Docker Compose installed
- Python agent dependencies installed (`cd agent && poetry install`)
- `.env.local` and `agent/.env` configured (see data-model.md §5 for new variables)
- No Neon schema migration needed for this feature

---

## 1. Start the Observability Stack

```bash
# From repo root — starts OTel Collector, Tempo, Prometheus, Grafana
docker compose -f docker-compose.yml -f docker-compose.observability.yml up -d
```

Wait ~15 seconds for services to initialize, then verify:

```bash
# OTel Collector health
curl http://localhost:13133/

# Grafana UI
open http://localhost:3001   # admin/admin (default creds)

# Prometheus targets
open http://localhost:9090/targets
```

---

## 2. Configure Environment Variables

### `agent/.env` — add these if not present

```bash
LANGDB_API_KEY=<your LangDB project API key>
LANGDB_PROJECT_ID=<your LangDB project ID>
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317
OTEL_SERVICE_NAME=proxim-agent
# LangSmith (dev only)
LANGCHAIN_TRACING_V2=true
LANGCHAIN_API_KEY=<your LangSmith API key>
LANGCHAIN_PROJECT=proxim-dev
ENVIRONMENT=development
```

### `.env.local` — add these

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_SERVICE_NAME=proxim-nextjs
```

---

## 3. Verify US1 — LangDB Cost Tracking

1. Run the Python agent against a queued pipeline job:
   ```bash
   cd agent && poetry run python -m agent.daemon
   ```
2. Trigger a scoring job from the UI or directly insert a `pipeline_jobs` row.
3. Open LangDB dashboard → verify LLM calls appear with:
   - `agent_name` tag (e.g. `scoring_engine`)
   - `feature` tag (e.g. `scoring`)
   - Token counts (prompt + completion)
   - Cost in USD
   - Latency in ms
4. Check that 100% of calls are tracked (SC-001): count calls in LangDB vs. `pipeline_logs` entries.

---

## 4. Verify US2 — Distributed Tracing

1. Ensure observability stack is running (step 1).
2. Run a full pipeline job end-to-end.
3. Open Grafana Tempo: `http://localhost:3001/explore` → select Tempo datasource → search for `service_name="proxim-agent"`.
4. Verify:
   - A root `pipeline_run` span exists for the run.
   - Child spans for `discovery`, `scoring`, `resume_generation`, `outreach` are present.
   - Each `score_job` span has `job_id`, `model`, `llm.token_count.prompt`, `llm.cost_usd` attributes.
   - Any failed span has `error=true` and `error.message` set.
5. Check Next.js spans: search `service_name="proxim-nextjs"` → verify Route Handler spans appear for API calls made during the run.
6. Open the three Grafana dashboards (`http://localhost:3001/dashboards`):
   - **System Health**: API response times and error rates visible.
   - **Pipeline Performance**: scoring latency and resume generation latency charted.
   - **Cost Monitoring**: token volumes per agent per day visible.

---

## 5. Verify US3 — LangSmith Dev Tracing

1. Ensure `LANGCHAIN_TRACING_V2=true` and `LANGCHAIN_API_KEY` are set in `agent/.env`.
2. Run a scoring or resume builder pipeline job.
3. Open [LangSmith](https://smith.langchain.com) → navigate to `proxim-dev` project.
4. Verify:
   - A run appears named with the `pipeline_run_id`.
   - All LangGraph nodes are visible with state transitions.
   - LLM call prompts and responses are captured and replayable.
   - Pydantic validation failures (if any) are visible in the node output.
5. **Production guard test**: Set `ENVIRONMENT=production` in `agent/.env` and start the daemon. Verify it logs a `CRITICAL` warning and still starts (does not crash).

---

## 6. Verify Production Guard

```bash
# In agent/.env, temporarily set:
ENVIRONMENT=production
LANGCHAIN_TRACING_V2=true

# Start daemon
cd agent && poetry run python -m agent.daemon

# Expected log output:
# [CRITICAL] langsmith_active_in_production message="LANGCHAIN_TRACING_V2=true in production..."
# Daemon STILL starts — warning only, not a crash
```

Restore `ENVIRONMENT=development` after testing.

---

## 7. OTel Overhead Verification (SC-002)

```bash
# Run 100 scoring calls with OTel enabled and measure p99 latency
cd agent && poetry run python -c "
import time, litellm
from agent.config import settings
from agent.telemetry import init_telemetry

init_telemetry(settings)
timings = []
for i in range(100):
    t = time.time()
    # ... minimal LLM call with metadata
    timings.append((time.time() - t) * 1000)

timings.sort()
print(f'p99 overhead: {timings[98]:.1f}ms')
"
# Expected: < 5ms additional latency from instrumentation (SC-002)
```

---

## Known Limitations (MVP)

- The Grafana Cost Monitoring dashboard shows **estimated** USD costs (token volume × configurable rate). Precise billing-accurate costs live in LangDB's own dashboard.
- Grafana Tempo spans are retained for 14 days by default. Older pipeline runs will not have queryable traces.
- LangSmith free tier limits: ~5,000 traces/month. For high-volume dev use, upgrade to paid or set `LANGCHAIN_TRACING_V2=false` between sessions.
- OTel instrumentation is disabled when `OTEL_EXPORTER_OTLP_ENDPOINT` is not set — the Python telemetry module uses a no-op exporter as fallback.
