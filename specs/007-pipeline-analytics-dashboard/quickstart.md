# Quickstart: Pipeline Analytics Dashboard (F7)

**Branch**: `proxim-mvp` | **Date**: 2026-05-22

---

## Prerequisites

- Previous features (F2, F3, F4, F5, F6) deployed or seeded with fixture data
- `DATABASE_URL` set in `.env.local` (Neon) and `agent/.env` (same connection string)
- Dev server running: `npm run dev`

---

## 1. Apply the Migration

```bash
npm run db:generate   # generates 0012_pipeline_analytics_fields migration
npm run db:migrate    # applies it to the database
```

Verify in Drizzle Studio (`npm run db:studio`) that `pipeline_runs` now has `ab_grade_count`, `resumes_generated`, `emails_sent`, `replies_received` columns, and `jobs` has `interview_callback_at`.

---

## 2. Seed Fixture Data (optional — skip if real pipeline has run)

To test without running the full pipeline, seed pipeline_runs and jobs manually:

```bash
# From repo root (requires psql or Drizzle Studio)
# Insert 3 completed pipeline runs with varied aggregate values
# Insert ~50 jobs distributed across grades A–F
# Insert email_cadences, email_drafts (some with sent + open/reply timestamps)
# Insert outreach_targets (some with accepted_at set)
```

Alternatively, run the pipeline from the Dashboard to generate real data.

---

## 3. Verify Analytics Endpoint

```bash
curl "http://localhost:3000/api/candidates/<candidateId>/analytics?range=30d" | jq .
```

Expected: `metrics` object with non-null values if fixture data was seeded.

---

## 4. Test the Applications Page — Jobs Tab

1. Navigate to `http://localhost:3000/candidates/<id>/applications`
2. Verify job cards show elapsed time in stage (e.g., "3h 22m in resume_ready")
3. If any job has `pipeline_jobs.status = 'failed'`, verify an error card appears with a Retry button
4. Click Retry → confirm new `pipeline_jobs` row appears in DB with `status='queued'`
5. On an approved/resume_ready job, click "Mark as Interview" → verify `jobs.interview_callback_at` is set

---

## 5. Test the Applications Page — Analytics Tab

1. Click the **Analytics** tab
2. Verify 6 metric cards render (jobs discovered, A/B grade rate, email open rate, email reply rate, LinkedIn acceptance rate, interview callback rate)
3. Change the time range filter (7d / 30d / 90d / All Time) → verify metric values update
4. Verify the grade distribution bar chart renders with bars for A–F
5. If `inProgressRuns > 0`, verify the "1 run in progress — excluded from metrics" notice appears

---

## 6. Test the Applications Page — History Tab

1. Click the **History** tab
2. Verify run history table shows completed/failed runs sorted by start time (newest first)
3. If > 50 runs, verify pagination controls appear and page 2 loads correctly
4. Click **Export to CSV** → verify download triggers and CSV contains correct headers + rows
5. Apply a time range filter → verify run list updates and CSV export respects the filter

---

## 7. Test SSE Real-Time Updates

1. Open the Applications page in a browser
2. In a second terminal, run the Python agent against a queued pipeline job:
   ```bash
   cd agent && poetry run python -m agent.daemon
   ```
3. Observe:
   - While the run is in progress, the Jobs tab cards update stage within 5 seconds (SC-001)
   - When the run completes, the Analytics tab metrics update automatically (no page reload needed)
   - Any failed job shows an error card with a Retry button within 5 seconds of failure

---

## 8. Test CSV Export Performance

```bash
# Seed 500 completed pipeline runs, then:
time curl "http://localhost:3000/api/candidates/<id>/analytics/export?range=all" -o /tmp/export.csv
```

Expected: completes in ≤ 10 seconds (SC-003).

---

## 9. Run Tests

```bash
npm run test:run
```

New test files:
- `src/__tests__/lib/analytics-service.test.ts` — metric computation edge cases
- `src/__tests__/api/analytics.test.ts` — route response shape

---

## Known Limitations (MVP)

- Interview callback rate is self-reported; the system cannot detect interviews automatically (per spec assumption).
- Aggregate fields on `pipeline_runs` are only populated for runs completed AFTER the migration is applied. Older runs show `0` for all aggregate counts — the Analytics tab will show lower-than-actual historical metrics until runs are re-run.
- Grade distribution chart does not support drill-down; clicking a bar is a no-op in MVP.
