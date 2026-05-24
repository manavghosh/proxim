# Data Model: Observability & Monitoring (F8)

**Branch**: `proxim-mvp` | **Date**: 2026-05-22

---

## 1. No Neon Schema Changes

F8 introduces **zero changes to the Neon PostgreSQL schema**. All observability data is stored in external services:
- **LangDB** (cloud SaaS): LLM call records — token counts, cost, latency
- **Grafana Tempo** (self-hosted Docker): OpenTelemetry spans
- **Prometheus** (self-hosted Docker): Scraped metrics from OTel Collector
- **LangSmith** (cloud SaaS): LangGraph run traces (dev/staging only)

---

## 2. LangDB Call Record Schema

Managed entirely by the LangDB SDK. The following metadata is attached to each `litellm.completion()` / `litellm.acompletion()` call via the `metadata` parameter:

```python
# Format for all LLM call sites in the Python agent
metadata = {
    "agent_name": "scoring_engine",          # which agent made the call
    "feature":    "scoring",                 # "scoring" | "resume" | "email" | "linkedin"
    "job_id":     job_id,                    # str UUID | None
    "run_id":     pipeline_run_id,           # str UUID
}
```

LangDB records (read-only from Proxim's perspective):

| Field | Source | Notes |
|---|---|---|
| `agent_name` | `metadata["agent_name"]` | Dimension for grouping |
| `feature` | `metadata["feature"]` | Dimension: scoring / resume / email / linkedin |
| `job_id` | `metadata["job_id"]` | Links to `jobs` table for context |
| `run_id` | `metadata["run_id"]` | Links to `pipeline_runs` table |
| `prompt_tokens` | LiteLLM `usage.prompt_tokens` | Auto-extracted |
| `completion_tokens` | LiteLLM `usage.completion_tokens` | Auto-extracted |
| `cost_usd` | LiteLLM `usage._hidden_params.response_cost` | Auto-computed by LiteLLM |
| `latency_ms` | LiteLLM end-to-end call duration | Auto-measured |
| `model` | LiteLLM `model` parameter | e.g. `anthropic/claude-sonnet-4-6` |
| `timestamp` | LangDB ingestion time | UTC |

---

## 3. OpenTelemetry Span Attribute Schema

Every OTel span produced by either runtime MUST include the following attributes where applicable.

### Mandatory attributes on all spans

| Attribute | Type | Description |
|---|---|---|
| `service.name` | string | `"proxim-agent"` (Python) or `"proxim-nextjs"` (Next.js) |
| `pipeline_run_id` | string | UUID of the `pipeline_runs` row; set as baggage for propagation |
| `candidate_id` | string | UUID of the `candidates` row |

### Agent-specific attributes (Python spans)

| Attribute | Type | Description |
|---|---|---|
| `agent_name` | string | `"discovery"` / `"scoring"` / `"resume_builder"` / `"linkedin_connector"` / `"outreach_mailer"` |
| `job_id` | string | UUID of the `jobs` row (where applicable) |
| `model` | string | LiteLLM model string (where applicable, e.g. `anthropic/claude-sonnet-4-6`) |
| `source` | string | Scraper source (where applicable, e.g. `"linkedin"`, `"naukri"`) |
| `llm.token_count.prompt` | int | Prompt token count (on LLM call spans) |
| `llm.token_count.completion` | int | Completion token count (on LLM call spans) |
| `llm.cost_usd` | float | Estimated cost in USD (on LLM call spans) |
| `error` | bool | `true` if the span ended in an exception |
| `error.message` | string | Exception message (on error spans) |

### Next.js Route Handler span attributes (auto-injected by @vercel/otel)

| Attribute | Type | Description |
|---|---|---|
| `http.method` | string | e.g. `"GET"`, `"POST"` |
| `http.route` | string | e.g. `"/api/pipeline/trigger"` |
| `http.status_code` | int | Response status |
| `db.system` | string | `"postgresql"` (Neon HTTP) |
| `db.operation` | string | SQL operation type (auto-instrumented) |

---

## 4. Span Hierarchy

```
Root span: "pipeline_run"
  attributes: pipeline_run_id, candidate_id, agent_name="daemon"
  │
  ├── "discovery"
  │     attributes: pipeline_run_id, candidate_id, agent_name="discovery"
  │     ├── "scrape_linkedin" (source="linkedin")
  │     ├── "scrape_naukri"   (source="naukri")
  │     └── "normalise_deduplicate"
  │
  ├── "scoring"
  │     attributes: pipeline_run_id, candidate_id, agent_name="scoring"
  │     └── "score_job" (job_id, model, llm.token_count.*, llm.cost_usd)
  │           └── "score_report" (job_id, model, llm.token_count.*, llm.cost_usd)
  │
  ├── "hitl_checkpoint"
  │     attributes: pipeline_run_id, job_id, agent_name="hitl"
  │
  ├── "resume_generation"
  │     attributes: pipeline_run_id, job_id, agent_name="resume_builder"
  │     ├── "personalise_resume" (model, llm.token_count.*, llm.cost_usd)
  │     └── "self_review"        (model, llm.token_count.*, llm.cost_usd)
  │
  └── "outreach"
        attributes: pipeline_run_id, job_id, agent_name="outreach"
        ├── "linkedin_connector" (model, llm.token_count.*)
        └── "outreach_mailer"    (model, llm.token_count.*)
```

---

## 5. New Configuration Variables

### Python agent (`agent/.env`)

| Variable | Default | Notes |
|---|---|---|
| `LANGDB_API_KEY` | `""` | LangDB project API key |
| `LANGDB_PROJECT_ID` | `""` | LangDB project ID |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `"http://localhost:4317"` | OTel collector GRPC endpoint |
| `OTEL_SERVICE_NAME` | `"proxim-agent"` | Service name for spans |
| `LANGCHAIN_TRACING_V2` | `"false"` | LangSmith tracing toggle |
| `LANGCHAIN_API_KEY` | `""` | LangSmith API key |
| `LANGCHAIN_PROJECT` | `"proxim-dev"` | LangSmith project name |
| `ENVIRONMENT` | `"development"` | `"development"` / `"staging"` / `"production"` |

### Next.js (`.env.local`)

| Variable | Default | Notes |
|---|---|---|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `"http://localhost:4318"` | OTel collector HTTP endpoint |
| `OTEL_SERVICE_NAME` | `"proxim-nextjs"` | Service name for spans |
| `NEXT_OTEL_VERBOSE` | `"0"` | Set `"1"` for verbose OTel logging |

---

## 6. New Source Files

| File | Purpose |
|---|---|
| `agent/agent/llm_tracker.py` | LangDB callback initialization; `configure_langdb()` called at daemon startup |
| `agent/agent/telemetry.py` | OTel tracer initialization; exports `get_tracer()` singleton |
| `src/instrumentation.ts` | Next.js OTel registration via `@vercel/otel` |
| `observability/otel-collector-config.yml` | OTel Collector pipeline config |
| `observability/tempo-config.yml` | Grafana Tempo storage config |
| `observability/prometheus.yml` | Prometheus scrape targets |
| `observability/grafana/provisioning/datasources/datasources.yml` | Grafana datasource provisioning |
| `observability/grafana/provisioning/dashboards/dashboard-provider.yml` | Grafana dashboard directory config |
| `observability/grafana/provisioning/dashboards/system-health.json` | System Health dashboard |
| `observability/grafana/provisioning/dashboards/pipeline-performance.json` | Pipeline Performance dashboard |
| `observability/grafana/provisioning/dashboards/cost-monitoring.json` | Cost Monitoring dashboard (token volumes + estimated cost) |
| `docker-compose.observability.yml` | Observability stack services (OTel, Tempo, Prometheus, Grafana) |

---

## 7. LangSmith Trace Structure (US3, dev/staging only)

LangSmith traces are emitted automatically when `LANGCHAIN_TRACING_V2=true`. The trace structure (managed by LangSmith, not Proxim) is:

```
Run: <pipeline_run_id>
  ├── LangGraph: <graph_name>
  │     ├── Node: <node_function_name>
  │     │     └── LLM call: model=<model>, tokens=<usage>
  │     └── ...
  └── Metadata: {candidate_id, job_id, feature}
```

Runs are scoped per `pipeline_run_id` via LangChain's `run_name` parameter. Project name: `proxim-dev`.

---

## 8. Entity Relationships (observability data)

```
pipeline_runs (Neon) ──── pipeline_run_id ──── OTel root span (Tempo)
                                                └── child spans per agent
                                                └── LangSmith run (dev only)

jobs (Neon) ──── job_id ──── OTel child spans (scoring, resume, outreach)
                              └── LangDB call records (via metadata.job_id)

candidates (Neon) ──── candidate_id ──── OTel spans (all stages)
```
