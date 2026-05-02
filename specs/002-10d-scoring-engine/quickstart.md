# Quickstart: 10-Dimension Scoring Engine (F9)

**Phase 1 output** | Date: 2026-05-02

---

## Prerequisites

- Phase 2 (Job Discovery) complete — jobs in DB with `status = discovered` and `jd_raw` populated
- `DATABASE_URL=./proxim-dev.db` in `.env.local` (SQLite local dev)
- `LLM_PROVIDER=anthropic`, `LLM_MODEL=claude-sonnet-4-6`, `ANTHROPIC_API_KEY` set in both `.env.local` and `agent/.env`

---

## 1. Apply Database Migrations

```bash
# Add score10d, grade, reportMd, archetype, archetypeConfidence columns to jobs
npm run db:generate
npm run db:migrate

# Same for SQLite
DATABASE_URL=./proxim-dev.db npm run db:generate:sqlite
DATABASE_URL=./proxim-dev.db npm run db:migrate:sqlite
```

---

## 2. Start Next.js

```bash
npm run dev
# → http://localhost:3000
```

---

## 3. Start the Daemon

```bash
cd agent
poetry install  # first time only
poetry run python -m agent.daemon
```

The daemon dispatches three job types in sequence:
1. `discovery_only` — scrape LinkedIn, store jobs with `jd_raw = ''`
2. `fetch_jds` — fetch JD text for each job (auto-queued)
3. `score_jobs` — score all `discovered` jobs with `jd_raw != ''` (auto-queued) ← NEW

---

## 4. Trigger a Full Pipeline Run

Click **▶ Run Pipeline** on the Dashboard. The button and pipeline log pane track all three phases continuously.

Or via curl:
```bash
curl -X POST http://localhost:3000/api/pipeline/trigger \
  -H "Content-Type: application/json" \
  -d '{"jobType":"discovery_only"}'
```

---

## 5. Verify Scoring Results

Check SQLite for scored jobs:
```bash
node -e "
const db = require('better-sqlite3')('./proxim-dev.db')
const stats = db.prepare(\"SELECT grade, COUNT(*) as c FROM jobs WHERE grade IS NOT NULL GROUP BY grade ORDER BY grade\").all()
console.log('Grade distribution:', stats)
const sample = db.prepare(\"SELECT title, company, grade, archetype FROM jobs WHERE grade IN ('A','B') LIMIT 5\").all()
console.log('Top matches:', sample)
"
```

---

## 6. Review Scored Jobs on Dashboard

Navigate to **Applications** (`/applications`). Use the grade filter (A / A+B / All) to focus on top matches. Click "Report ↗" to read the 6-block analysis. Click **Approve**, **Reject**, or **Snooze** for each job.

---

## Triggering Just the Scoring Phase (Manual)

If you have jobs with populated `jd_raw` but no grade, trigger scoring directly:

```bash
curl -X POST http://localhost:3000/api/pipeline/trigger \
  -H "Content-Type: application/json" \
  -d '{"jobType":"score_jobs"}'
```

The daemon picks up the `score_jobs` job and scores all `discovered` jobs with non-empty `jd_raw`.

---

## Common Issues

| Symptom | Likely Cause | Fix |
|---|---|---|
| All jobs remain `discovered` after daemon runs | `ANTHROPIC_API_KEY` not set in `agent/.env` | Add key and restart daemon |
| `score_failed` status on jobs | LiteLLM returned invalid JSON 3 times in a row | Check daemon logs for LLM error; re-trigger scoring |
| `/applications` shows 0 jobs | Grade filter too narrow, or jobs still `discovered` | Try "All grades" filter; check daemon is running |
| `jd_raw` is empty on jobs | `fetch_jds` hasn't run yet | Let the pipeline chain complete; scoring won't queue until JDs are fetched |
