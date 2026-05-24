# Research: Observability & Monitoring (F8) — Phase 0

**Branch**: `proxim-mvp` | **Date**: 2026-05-22 | **Spec**: [spec.md](spec.md)

---

## Decision 1: LangDB SDK Integration Pattern (FR-001, FR-002)

**Decision**: Use LangDB Python SDK as a LiteLLM success/failure callback — **not** as a proxy endpoint.

**Rationale**: FR-001 explicitly forbids proxy mode. LiteLLM's built-in callback system (`litellm.callbacks = [langdb_callback]`) intercepts every `litellm.completion()` and `litellm.acompletion()` call after the response arrives. The callback receives the full `ModelResponse` including `usage` (prompt_tokens, completion_tokens), cost (computed by LiteLLM from its price tables), latency, and any `metadata` dict attached to the original call. Agent attribution is passed via `metadata={"agent_name": "scoring_engine"}` on each call site — no call site needs to know about LangDB directly. The callback is registered once at daemon startup.

**Package**: `langdb-sdk` (PyPI) — added to `pyproject.toml`.

**Agent attribution approach**: Each `litellm.completion()` / `litellm.acompletion()` call site adds a `metadata` keyword arg:
```python
metadata={"agent_name": "scoring_engine", "job_id": job_id, "feature": "scoring"}
```
The LangDB callback reads `metadata` from the request kwargs and forwards it as tags/dimensions.

**Alternatives considered**:
- **LangDB proxy mode** (`LANGDB_PROXY_URL`) — rejected: FR-001 forbids proxy; proxy adds a network hop and a SPOF.
- **Manual LangDB HTTP API** — rejected: SDK callback is cleaner; avoids duplicating the call-tracking logic in every call site.

---

## Decision 2: Python OpenTelemetry Packages (FR-005, FR-007, FR-008)

**Decision**: `opentelemetry-sdk` + `opentelemetry-exporter-otlp-proto-grpc` + `opentelemetry-instrumentation-httpx` for the Python agent service.

**Rationale**: The OTel SDK provides the `Tracer` + `Span` API. GRPC-based OTLP exporter is the preferred Tempo ingestion protocol (lower serialization overhead than HTTP/JSON). `httpx` instrumentation auto-instruments outbound HTTP calls (Proxycurl, Hunter.io, Exa) without touching call sites. LangGraph 0.4 does not auto-emit OTel spans — spans must be created manually around each LangGraph node invocation.

**Packages added to `pyproject.toml`**:
```
opentelemetry-sdk = "^1.27"
opentelemetry-exporter-otlp-proto-grpc = "^1.27"
opentelemetry-instrumentation-httpx = "^0.48"
```

**Alternatives considered**:
- **HTTP/JSON OTLP exporter** — acceptable fallback; GRPC chosen for lower latency.
- **Jaeger exporter** — rejected: Tempo is the spec-mandated backend.
- **LangChain OpenTelemetry integration** (`langchain-opentelemetry`) — experimental and not yet stable for LangGraph 0.4+; manual span wrapping preferred for deterministic attribute control.

---

## Decision 3: Manual Span Wrapping for LangGraph Nodes (FR-007, FR-008)

**Decision**: Each LangGraph pipeline graph creates a root span at the graph entry point (keyed by `pipeline_run_id`). Each major node function is wrapped with a child span using `tracer.start_as_current_span()`.

**Rationale**: LangGraph 0.4 has no native OTel plugin. Wrapping node functions is the only reliable way to emit per-node spans with correct parent-child relationships. The tracer instance is initialized once in `agent/agent/telemetry.py` and imported by each graph module.

**Span hierarchy**:
```
pipeline_run (root span, keyed by pipeline_run_id)
  └── discovery (child)
        └── scrape_linkedin (grandchild)
        └── scrape_naukri (grandchild)
  └── scoring (child, one per batch)
        └── score_job (grandchild, one per job)
  └── hitl_checkpoint (child)
  └── resume_generation (child)
  └── outreach (child)
        └── linkedin_connector (grandchild)
        └── outreach_mailer (grandchild)
```

