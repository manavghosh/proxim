# API Contracts: LinkedIn Connector Agent (F5)

**Branch**: `005-linkedin-connector-agent` | **Date**: 2026-05-06

All Next.js Route Handler endpoints follow the existing Proxim pattern. The Python agent communicates exclusively through the database — no HTTP calls between runtimes.

---

## GET `/api/candidates/[id]/jobs` — Extended Response

This endpoint (built in F4) is extended to include `outreachTarget` for `approved` jobs.

**No change to request** — same filters and sort params as F4.

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
      "...": "... existing F4 fields ...",
      "outreachTarget": {
        "id": "uuid",
        "status": "notes_ready",
        "name": "Sarah Chen",
        "linkedinUrl": "https://www.linkedin.com/in/sarahchen",
        "title": "VP of AI",
        "seniority": "VP_AI",
        "noteA": "Hi Sarah, your 3 years leading AI at Acme's scale is impressive...",
        "noteB": "Hi Sarah, saw Acme's move into agentic systems...",
        "selectedNote": null,
        "editedNote": null,
        "sentAt": null,
        "acceptedAt": null,
        "errorMessage": null
      }
    }
  ],
  "total": 42
}
```

`outreachTarget` is `null` for jobs not yet approved or where DNC applied.

---

## POST `/api/outreach/[targetId]/select-and-send`

Candidate selects a note variant (and optionally edits it) then sends the connection request.

**Request**
```
POST /api/outreach/:targetId/select-and-send?candidateId=uuid
Content-Type: application/json

{
  "selectedNote": "A",
  "editedNote": null
}
```

- `selectedNote`: `"A"` | `"B"` — which variant was chosen
- `editedNote`: `string | null` — if the candidate edited the note before sending; replaces selected variant text

**Response — 200 OK**
```json
{
  "targetId": "uuid",
  "status": "sent",
  "sentAt": "2026-05-06T10:30:00Z"
}
```

**Response — 200 OK (daily limit reached)**
```json
{
  "targetId": "uuid",
  "status": "queued",
  "message": "Daily connection limit (20) reached. This request will send tomorrow."
}
```

**Response — 409 Conflict** (already sent)
```json
{
  "error": "Connection request already sent",
  "currentStatus": "sent"
}
```

**Response — 403 Forbidden** (LinkedIn paused)
```json
{
  "error": "LinkedIn outreach is paused due to a rate-limit warning. Resume from Settings.",
  "currentStatus": "paused"
}
```

**Response — 422 Unprocessable**
```json
{
  "error": "outreach_target must be in 'notes_ready' status to send"
}
```

**Atomic safety**: Conditional UPDATE `WHERE status = 'notes_ready'` — if 0 rows affected, returns 409.

---

## GET `/api/outreach/[targetId]`

Fetch current outreach target status. Used for polling after sending to detect acceptance.

**Request**
```
GET /api/outreach/:targetId?candidateId=uuid
```

**Response — 200 OK**
```json
{
  "id": "uuid",
  "jobId": "uuid",
  "status": "accepted",
  "name": "Sarah Chen",
  "title": "VP of AI",
  "company": "Acme Corp",
  "noteA": "...",
  "noteB": "...",
  "selectedNote": "A",
  "editedNote": null,
  "sentAt": "2026-05-06T10:30:00Z",
  "acceptedAt": "2026-05-07T14:22:00Z",
  "errorMessage": null
}
```

---

## POST `/api/outreach/[targetId]/regenerate`

Request regeneration of connection note variants (e.g., candidate dislikes both). Re-queues the note generation step in the Python agent.

**Request**
```
POST /api/outreach/:targetId/regenerate?candidateId=uuid
```

**Response — 200 OK**
```json
{
  "targetId": "uuid",
  "status": "generating",
  "message": "Regenerating note variants. Refresh in ~30 seconds."
}
```

Marks `outreach_targets.status = 'generating'` and inserts a new `pipeline_jobs` row with `job_type = 'linkedin_note_regen'`.

---

## GET `/api/linkedin/status?candidateId=uuid`

Returns the LinkedIn integration status for the candidate — used by Settings page.

**Response — 200 OK**
```json
{
  "connected": true,
  "paused": false,
  "dailySendsToday": 7,
  "dailyLimit": 20,
  "queuedCount": 2,
  "doNotContactCompanies": ["Example Corp", "Bad Inc"]
}
```

---

## POST `/api/linkedin/resume`

Resume paused LinkedIn outreach after candidate acknowledges the rate-limit warning.

**Request**
```
POST /api/linkedin/resume?candidateId=uuid
```

**Response — 200 OK**
```json
{
  "paused": false,
  "message": "LinkedIn outreach resumed."
}
```

Sets `candidates.preferences.linkedin_paused = false`.

---

## Python Agent Internal — LinkedIn Connector Pipeline Job

The Python daemon processes `pipeline_jobs` with `job_type = 'linkedin_connector'`.

### Pipeline flow:

```
1. claim_pipeline_job(pool) → picks up job_type='linkedin_connector'
2. Parse payload: { job_id, candidate_id, company, job_title, archetype }
3. INSERT outreach_targets (status='pending')
4. Check DNC: preferences.do_not_contact_companies contains company?
   → YES: UPDATE status='skipped_dnc'; DONE
5. Proxycurl employee search (priority order):
   CAIO → CTO → VP AI → Head of AI → Eng Dir → HR/TA
   → None found: UPDATE status='no_contact_found'; DONE
   → Found: UPDATE status='enriching', store name/linkedinUrl/title/seniority
6. Proxycurl person enrichment (linkedinUrl)
   → Failure: UPDATE status='failed', error_message; DONE
   → Success: UPDATE enrichment_json; UPDATE status='generating'
7. LiteLLM note generation (up to 3 attempts):
   → All attempts fail validation: UPDATE status='failed'; DONE
   → Success: UPDATE note_a, note_b, status='notes_ready'
8. Mark pipeline_job status='completed'
```

### Daemon acceptance polling (24h loop):

```
SELECT id, linkedin_invitation_id, candidate_id FROM outreach_targets
WHERE status = 'sent' AND (last_polled_at IS NULL OR last_polled_at < now() - interval '24 hours')

For each:
  GET https://api.linkedin.com/v2/invitations/{invitation_id}
  → ACCEPTED: UPDATE status='accepted', accepted_at=now()
  → other: UPDATE last_polled_at=now()
  → If sent_at < now() - interval '30 days': UPDATE status='expired'
```

### Daemon queued sends (daily processor):

```
-- Runs once per hour (daemon tertiary loop, 3600s sleep)
SELECT COUNT(*) FROM outreach_targets
WHERE candidate_id = ? AND status='sent' AND sent_at::date = today

IF count < 20:
  SELECT id FROM outreach_targets
  WHERE candidate_id = ? AND status='queued'
  ORDER BY created_at LIMIT (20 - count)

  For each: attempt send via LinkedIn API → UPDATE status='sent', sent_at=now()
```

---

## Error Propagation

| Scenario | API Response | UI Behaviour |
|---|---|---|
| Proxycurl quota exhausted | 500 → `status='failed'` | "Discovery failed" badge; retry not automatic |
| LinkedIn 429 rate limit | 429 → `status='paused'` | Paused banner on dashboard; all pending queued |
| Double-send (race condition) | 409 Conflict | "Already sent" toast; card refreshes |
| No contact found | — (no send) | "No contact found" muted badge on card |
| DNC skip | — (no send) | "Do-not-contact" muted badge on card |
| Note generation 3× failure | — | "Note generation failed" badge; regenerate button visible |
