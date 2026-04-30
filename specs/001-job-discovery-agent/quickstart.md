# Quickstart: Job Discovery Agent (F2)

**Phase 1 output** | Date: 2026-04-30

---

## Prerequisites

- Node.js 20+ and npm (for Next.js)
- Python 3.11+ and Poetry
- Docker + Docker Compose (for containerised dev)
- A Neon PostgreSQL database with `DATABASE_URL` in `.env.local`

---

## Option A — Run Both Services Locally (Recommended for Development)

### 1. Apply Database Migrations

```bash
# From repo root
npm run db:generate   # generate migration from new schema tables
npm run db:migrate    # apply to Neon
```

This adds `pipeline_jobs`, `pipeline_runs`, `jobs`, and `scan_history` tables.

### 2. Start Next.js

```bash
# From repo root
npm run dev
# → http://localhost:3000
```

### 3. Install Python Dependencies

```bash
cd agent
poetry install
poetry run playwright install chromium   # installs Chromium browser for Playwright
```

### 4. Configure Agent Environment

```bash
cp .env.example .env
# Edit .env:
#   DATABASE_URL=<same as .env.local>
#   LLM_PROVIDER=anthropic
#   LLM_MODEL=claude-sonnet-4-6
#   LANGCHAIN_TRACING_V2=true       # enables LangSmith in dev
#   LANGCHAIN_API_KEY=<your key>
#   LANGCHAIN_PROJECT=proxim-dev
#   ENVIRONMENT=development
```

### 5. Start the Agent Daemon

```bash
cd agent
poetry run python -m agent.daemon
# Logs polling every 3 seconds. Picks up jobs from pipeline_jobs table.
```

### 6. Trigger a Discovery Run

From the Next.js dashboard, click **Run Pipeline** on the Dashboard page. This calls `POST /api/pipeline/trigger` and enqueues a `discovery_only` job.

Or via curl:
```bash
curl -X POST http://localhost:3000/api/pipeline/trigger \
  -H "Content-Type: application/json" \
  -d '{"jobType": "discovery_only"}'
```

Monitor via:
```bash
curl http://localhost:3000/api/pipeline/<jobId>/status
```

---

## Option B — Docker Compose

```bash
# From repo root
cp agent/.env.example agent/.env
# Edit agent/.env as above

docker-compose up --build
# Starts: Next.js (port 3000), agent daemon, Playwright runtime
```

**`docker-compose.yml`** services:
- `nextjs`: builds from repo root, `npm run dev`, mounts `src/`
- `agent`: builds from `agent/Dockerfile`, runs `python -m agent.daemon`

---

## Running Tests

```bash
# Next.js tests (Vitest)
npm run test:run

# Python unit tests
cd agent
poetry run pytest tests/unit/ -v

# Python unit tests with coverage
poetry run pytest tests/unit/ --cov=agent --cov-report=term-missing
```

---

## Checking LangSmith Traces

With `LANGCHAIN_TRACING_V2=true` and a valid `LANGCHAIN_API_KEY`, all discovery graph runs appear in the `proxim-dev` project at [smith.langchain.com](https://smith.langchain.com) within seconds of execution.

Each run is tagged with `candidate_id` and `pipeline_job_id` for filtering.

---

## Common Issues

| Symptom | Likely Cause | Fix |
|---|---|---|
| Daemon not picking up jobs | `FOR UPDATE SKIP LOCKED` holding a lock | Check for stuck `running` jobs in `pipeline_jobs`; reset status to `queued` |
| Playwright timeout on LinkedIn | Scraping throttled / CAPTCHA | Source skipped automatically; check agent logs for 429 |
| `asyncpg.exceptions.ConnectionDoesNotExistError` | DB pool exhaustion | Reduce `AGENT_CONCURRENCY` env var from default 1 |
| LangSmith traces not appearing | Missing `LANGCHAIN_API_KEY` or wrong project | Verify `.env` has correct values; check `LANGCHAIN_PROJECT=proxim-dev` |