**Required span attributes** (FR-008): `job_id`, `agent_name`, `model` (where applicable), `source` (where applicable), `pipeline_run_id`.

**Alternatives considered**:
- **LangChain tracer callbacks** — would only trace LLM calls, not DB operations or scraper steps.
- **Decorator-based auto-instrumentation** — cleaner syntax but hides span lifecycle; explicit `with` blocks preferred for error handling.

---

## Decision 4: Next.js OpenTelemetry Instrumentation (FR-005)

**Decision**: Use Next.js 15's built-in `instrumentation.ts` hook with `@vercel/otel` package + OTLP HTTP exporter pointed at the OTel collector.

**Rationale**: Next.js 15 has first-class OTel support via the `instrumentation.ts` file at the project root. `@vercel/otel` provides a `registerOTel()` helper that wires up the SDK with minimal configuration, auto-instruments Route Handler spans, and respects Next.js's server-component and edge-runtime boundaries. The OTLP HTTP exporter (port 4318) is used rather than GRPC because Next.js edge runtime does not support Node.js GRPC bindings.

**Packages added to `package.json`**:
```
@vercel/otel
@opentelemetry/exporter-trace-otlp-http
```

**Span coverage**: Every Route Handler automatically gets an incoming HTTP span. Custom spans can be added for DB queries via `tracer.startActiveSpan()`.

**Alternatives considered**:
- **Manual `@opentelemetry/sdk-node` setup** — more control but requires significant boilerplate; `@vercel/otel` is the maintained, idiomatic approach.
- **No Next.js OTel** — rejected: FR-005 requires spans from Next.js Route Handlers.

---

## Decision 5: Docker Compose Observability Stack (FR-005, FR-006, FR-009)

**Decision**: Add a separate `docker-compose.observability.yml` file with OTel Collector, Grafana Tempo, Prometheus, and Grafana services. Merged into the main stack via `docker compose -f docker-compose.yml -f docker-compose.observability.yml up`.

**Rationale**: A separate compose file keeps the core developer workflow unaffected — engineers running `docker compose up` for just the app don't get the full observability stack overhead. The observability stack is opt-in for development, mandatory for staging/production.

**Services**:
| Service | Image | Ports |
|---|---|---|
| `otel-collector` | `otel/opentelemetry-collector-contrib:0.107.0` | 4317 (GRPC), 4318 (HTTP) |
| `tempo` | `grafana/tempo:2.5.0` | 3200 (HTTP), 4317 (OTLP GRPC) |
| `prometheus` | `prom/prometheus:v2.53.1` | 9090 |
| `grafana` | `grafana/grafana:11.1.0` | 3001 (mapped from 3000) |

The OTel Collector receives spans from both Python (GRPC) and Next.js (HTTP) and forwards to Tempo. Prometheus scrapes the OTel collector's metrics endpoint.

**Alternatives considered**:
- **Single `docker-compose.yml`** — rejected: bloats the developer workflow; most engineers don't need the full stack for everyday development.
- **Grafana Cloud** — rejected: spec mandates self-hosted; data residency requirement.

---

## Decision 6: Grafana Dashboard Provisioning Strategy (FR-009)

**Decision**: Provision Grafana dashboards as JSON files in `observability/grafana/provisioning/dashboards/`. Three dashboard files:
1. `system-health.json` — API p50/p99 response times (from Next.js spans in Tempo), error rate, DB query latency
2. `pipeline-performance.json` — scoring latency, resume generation latency, pipeline run duration; sourced from Tempo spans
3. `cost-monitoring.json` — LLM token usage per agent, per feature, per day; sourced from span attributes `llm.token_count.prompt` and `llm.token_count.completion` + computed cost from a Grafana variable `$token_cost_per_k`

Grafana datasources (Tempo + Prometheus) are provisioned as YAML files in `observability/grafana/provisioning/datasources/`.

**Cost dashboard note**: Precise USD costs live in LangDB's cloud dashboard. The Grafana cost dashboard shows token volumes and *estimated* cost using configurable cost-per-1k-tokens variables. This satisfies FR-009 without requiring LangDB API integration in Grafana.

