# Feature Specification: Observability & Monitoring (F8)

**Feature Branch**: `008-observability-monitoring`
**Created**: 2026-04-30
**Status**: Draft
**Phase**: 6 — Observability

## User Scenarios & Testing *(mandatory)*

### User Story 1 — LLM Cost Tracking and Audit Trail (Priority: P1)

Every LLM call in the production pipeline is tracked: which agent made the call, how many tokens were used, what it cost, and how long it took. The candidate (or operator) can view this data aggregated by feature and by run.

**Why this priority**: A multi-agent pipeline with LLM calls at every stage can accrue unexpected costs. Without tracking, the operator has no visibility into spend and cannot optimise.

**Independent Test**: Can be tested by running a fixture pipeline end-to-end and verifying LangDB captures all LLM calls with correct agent attribution, token counts, costs, and latencies.

**Acceptance Scenarios**:

1. **Given** an LLM call is made by any agent, **When** the call completes, **Then** LangDB records: agent name, prompt tokens, completion tokens, cost (USD), and latency.
2. **Given** a pipeline run completes, **When** the cost dashboard is viewed, **Then** total cost is broken down by feature (scoring, resume generation, email drafting) and by run.
3. **Given** LangDB instrumentation is active, **When** any LLM call is profiled, **Then** the observability overhead adds ≤ 5ms to p99 call latency.

---

### User Story 2 — End-to-End Distributed Tracing (Priority: P2)

Every pipeline run produces a single trace from job discovery through to email send, with spans for each agent, each LLM call, and each HITL checkpoint. Engineers can find and diagnose any failure within the trace.

**Why this priority**: When a scoring result is wrong or a resume generation fails, the debugging path without distributed tracing is slow and manual. Tracing makes root cause analysis immediate.

**Independent Test**: Can be tested by running a fixture pipeline and verifying a complete trace exists in Grafana Tempo with spans for each expected stage and correct duration data.

**Acceptance Scenarios**:

1. **Given** a pipeline run executes, **When** traced, **Then** a single parent trace exists covering: discovery, scoring, HITL checkpoint, resume generation, and outreach.
2. **Given** an agent fails, **When** the trace is inspected, **Then** the failing span shows the error with its agent name, job ID, and timestamp.
3. **Given** a trace is written, **When** viewed in Grafana alongside Prometheus metrics, **Then** both are navigable from a unified Grafana instance without switching tools.

---

### User Story 3 — Development Tracing with LangSmith (Priority: P3)

In development and staging, every LangGraph run is automatically traced in LangSmith with full node-level visibility — state transitions, prompt inputs, LLM outputs. No code changes are required to enable tracing.

**Why this priority**: LangSmith tracing in dev is the fastest way to debug incorrect 10D scores or resume personalisation failures. Early enablement prevents debugging debt.

**Independent Test**: Can be tested by running a fixture pipeline in dev and verifying all LangGraph nodes, state transitions, and LLM calls appear in LangSmith under the correct project.

**Acceptance Scenarios**:

1. **Given** `LANGCHAIN_TRACING_V2=true` and a valid `LANGCHAIN_API_KEY` are set in the dev environment, **When** any LangGraph run executes, **Then** all nodes, checkpoints, and LLM calls are automatically captured in LangSmith under the `proxim-dev` project.
2. **Given** a scoring error occurs in dev, **When** the trace is inspected in LangSmith, **Then** the exact prompt, response, and Pydantic validation failure are visible for replay.

---

### Edge Cases

- What if LangDB SDK becomes unavailable (network failure)? → LLM calls continue uninterrupted; LangDB logging is fire-and-forget. Failed tracking events are logged locally but do not block the pipeline.
- What if a Grafana Tempo span exceeds the retention window? → Spans beyond the configured retention are purged. The retention window is set to 14 days by default.
- What if LangSmith tracing is accidentally left enabled in production? → The `.env` check (`ENVIRONMENT=production` disables `LANGCHAIN_TRACING_V2`) prevents this. A startup assertion in the agent service warns if both are active simultaneously.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: LangDB SDK MUST be instrumented directly into the LLM call wrapper in the Python agent service — not as a proxy endpoint.
- **FR-002**: Every LLM call MUST record: agent name, prompt tokens, completion tokens, cost (USD), and latency.
- **FR-003**: LangDB MUST provide aggregate views: cost per job, cost per run, cost per feature (scoring / resume / email).
- **FR-004**: LangDB instrumentation overhead MUST NOT exceed 5ms p99 per LLM call.
- **FR-005**: An OpenTelemetry collector MUST receive spans from the Python agent service, the Next.js Route Handlers, and any background jobs.
- **FR-006**: All spans MUST be forwarded to Grafana Tempo as the OpenTelemetry backend.
- **FR-007**: Each pipeline run MUST produce a single parent trace with child spans covering: job discovery, scoring, HITL checkpoint, resume generation, and outreach (LinkedIn + email).
- **FR-008**: Each span MUST include: `job_id`, `agent_name`, `model` (where applicable), `source` (where applicable), and duration.
- **FR-009**: Grafana MUST be configured with dashboards for: System Health (API response times, error rates, queue depth), Pipeline Performance (scoring latency, resume generation latency, email delivery rate), and Cost Monitoring (LLM spend per day, per agent, per feature).
- **FR-010**: In development and staging environments, `LANGCHAIN_TRACING_V2=true` MUST enable automatic LangSmith tracing for all LangGraph runs, nodes, checkpoints, and LLM calls.
- **FR-011**: LangSmith tracing MUST be disabled in production. A startup assertion MUST warn if both production mode and LangSmith tracing are active simultaneously.
- **FR-012**: LangSmith project MUST be named `proxim-dev` with runs scoped per pipeline run via a unique `run_id`.
- **FR-013**: Observability instrumentation MUST NOT modify or intercept LLM responses — it is read-only.

### Key Entities

- **LangDB Call Record**: Per-LLM-call tracking record managed by LangDB SDK — not stored in Neon.
- **OpenTelemetry Span**: Per-agent-action trace span forwarded to Grafana Tempo.
- **LangSmith Trace**: Per-LangGraph-run trace in the `proxim-dev` project — dev/staging only.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of LLM calls in the pipeline are captured in LangDB with agent attribution, token counts, and cost — zero untracked calls.
- **SC-002**: Observability overhead ≤ 5ms p99 per LLM call (measured without network latency).
- **SC-003**: End-to-end trace for every pipeline run is visible in Grafana Tempo within 30 seconds of run completion.
- **SC-004**: A broken scoring agent failure is diagnosable from LangSmith trace replay within 5 minutes in the dev environment.
- **SC-005**: Grafana dashboards load within 3 seconds for 90 days of pipeline data.

## Assumptions

- All previous pipeline phases are complete and generating LLM calls and spans.
- Grafana, Prometheus, and Grafana Tempo are self-hosted via Docker Compose in the same environment as the Python agent service.
- The OpenTelemetry collector is configured as a sidecar in the Docker Compose setup — not a managed cloud service.
- LangDB dashboard access is configured for the candidate's account as part of this feature's setup.
- LangSmith free tier is sufficient for the development tracing volume during the build phase. Paid tier is a future consideration if trace volume exceeds free limits.
