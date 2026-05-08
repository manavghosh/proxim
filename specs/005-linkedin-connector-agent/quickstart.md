# Quickstart: LinkedIn Connector Agent (F5) — Integration Scenarios

**Branch**: `005-linkedin-connector-agent` | **Date**: 2026-05-06

---

## Prerequisites

1. F4 (HITL Review Dashboard) complete and working
2. At least one approved job in the DB (`jobs.status = 'approved'`)
3. Proxycurl API key set in `agent/.env`: `PROXYCURL_API_KEY=your_key`
4. LinkedIn OAuth access token set in candidate preferences (manual for dev): update `candidates.preferences` via Drizzle Studio or SQL

---

## Scenario 1 — Happy Path: Note Variants Generated and Sent

**Setup**:
```bash
# Ensure an approved job exists
npx drizzle-kit studio  # Use Drizzle Studio to set job status='approved'

# Set candidate preferences with LinkedIn token and test company
# preferences.linkedin_access_token = "your_dev_oauth_token"
# preferences.do_not_contact_companies = []
```

**Test steps**:
1. Approve a job via the HITL dashboard (or directly update DB) — this auto-inserts a `linkedin_connector` row in `pipeline_jobs`
2. Start the Python daemon: `cd agent && python -m agent.daemon`
3. Watch logs — should see: `[linkedin_connector] discovering → enriching → generating → notes_ready`
4. Open the HITL dashboard at `http://localhost:3000/candidates/[id]/pipeline`
5. Find the approved job card — verify "Select Connection Note" section appears below the approve/reject buttons
6. Select Variant A or B, optionally edit the text
7. Click **Send** — verify:
   - Badge changes to "Sent · Pending acceptance"
   - `outreach_targets.status = 'sent'` in DB
   - `outreach_targets.sent_at` is populated

**Independent test** (no daemon needed):
```bash
# Insert a fixture outreach_target directly
INSERT INTO outreach_targets (id, job_id, candidate_id, company, status, note_a, note_b, created_at, updated_at)
VALUES ('test-uuid', 'approved-job-uuid', 'candidate-uuid', 'Acme Corp', 'notes_ready',
        'Hi Sarah, your 3yr AI journey at Acme is impressive. Would love to connect.',
        'Hi Sarah, Acme''s agentic bet resonates with my work. Happy to share learnings.',
        now(), now());

# Then test the UI and POST /api/outreach/test-uuid/select-and-send directly
```

---

## Scenario 2 — DNC Skip

**Setup**:
```bash
# Add the job's company to DNC list
UPDATE candidates SET preferences = jsonb_set(
  preferences,
  '{do_not_contact_companies}',
  '["Acme Corp"]'
) WHERE id = 'candidate-uuid';
```

**Expected**:
- Python daemon logs: `[linkedin_connector] company 'Acme Corp' on DNC list — skipping`
- `outreach_targets.status = 'skipped_dnc'`
- Dashboard card shows "Do-not-contact" muted badge (no note selector shown)

---

## Scenario 3 — No Contact Found Fallback

**Setup**: Use a small or obscure company that Proxycurl is unlikely to have indexed.

**Expected**:
- All role priority searches (CAIO → CTO → VP AI → Head AI → Eng Dir → HR) return no results
- `outreach_targets.status = 'no_contact_found'`
- Dashboard card shows "No contact found" muted badge
- Email outreach (F6) proceeds independently (not blocked by this feature)

---

## Scenario 4 — Daily Rate Limit (20/day)

**Setup**:
```bash
# Insert 20 fake sent records for today
INSERT INTO outreach_targets (id, job_id, candidate_id, company, status, sent_at, created_at, updated_at)
SELECT gen_random_uuid(), jobs.id, 'candidate-uuid', 'Fake Corp', 'sent', now(), now(), now()
FROM jobs LIMIT 20;
```

**Test**:
1. With a `notes_ready` outreach target, click Send on the dashboard
2. Expected API response: `{ "status": "queued", "message": "Daily connection limit (20) reached..." }`
3. Badge shows "Queued — sends tomorrow"
4. After midnight UTC, run the daemon queue-processor loop manually:
   ```python
   # from agent/agent/daemon.py test script
   await _process_queued_sends(pool)
   ```
5. Verify the target status changes to `sent`

---

## Scenario 5 — LinkedIn Rate Limit Warning (Auto-Pause)

**Setup**: Configure a mock LinkedIn API response with HTTP 429:
```bash
# In agent tests — mock the LinkedIn API call to return 429
```

**Expected**:
- `outreach_targets.status = 'paused'`
- `candidates.preferences.linkedin_paused = true`
- All subsequent send attempts return 403: "LinkedIn outreach is paused"
- Dashboard shows a warning banner: "LinkedIn outreach paused. Resume in Settings."

**Resume test**:
1. Call `POST /api/linkedin/resume?candidateId=uuid`
2. Verify `linkedin_paused = false` in preferences
3. Queued targets can now be sent again

---

## Scenario 6 — Acceptance Detection (Polling)

**Setup**: After a sent request, simulate acceptance by updating the LinkedIn API mock to return `ACCEPTED` for the invitation.

**Test the 24h polling daemon**:
```python
# Direct call for testing (bypass the 24h sleep)
await _poll_acceptance_statuses(pool)
```

**Expected**:
- `outreach_targets.status = 'accepted'`, `accepted_at = now()`
- Dashboard card badge changes to "Connected ✓" (green)

---

## Running Python Agent Unit Tests

```bash
cd agent
pytest tests/unit/test_linkedin_connector.py -v
pytest tests/unit/test_db_linkedin.py -v
```

## Running Next.js Tests

```bash
npx vitest run src/__tests__/api/outreach/
npx vitest run src/__tests__/components/pipeline/OutreachNoteSelector.test.tsx
```

---

## Dev Workflow (No Real LinkedIn / Proxycurl Creds)

For local development without real API keys, use the fixture-injection approach:

1. Skip daemon — insert `outreach_targets` rows directly with `status='notes_ready'`
2. Test all UI interactions (note selection, edit, send, status badges)
3. For Python agent logic — use the mock fixtures in `agent/tests/fixtures/`

This allows full UI development and testing without incurring Proxycurl credits or touching a real LinkedIn account.
