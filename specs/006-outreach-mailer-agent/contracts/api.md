# API Contracts: Outreach Mailer Agent (F6)

**Branch**: `006-outreach-mailer-agent` | **Date**: 2026-05-14

All Next.js Route Handler endpoints follow the existing Proxim pattern. The Python agent communicates exclusively through the database — no HTTP calls between runtimes.

---

## GET `/api/candidates/[id]/jobs` — Extended Response

This endpoint (built in F4, extended in F5) gains an `emailCadence` field for `approved` jobs.

**No change to request** — same filters and sort params as F4/F5.

**Response — 200 OK (extended)**
```json
{
  "jobs": [
    {
      "id": "uuid",
      "title": "Head of AI",
      "company": "Acme Corp",
      "status": "approved",
      "grade": "A",
      "numericScore": 4.6,
      "...": "... existing F4/F5 fields ...",
      "outreachTarget": { "...": "... F5 fields ..." },
      "emailCadence": {
        "id": "uuid",
        "status": "pending_approval",
        "hiringManagerEmail": "sarah.chen@acme.com",
        "emailConfidence": 84,
        "approvedAt": null,
        "replyDetectedAt": null,
        "bounceDetectedAt": null,
        "drafts": [
          {
            "id": "uuid",
            "dayNumber": 1,
            "subject": "Re: Head of AI @ Acme Corp",
            "bodyHtml": "<p>Hi Sarah, ...</p>",
            "originalBodyHtml": "<p>Hi Sarah, ...</p>",
            "isApproved": false,
            "status": "draft",
            "scheduledSendAt": null,
            "sentAt": null,
            "openDetectedAt": null,
            "clickDetectedAt": null
          },
          {
            "id": "uuid",
            "dayNumber": 3,
            "subject": "Re: Head of AI @ Acme Corp",
            "bodyHtml": "<p>...</p>",
            "originalBodyHtml": "<p>...</p>",
            "isApproved": false,
            "status": "draft",
            "scheduledSendAt": null,
            "sentAt": null,
            "openDetectedAt": null,
            "clickDetectedAt": null
          },
          {
            "id": "uuid",
            "dayNumber": 7,
            "...": "..."
          }
        ]
      }
    }
  ],
  "total": 42
}
```

`emailCadence` is `null` for jobs not yet approved. `drafts` is `[]` until status reaches `pending_approval`.

---

## PATCH `/api/email-cadence/[cadenceId]/drafts/[draftId]`

Candidate edits a draft's body before approving. Saves edited body; marks original as `superseded`.

**Request**
```
PATCH /api/email-cadence/:cadenceId/drafts/:draftId?candidateId=uuid
Content-Type: application/json

{
  "bodyHtml": "<p>Updated body text for Day 1...</p>"
}
```

**Response — 200 OK**
```json
{
  "draftId": "uuid",
  "dayNumber": 1,
  "bodyHtml": "<p>Updated body text for Day 1...</p>",
  "originalBodyHtml": "<p>Original generated body...</p>",
  "status": "draft"
}
```

**Response — 409 Conflict** (draft already sent)
```json
{
  "error": "Cannot edit a draft that has already been sent",
  "currentStatus": "sent"
}
```

**Response — 404 Not Found**
```json
{
  "error": "Draft not found or does not belong to this cadence"
}
```

**Behaviour**: `bodyHtml` field is updated in-place; `originalBodyHtml` is never overwritten. The edit does NOT change `status` — the draft remains `draft` until `POST /approve` is called.

---

## POST `/api/email-cadence/[cadenceId]/approve`

Candidate approves all three drafts for sending. Transitions cadence from `pending_approval` to `approved`. Day 1 is scheduled for immediate send; Day 3 and Day 7 are scheduled relative to Day 1 send time.

**Request**
```
POST /api/email-cadence/:cadenceId/approve?candidateId=uuid
```
No body required — approves all three drafts in the cadence atomically.

**Response — 200 OK**
```json
{
  "cadenceId": "uuid",
  "status": "approved",
  "approvedAt": "2026-05-14T10:00:00Z",
  "drafts": [
    { "draftId": "uuid", "dayNumber": 1, "status": "scheduled", "scheduledSendAt": "2026-05-14T10:00:00Z" },
    { "draftId": "uuid", "dayNumber": 3, "status": "approved",  "scheduledSendAt": null },
    { "draftId": "uuid", "dayNumber": 7, "status": "approved",  "scheduledSendAt": null }
  ]
}
```

Day 3/7 `scheduledSendAt` is `null` at approval time — it is set by the daemon when Day 1 is confirmed sent (Day 1 `sentAt + 72h` for Day 3, `+168h` for Day 7).

