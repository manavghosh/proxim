# Contracts: Observability & Monitoring (F8)

**Branch**: `proxim-mvp` | **Date**: 2026-05-22

F8 adds no new HTTP API endpoints. Its contracts are: OTel span schemas, LangDB metadata format, LangSmith run naming conventions, and the Docker Compose service interface.

---

## 1. LangDB Metadata Contract

Every `litellm.completion()` and `litellm.acompletion()` call MUST include a `metadata` dict conforming to this schema. The LangDB callback reads these fields for attribution.

```python
# Required on every LLM call site
metadata: dict = {
    "agent_name": str,   # REQUIRED — one of: "scoring_engine" | "resume_engine" |
                         #   "linkedin_connector" | "outreach_mailer"
    "feature":    str,   # REQUIRED — one of: "scoring" | "resume" | "email" | "linkedin"
    "job_id":     str | None,   # UUID of jobs row; None for batch-level calls
    "run_id":     str | None,   # UUID of pipeline_runs row; None outside a pipeline run
}
```

**Call sites requiring metadata** (all currently call `litellm.completion` / `litellm.acompletion`):

| File | Function | agent_name | feature |
|---|---|---|---|
| `agent/agent/scoring_engine.py` | `score_job()` | `"scoring_engine"` | `"scoring"` |
| `agent/agent/scoring_engine.py` | `_score_block_a()` | `"scoring_engine"` | `"scoring"` |
| `agent/agent/scoring_engine.py` | `_generate_report()` | `"scoring_engine"` | `"scoring"` |
| `agent/agent/resume_engine.py` | `_call_llm()` | `"resume_engine"` | `"resume"` |
| `agent/agent/nodes/linkedin_connector.py` | `generate_notes_node()` | `"linkedin_connector"` | `"linkedin"` |
| `agent/agent/nodes/linkedin_connector.py` | `determine_target_roles()` | `"linkedin_connector"` | `"linkedin"` |
| `agent/agent/nodes/outreach_mailer.py` | email draft generation calls | `"outreach_mailer"` | `"email"` |

---

## 2. OTel Span Contract

### `agent/agent/telemetry.py` — Public Interface

```python
def get_tracer() -> opentelemetry.trace.Tracer:
    """Return the singleton OTel tracer for the agent service."""

def create_pipeline_span(
    pipeline_run_id: str,
    candidate_id: str,
) -> opentelemetry.trace.Span:
    """Create the root span for a pipeline run. Caller MUST call span.end()."""
```

### Usage pattern in LangGraph graph modules

```python
from agent.telemetry import get_tracer

tracer = get_tracer()

async def score_job_node(state: ScoringState) -> ScoringState:
    with tracer.start_as_current_span(
        "score_job",
        attributes={
            "agent_name": "scoring",
            "job_id": state.job_id,
            "pipeline_run_id": state.pipeline_run_id,
            "model": f"{settings.llm_provider}/{settings.llm_model}",
        }
    ) as span:
        try:
            result = score_job(...)
            return result
        except Exception as exc:
            span.set_attribute("error", True)
            span.set_attribute("error.message", str(exc))
            raise
```

---

## 3. LangDB Initialization Contract

### `agent/agent/llm_tracker.py` — Public Interface

```python
def configure_langdb(settings: Settings) -> None:
    """Register LangDB as a LiteLLM global callback.
    
    No-op if LANGDB_API_KEY is not set (graceful degradation).
    Must be called once at daemon startup before any LLM calls.
    """
```

**Daemon startup call** (in `agent/agent/daemon.py` main function):

```python
from agent.llm_tracker import configure_langdb
from agent.config import settings

configure_langdb(settings)  # registers LangDB callback if key is set
```

---

## 4. LangSmith Production Guard Contract

### Startup assertion in `agent/agent/daemon.py`

```python
from agent.config import settings
import structlog

logger = structlog.get_logger()

def _check_langsmith_guard() -> None:
    if settings.environment == "production" and settings.langchain_tracing_v2:
        logger.critical(
            "langsmith_active_in_production",
            message="LANGCHAIN_TRACING_V2=true in production — set to false immediately",
        )
        # Warning only, not sys.exit — agent still starts but logs loudly
```

Called once in the daemon's `main()` before the polling loop starts.

---

## 5. Next.js Instrumentation Contract

### `src/instrumentation.ts`

```typescript
import { registerOTel } from '@vercel/otel'

export function register() {
  registerOTel({
    serviceName: process.env.OTEL_SERVICE_NAME ?? 'proxim-nextjs',
  })
}
```

Next.js automatically calls `register()` on server startup when `instrumentation.ts` exists at `src/`.

**Required `next.config.ts` addition** (enables instrumentation hook):

```typescript
const nextConfig: NextConfig = {
  experimental: {
    instrumentationHook: true,
  },
}
```

---

## 6. Docker Compose Observability Service Contract

### Service endpoints (internal Docker network)

| Service | Internal endpoint | Exposed host port |
|---|---|---|
| `otel-collector` | `otel-collector:4317` (GRPC), `otel-collector:4318` (HTTP) | 4317, 4318 |
| `tempo` | `tempo:4317` | 3200 (Tempo HTTP API) |
| `prometheus` | `prometheus:9090` | 9090 |
| `grafana` | `grafana:3000` | 3001 (mapped to avoid conflict with Next.js) |

### Environment variables required to connect the agent to the collector

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4317   # inside Docker
# OR
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317         # local dev without Docker
```

### Next.js OTLP endpoint (HTTP, not GRPC)

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318   # inside Docker
# OR
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318         # local dev
```

---

## 7. Grafana Dashboard Data Sources

### Tempo query pattern for pipeline latency

```
{service_name="proxim-agent"} | span_name="score_job"
```

### Tempo query pattern for error spans

```
{service_name="proxim-agent", error=true}
```

### Prometheus metric for OTel Collector throughput

```promql
rate(otelcol_exporter_sent_spans_total[5m])
```

### Cost monitoring panel formula (Grafana Transformation)

```
# Approximate cost per span (token-based estimate)
(llm_token_count_prompt + llm_token_count_completion) / 1000 * $token_cost_per_k
```

The `$token_cost_per_k` Grafana variable defaults to `0.003` (Sonnet 4.6 rate in USD per 1k tokens).

---

## 8. Python Dependencies Contract

New packages to add to `agent/pyproject.toml`:

```toml
langdb-sdk = "^0.1"
opentelemetry-sdk = "^1.27"
opentelemetry-exporter-otlp-proto-grpc = "^1.27"
opentelemetry-instrumentation-httpx = "^0.48"
```

## 9. Next.js Dependencies Contract

New packages to add to `package.json`:

```json
"@vercel/otel": "latest",
"@opentelemetry/exporter-trace-otlp-http": "^0.52.1"
```
