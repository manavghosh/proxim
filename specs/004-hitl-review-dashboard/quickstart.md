# Quickstart: HITL Review Dashboard (F4)

**Branch**: `004-hitl-review-dashboard` | **Date**: 2026-05-04

---

## Prerequisites

1. F9 (10D Scoring Engine) complete — jobs in DB with `grade`, `score10d`, `report_md` populated.
2. Migrations applied — `hitl_checkpoints` table exists in both SQLite and Neon.
3. Next.js dev server running (`npm run dev`).
4. Python daemon running (`cd agent && poetry run python -m agent.daemon`).

---

## View the HITL Dashboard

Open `http://localhost:3000/candidates/<id>/pipeline` — replace `<id>` with a real candidate UUID.

You should see:
- Scored jobs with grade badges (A/B/C/D, colour-coded)
- Numeric scores
- Strength and risk chips (derived from `score10d`)
- Approve / Reject / Snooze buttons

---

## Test HITL Decisions

### Approve a job

```bash
JOB_ID="<uuid-of-awaiting-job>"
CANDIDATE_ID="<uuid>"

curl -X POST \
  "http://localhost:3000/api/jobs/$JOB_ID/approve?candidateId=$CANDIDATE_ID"
```

Expected: 200 with `pipelineJobId` — resume builder job is queued. Check `pipeline_jobs` in DB Studio.

### Reject a job

```bash
curl -X POST \
  "http://localhost:3000/api/jobs/$JOB_ID/reject?candidateId=$CANDIDATE_ID"
```

Expected: 200. Job disappears from dashboard permanently.

### Snooze a job

```bash
curl -X POST \
  "http://localhost:3000/api/jobs/$JOB_ID/snooze?candidateId=$CANDIDATE_ID" \
  -H "Content-Type: application/json" \
  -d '{"days": 7}'
```

Expected: 200 with `snoozedUntil` timestamp. Job disappears from dashboard.

---

## Test Real-Time SSE

Open the dashboard in a browser tab. In a separate terminal, insert a scored job directly into the DB:

```powershell
$script = @"
import sqlite3, json, uuid
from datetime import datetime, timezone

conn = sqlite3.connect('proxim-dev.db')
now = datetime.now(timezone.utc).isoformat()
job_id = str(uuid.uuid4())

# Get candidate and pipeline run IDs
conn.execute('SELECT id FROM candidates LIMIT 1')
cand_id = conn.execute('SELECT id FROM candidates LIMIT 1').fetchone()[0]
run_id = conn.execute('SELECT id FROM pipeline_runs LIMIT 1').fetchone()[0]

conn.execute('''INSERT INTO jobs (id, candidate_id, pipeline_run_id, title, company,
    jd_raw, source, source_url, status, grade, archetype, archetype_confidence, created_at, updated_at)
    VALUES (?, ?, ?, 'VP of AI Test', 'TestCo', 'AI job', 'naukri', 'http://x.com',
    'scored', 'A', 'Agentic Systems Architect', 0.9, ?, ?)''',
    (job_id, cand_id, run_id, now, now))
conn.commit()
print('Inserted job:', job_id)
"@
$script | python
```

Within 5 seconds, the job card should appear on the open dashboard tab without a page refresh.

---

## Test Snooze Resurface

1. Snooze a job (see above).
2. Directly update `snoozed_until` to a past timestamp in DB Studio:
   ```sql
   UPDATE hitl_checkpoints
   SET snoozed_until = datetime('now', '-1 second')
   WHERE status = 'snoozed';
   ```
3. Wait up to 60 seconds for the Python daemon's snooze check.
4. The job reappears on the dashboard within 5 seconds of the daemon reset.

---

## Test Concurrent Approval Safety

```bash
# Fire two simultaneous approvals for the same job
curl -X POST "http://localhost:3000/api/jobs/$JOB_ID/approve?candidateId=$CANDIDATE_ID" &
curl -X POST "http://localhost:3000/api/jobs/$JOB_ID/approve?candidateId=$CANDIDATE_ID" &
wait
```

Expected: One returns 200, the other returns 409 `"Job already decided"`.

---

## Run Next.js Tests

```bash
npm run test:run
```

---

## Environment Variables

No new environment variables required. All existing `.env.local` keys are sufficient.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Dashboard shows no jobs | No `scored`/`awaiting` jobs in DB | Run the scoring pipeline first |
| SSE not firing | EventSource not connecting | Check browser console for CORS/network errors |
| Snooze not resurfaces | Daemon not running | Start daemon: `poetry run python -m agent.daemon` |
| 409 on first approve | Job already approved from another tab | Refresh the page |
| Report markdown not rendering | `report_md` column is NULL | Run F9 scoring engine to populate report |