**Response — 409 Conflict** (already approved)
```json
{
  "error": "Cadence has already been approved",
  "currentStatus": "approved"
}
```

**Response — 422 Unprocessable** (cadence not in pending_approval state)
```json
{
  "error": "Cadence must be in 'pending_approval' status to approve"
}
```

---

## POST `/api/email-cadence/[cadenceId]/override-email`

Candidate manually approves a low-confidence email address for sending (FR-002 override path).

**Request**
```
POST /api/email-cadence/:cadenceId/override-email?candidateId=uuid
Content-Type: application/json

{
  "confirmedEmail": "sarah.chen@acme.com"
}
```

**Response — 200 OK**
```json
{
  "cadenceId": "uuid",
  "status": "generating",
  "hiringManagerEmail": "sarah.chen@acme.com",
  "emailSource": "manual_override"
}
```

Triggers generation: sets `email_cadences.email_source = 'manual_override'` and inserts a `pipeline_jobs` row with `job_type = 'outreach_mailer_generate'` (generation-only re-run).

---

## GET `/api/email-cadence/[cadenceId]`

Fetch full cadence status including all drafts and tracking data. Used by the outreach panel to poll for status updates.

**Request**
```
GET /api/email-cadence/:cadenceId?candidateId=uuid
```

**Response — 200 OK**
```json
{
  "id": "uuid",
  "jobId": "uuid",
  "status": "active",
  "hiringManagerEmail": "sarah.chen@acme.com",
  "emailConfidence": 84,
  "approvedAt": "2026-05-14T10:00:00Z",
  "replyDetectedAt": null,
  "bounceDetectedAt": null,
  "drafts": [
    {
      "id": "uuid",
      "dayNumber": 1,
      "subject": "Re: Head of AI @ Acme Corp",
      "bodyHtml": "<p>Hi Sarah, ...</p>",
      "originalBodyHtml": "<p>Hi Sarah, ...</p>",
      "status": "sent",
      "sentAt": "2026-05-14T10:01:34Z",
      "openDetectedAt": "2026-05-14T10:45:12Z",
      "clickDetectedAt": null
    },
    {
      "id": "uuid",
      "dayNumber": 3,
      "status": "scheduled",
      "scheduledSendAt": "2026-05-17T10:01:34Z",
      "sentAt": null,
      "openDetectedAt": null,
      "clickDetectedAt": null
    },
    {
      "id": "uuid",
      "dayNumber": 7,
      "status": "approved",
      "scheduledSendAt": "2026-05-21T10:01:34Z",
      "sentAt": null,
      "openDetectedAt": null,
      "clickDetectedAt": null
    }
  ]
}
```

---

## GET `/api/track/open/[draftId]`

Email open tracking pixel endpoint. Records first open; always returns a 1×1 transparent GIF.

**Request**: Triggered by `<img>` tag in email HTML. No auth required (token in URL provides implicit auth via draftId opacity).

**Response — 200 OK**
```
Content-Type: image/gif
Cache-Control: no-store, no-cache
[1×1 transparent GIF bytes]
```

Sets `email_drafts.open_detected_at = now()` (idempotent — only sets on first call; subsequent calls do not overwrite).

---

## GET `/api/track/click/[draftId]`

Email click tracking redirect. Records click and redirects to original URL.

**Request**
```
GET /api/track/click/:draftId?url=https%3A%2F%2Facme.com%2Fcareers
```

**Response — 301 Redirect**
```
Location: https://acme.com/careers
```

Sets `email_drafts.click_detected_at = now()` (idempotent).

---

## Python Agent Internal — Outreach Mailer Pipeline Jobs

The Python daemon processes two `job_type` values for F6.

### `job_type = 'outreach_mailer'` — Discovery + Generation

```
1. claim_pipeline_job(pool) → picks up job_type='outreach_mailer'
2. Parse payload: { job_id, candidate_id, company, job_title, archetype }
3. INSERT email_cadences (status='pending_discovery')
4. Check if F5 outreach_targets has hiring_manager name for this job:
   → If yes: use name in Hunter.io Email Finder
   → If no: proceed with domain-only Domain Search
5. Hunter.io Email Finder: GET /v2/email-finder?domain=&first_name=&last_name=
   → score >= 70: use as hiringManagerEmail, source='finder'
   → score < 70 or no result: continue to step 6
6. Hunter.io Domain Search: GET /v2/domain-search?domain=&limit=10
   → best personal address >= 70 confidence: use, source='domain_search'
   → best address < 70: UPDATE status='low_confidence', store email+confidence; STOP and await override
   → no address: UPDATE status='email_not_found'; DONE (terminal)
7. UPDATE email_cadences: hiringManagerEmail, emailConfidence, emailSource, status='generating'
8. LiteLLM generation (up to 3 attempts):
   → Build prompt from: job, company, hiring manager profile, candidate parsed_profile, archetype
   → Parse EmailDraftOutput Pydantic model (validates word counts + forbidden phrases)
   → Self-review LiteLLM call: SelfReviewResult { passes, feedback }
   → If passes=False: append feedback to conversation, retry
   → All 3 attempts fail: UPDATE status='failed'; DONE
   → Success: INSERT email_drafts (3 rows, status='draft'), UPDATE status='pending_approval'
9. Mark pipeline_job status='completed'
```