**Alternatives considered**:
- **Grafana API provisioning** (POST at startup) — rejected: file-based provisioning is idempotent and doesn't require a running Grafana instance.
- **Grafana Cloud** — rejected: self-hosted per spec.

---

## Decision 7: LangSmith Production Guard (FR-010, FR-011)

**Decision**: Add a startup assertion in `agent/agent/daemon.py` that logs a `CRITICAL` warning (and optionally raises) if `settings.environment == "production"` and `settings.langchain_tracing_v2 is True`. Additionally, the `.env.example` for the agent explicitly documents that `LANGCHAIN_TRACING_V2=false` in production.

**Current state**: LangSmith is already fully configured in `config.py` (`langchain_tracing_v2`, `langchain_api_key`, `langchain_project = "proxim-dev"`) and `langsmith >= 0.3.45` is already in `pyproject.toml`. US3 is largely pre-wired. The only missing piece is the production guard and documentation.

**Rationale**: The spec (edge cases section) says "A startup assertion MUST warn if both production mode and LangSmith tracing are active simultaneously." A warning (not a hard crash) is preferred so the agent can still start in a misconfigured state while loudly signalling the problem.

**Alternatives considered**:
- **Hard `sys.exit(1)` on misconfiguration** — rejected: would cause a production outage if an env var was accidentally set; warning is safer.
- **Environment variable validation in `pydantic-settings`** — possible with a `model_validator`, but the startup assert in daemon.py is more visible and consistent with how other startup checks are done.

---

## Decision 8: Fire-and-Forget Error Handling for Observability (Edge Case, FR-013)

**Decision**: Both LangDB callbacks and OTel span exports are wrapped in `try/except` blocks that log failures via `structlog` at WARNING level but do not raise. The pipeline continues regardless of observability failures.

**Rationale**: FR-013 states observability MUST NOT modify or intercept LLM responses — it is read-only. A crash in the LangDB callback must never propagate to the calling agent. LiteLLM's callback system already isolates callback errors; OTel exporter errors are caught by the SDK's `BatchSpanProcessor` which handles export failures with exponential backoff internally.

**Implementation**:
- LangDB: LiteLLM isolates callback exceptions — no additional wrapping needed.
- OTel: `BatchSpanProcessor` with default retry (3 attempts, 30s timeout) — SDK default is sufficient.
- Next.js OTel: `@vercel/otel` handles export failures gracefully — errors logged to console, not thrown.

---

## Decision 9: OTel Collector Configuration (FR-005, FR-006)

**Decision**: Single OTel Collector instance receives spans from both Python (GRPC port 4317) and Next.js (HTTP port 4318), and exports to Grafana Tempo via OTLP GRPC. Prometheus metrics from the collector (pipeline throughput, span error rates) are scraped by Prometheus.

**Config file**: `observability/otel-collector-config.yml`

```yaml
receivers:
  otlp:
    protocols:
      grpc:  { endpoint: "0.0.0.0:4317" }
      http:  { endpoint: "0.0.0.0:4318" }

processors:
  batch:
    timeout: 1s
    send_batch_size: 1024

exporters:
  otlp/tempo:
    endpoint: tempo:4317
    tls: { insecure: true }
  prometheus:
    endpoint: "0.0.0.0:8889"

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [batch]
      exporters: [otlp/tempo]
    metrics:
      receivers: [otlp]
      processors: [batch]
      exporters: [prometheus]
```

---

## Decision 10: Span Service Name Segregation

**Decision**: Python agent emits spans with `service.name = "proxim-agent"`. Next.js emits spans with `service.name = "proxim-nextjs"`. This allows Grafana Tempo queries to filter by service and correctly attribute latency to the right runtime.

**Rationale**: Without service name segregation, spans from both runtimes are intermixed in Tempo with no way to distinguish routing latency (Next.js) from compute latency (agent). Service names map directly to Grafana Tempo's service-level query filters.

**Implementation**:
- Python: `OTLPSpanExporter` initialized with `resource = Resource({"service.name": "proxim-agent"})`.
- Next.js: `@vercel/otel` `serviceName` config option set to `"proxim-nextjs"`.
