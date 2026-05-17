# Quickstart: Outreach Mailer Agent (F6) — Integration Scenarios

**Branch**: `006-outreach-mailer-agent` | **Date**: 2026-05-14

---

## Prerequisites

1. F4 (HITL Review Dashboard) complete and working — at least one approved job in the DB
2. F10 (Resume Builder) complete — `resume_versions` table populated with a PDF for the test job
3. Hunter.io API key in `agent/.env`: `HUNTER_API_KEY=your_key`
4. Gmail OAuth2 credentials in candidate preferences (set manually for dev):
   ```sql
   UPDATE candidates SET preferences = jsonb_set(
     preferences,
     '{gmail_access_token}', '"your_dev_token"'
   ) WHERE id = 'candidate-uuid';
   -- Also set gmail_refresh_token, gmail_email
   ```
5. Migrations applied: `npm run db:migrate`

---

## Scenario 1 — Happy Path: Cadence Generated, Approved, and Sent

**Setup**:
```bash
# Ensure an approved job exists with a known company domain
# Hunter.io will be called for the real or mocked domain
npx drizzle-kit studio   # inspect DB
```

**Test steps**:
1. Approve a job via the HITL dashboard (or directly update `jobs.status='approved'`) — this inserts an `outreach_mailer` row in `pipeline_jobs`
2. Start the Python daemon: `cd agent && python -m agent.daemon`
3. Watch logs — expect: `[outreach_mailer] pending_discovery → discovering → generating → pending_approval`
4. Open `http://localhost:3000/candidates/[id]/pipeline`
5. On the approved job card, verify the **Email Outreach** section appears showing all 3 draft previews
6. Optionally edit Day 1 body — click **Save Draft**
7. Click **Approve & Send** — verify:
   - `email_cadences.status = 'active'` in DB
   - Day 1 `email_drafts.status = 'sent'` with `sent_at` populated
   - Day 3 and Day 7 `scheduled_send_at` computed (+72h, +168h)
   - Email appears in candidate Gmail Sent folder

**Independent test (no daemon, no Hunter.io key)**:
```bash
# Insert fixture cadence + drafts directly
INSERT INTO email_cadences (id, job_id, candidate_id, hiring_manager_email, email_confidence, status, created_at, updated_at)
VALUES ('cad-uuid', 'job-uuid', 'cand-uuid', 'sarah.chen@acme.com', 85, 'pending_approval', now(), now());

INSERT INTO email_drafts (id, cadence_id, candidate_id, day_number, subject, body_html, body_text, original_body_html, status, created_at, updated_at)
VALUES
  ('d1-uuid', 'cad-uuid', 'cand-uuid', 1, 'Re: Head of AI @ Acme Corp',
   '<p>Hi Sarah, your 3-year journey building Acme''s AI platform is impressive. I''d love to explore how my work on agentic pipelines at scale might align with what you''re building. Happy to share specifics.</p>',
   'Hi Sarah, ...', '<p>Hi Sarah, ...</p>', 'draft', now(), now()),
  ('d3-uuid', 'cad-uuid', 'cand-uuid', 3, 'Re: Head of AI @ Acme Corp',
   '<p>Sarah, one insight from recent agentic deployments: structured output validation cuts hallucination rates by ~40% in production. Worth a 15-min call if this is relevant to your roadmap.</p>',
   '...', '...', 'draft', now(), now()),
  ('d7-uuid', 'cad-uuid', 'cand-uuid', 7, 'Re: Head of AI @ Acme Corp',
   '<p>Sarah, totally understand if the timing isn''t right. Happy to reconnect whenever it makes sense — no pressure either way.</p>',
   '...', '...', 'draft', now(), now());

# Then test the dashboard UI: draft preview, edit, approve flow
```

---

## Scenario 2 — Low-Confidence Email Discovery

**Setup**:
```bash
# Use a company where Hunter.io returns low confidence (< 70%)
# Or mock the Hunter.io response in agent tests
```

**Expected**:
- Python daemon logs: `[outreach_mailer] best address confidence=45 < 70 — awaiting candidate override`
- `email_cadences.status = 'low_confidence'`
- Dashboard shows: email address + confidence score + "Send Anyway" override button
- Candidate clicks "Send Anyway" → calls `POST /api/email-cadence/[cadenceId]/override-email`
- Generation proceeds; status transitions to `generating → pending_approval`

---

## Scenario 3 — No Email Found

**Setup**: Use a company with no Hunter.io entries, or mock the API to return zero results.

**Expected**:
- `email_cadences.status = 'email_not_found'`
- Dashboard card shows "Email not found" muted badge
- LinkedIn outreach (F5) continues independently — not blocked by this

---