### `job_type = 'outreach_mailer_generate'` — Generation Only (post low-confidence override)

Same as steps 8–9 above. Used when candidate overrides email after `low_confidence` state.

### Daemon: Cadence Send Loop (polls every 3 minutes)

```python
# Polls for approved/active cadence drafts whose scheduled_send_at has elapsed
SELECT ed.*, ec.gmail_thread_id, ec.day1_message_id, ec.candidate_id
FROM email_drafts ed
JOIN email_cadences ec ON ec.id = ed.cadence_id
WHERE ed.status IN ('scheduled', 'approved')
  AND ed.scheduled_send_at <= now()
  AND ec.status IN ('approved', 'active')
  AND ec.reply_detected_at IS NULL
  AND ec.bounce_detected_at IS NULL
ORDER BY ed.scheduled_send_at
LIMIT 10

For each draft:
  1. Daily cap check: count sent_at today >= 20? → status='rate_limited', bump +1 day; SKIP
  2. For Day 1: check resume_versions for latest approved PDF
     → No PDF: UPDATE ec.status='attachment_missing'; SKIP (retry next poll)
  3. Build MIME message (multipart/mixed for Day 1 with PDFs; multipart/alternative for Day 3/7)
  4. Set threading headers (In-Reply-To, References) for Day 3/7
  5. Gmail API send: POST /gmail/v1/users/me/messages/send
     → On RefreshError: UPDATE ec.status='auth_expired'; SKIP all drafts for this cadence
  6. UPDATE email_drafts: status='sent', sent_at=now(), gmail_message_id=<id from response>
  7. If day_number==1:
     UPDATE email_cadences: gmailThreadId=<threadId>, day1MessageId=<messageId>, status='active'
     Compute Day 3 scheduledSendAt = sent_at + 72h; Day 7 = sent_at + 168h
     UPDATE Day 3 and Day 7 drafts: status='scheduled', scheduled_send_at=<computed>
```

### Daemon: Reply + Bounce Detection Loop (polls every 60 minutes)

```python
# Process active cadences
SELECT * FROM email_cadences
WHERE status = 'active'
  AND day1_message_id IS NOT NULL

For each cadence:
  # Reply detection
  gmail_query = f'in:inbox in-reply-to:{cadence.day1_message_id}'
  messages = gmail.users().messages().list(userId='me', q=gmail_query).execute()
  if messages.get('messages'):
    UPDATE email_cadences: status='replied', reply_detected_at=now()
    UPDATE email_drafts (scheduled/approved): status='cancelled'
    continue

  # Bounce detection
  gmail_query = f'from:(mailer-daemon OR postmaster) in:inbox {cadence.day1_message_id}'
  bounce_msgs = gmail.users().messages().list(userId='me', q=gmail_query).execute()
  if bounce_msgs.get('messages'):
    UPDATE email_cadences: status='bounced', bounce_detected_at=now()
    UPDATE email_drafts WHERE day_number IN (3,7): status='cancelled'
    UPDATE email_drafts WHERE day_number=1: status='bounced'
```

---

## Error Propagation

| Scenario | API Response | UI Behaviour |
|---|---|---|
| Hunter.io quota exhausted | 500 → `status='failed'` | "Email discovery failed" badge; no retry |
| Hunter.io confidence < 70% | — | Low confidence panel with manual override option |
| No email found | — | "Email not found" muted badge |
| Gmail auth expired mid-cadence | 500 → `status='auth_expired'` | Warning banner: "Re-authorise Gmail to resume" |
| Attachment (PDF) not ready | — | "Awaiting resume PDF" badge; retry in background |
| Daily 20-email cap reached | — | Draft `rate_limited`; "Queued — sends tomorrow" note |
| Day 3/7 send blocked (reply) | — | Cadence `replied`; "Reply received — cadence paused" badge |
| Day 1 bounce → Day 3/7 cancel | — | `bounced` badge; "Day 1 bounced — cadence cancelled" |
| Double-approve (race) | 409 Conflict | Toast: "Already approved" |
| Generation fails 3× | — | `failed` badge; contact support |