## Scenario 4 — Reply Detected Mid-Cadence

**Setup**: After Day 1 is sent, simulate a reply by inserting a message into Gmail mock or directly updating the DB:
```sql
-- Simulate reply detection (bypass daemon polling for test)
UPDATE email_cadences SET status='replied', reply_detected_at=now() WHERE id='cad-uuid';
UPDATE email_drafts SET status='cancelled' WHERE cadence_id='cad-uuid' AND day_number IN (3,7);
```

**Expected**:
- Dashboard shows "Reply received — cadence paused" banner
- Day 3 and Day 7 badges show "Cancelled"
- Candidate is notified on the dashboard (SC-005 compliance)

**Test daemon detection directly**:
```python
# agent/agent/daemon.py — call the detection coroutine directly
await _reply_bounce_detection_loop(pool)
# Verify it detects In-Reply-To match and updates DB
```

---

## Scenario 5 — Day 1 Bounce → Cancel Day 3 + Day 7

**Setup**: Mock the Gmail API or the daemon's bounce detection query:
```sql
-- Simulate bounce detection
UPDATE email_cadences SET status='bounced', bounce_detected_at=now() WHERE id='cad-uuid';
UPDATE email_drafts SET status='bounced' WHERE cadence_id='cad-uuid' AND day_number=1;
UPDATE email_drafts SET status='cancelled' WHERE cadence_id='cad-uuid' AND day_number IN (3,7);
```

**Expected**:
- `email_cadences.status = 'bounced'`
- Day 1 badge shows "Bounced"
- Day 3 and Day 7 badges show "Cancelled"
- No further emails fire

---

## Scenario 6 — Daily 20-Email Cap

**Setup**:
```bash
# Insert 20 fake sent records for today to exhaust the daily cap
INSERT INTO email_drafts (id, cadence_id, candidate_id, day_number, subject, body_html, body_text, original_body_html, status, sent_at, scheduled_send_at, created_at, updated_at)
SELECT gen_random_uuid(), 'some-cadence-id', 'cand-uuid', 1, 'Re: Test', '<p>test</p>', 'test', '<p>test</p>', 'sent', now(), now(), now(), now()
FROM generate_series(1,20);
```

**Expected**:
- Day 1 send attempt sets `email_drafts.status = 'rate_limited'`, bumps `scheduled_send_at` by 1 day
- Dashboard shows "Queued — sends tomorrow" on the pending draft
- After midnight UTC, next daemon poll successfully sends

---

## Scenario 7 — Gmail Auth Expired Mid-Cadence

**Setup**: Invalidate the stored access token or simulate `google.auth.exceptions.RefreshError`.

**Expected**:
- `email_cadences.status = 'auth_expired'`
- Dashboard banner: "Re-authorise Gmail to resume your email cadence"
- Candidate re-authorises (onboarding flow, out of scope for F6) — token updated in preferences
- Next daemon poll resumes the cadence from where it left off

---

## Scenario 8 — Attachment Not Ready (F10 PDF Missing)

**Setup**: Clear `resume_versions` for the test candidate:
```sql
DELETE FROM resume_versions WHERE candidate_id = 'cand-uuid';
```

**Expected**:
- `email_cadences.status = 'attachment_missing'`
- Dashboard shows "Awaiting resume PDF"
- Daemon retries every 5 minutes for up to 1 hour
- Once `resume_versions` is populated, next retry sends Day 1 successfully

---

## Running Python Agent Unit Tests

```bash
cd agent
pytest tests/unit/test_outreach_mailer_nodes.py -v
pytest tests/unit/test_db_email_cadence.py -v
pytest tests/unit/test_daemon_outreach.py -v
```

## Running Next.js Tests

```bash
npx vitest run src/__tests__/api/email-cadence/
npx vitest run src/__tests__/components/pipeline/EmailOutreachPanel.test.tsx
npx vitest run src/__tests__/api/track/
```

---

## Dev Workflow (No Real Hunter.io / Gmail Credentials)

For local development without real API keys:

1. **Skip daemon** — insert fixture `email_cadences` + `email_drafts` rows directly at `status='pending_approval'`
2. **Test all UI interactions**: draft preview, edit, approve flow, status badges
3. **Test tracking endpoints**: call `GET /api/track/open/[draftId]` directly in browser; verify DB updates
4. **For Python agent logic** — use mock fixtures in `agent/tests/fixtures/`:
   - `hunter_io_finder_response.json` — successful 85% confidence result
   - `hunter_io_finder_low_confidence.json` — 45% confidence result
   - `hunter_io_no_result.json` — empty result
   - `gmail_send_response.json` — successful send
5. This allows full UI development and testing without incurring Hunter.io credits or touching a real Gmail account.
