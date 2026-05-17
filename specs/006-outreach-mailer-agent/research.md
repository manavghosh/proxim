# Research: Outreach Mailer Agent (F6) — Phase 0

**Branch**: `006-outreach-mailer-agent` | **Date**: 2026-05-14

---

## Decision 1: Email Discovery — Hunter.io Two-Pass Strategy

**Decision**: Run Email Finder first (person-level lookup using hiring manager name + domain), then fall back to Domain Search if the Finder returns no result or confidence < 70%.

**Rationale**:
Hunter.io exposes two complementary endpoints:

| Endpoint | Usage | Credits |
|---|---|---|
| `GET /v2/email-finder?domain=&first_name=&last_name=` | Person-level lookup given a name | 1 per call |
| `GET /v2/domain-search?domain=&limit=10` | All addresses at a domain, sorted by confidence | 1 per call |
| `GET /v2/email-verifier?email=` | Verify a specific address | 1 per call |

**Pass 1 — Email Finder**: Uses the hiring manager name discovered by F5 (Proxycurl enrichment, stored in `outreach_targets.name`). Returns `{ email, score }` where `score` is 0–100. If `score >= 70`, use this email.

**Pass 2 — Domain Search fallback**: If Finder returns no result or `score < 70`, query Domain Search for the company domain. Select the highest-confidence entry where `type = 'personal'` (not catch-all). If that entry has `confidence >= 70`, use it.

**Manual override path**: If both passes fail or confidence < 70%, store the best candidate in `outreach_targets.email` and `outreach_targets.email_confidence` but set `email_cadences.status = 'low_confidence'`. The dashboard shows the candidate address + confidence score with a "Send anyway" override button (per FR-002).

**Domain extraction**: Strip `www.` from company website URL stored in job enrichment data. If website is unavailable, construct domain from company name using a simple slugify rule (e.g., `"Acme Corp"` → `acme.com`). Flag as lower confidence when domain is constructed.

**Alternatives considered**:
- **Clearbit Enrichment**: Rejected — higher per-lookup cost, no free tier, primarily designed for B2B lead enrichment not individual email discovery.
- **Apollo.io**: Rejected — SaaS credits model, not designed for single-person lookups, ToS restricts automated use.
- **Scraping company website contact pages**: Rejected — too fragile, blocked by many enterprise sites, produces unverified results.

---

## Decision 2: Gmail API — Sending, Threading, and Attachments

**Decision**: Use Google Gmail API v1 via `google-api-python-client` in the Python agent. Auth via stored OAuth2 access + refresh token in `candidates.preferences`. Thread all three emails under one `threadId` using `In-Reply-To` + `References` MIME headers.

**Rationale**:

**Sending**: `POST https://gmail.googleapis.com/gmail/v1/users/me/messages/send` with MIME message body. Sent emails automatically appear in the candidate's Gmail Sent folder — no extra step required.

**OAuth2 scopes**:
- `https://www.googleapis.com/auth/gmail.send` — send messages
- `https://www.googleapis.com/auth/gmail.readonly` — read inbox for reply/bounce detection

Token refresh: Use `google.oauth2.credentials.Credentials` with `refresh_token` stored in candidate preferences. On `google.auth.exceptions.RefreshError`, set `email_cadences.status = 'auth_expired'` and notify candidate via dashboard.

**Threading (FR-007)**:
Day 1 sends with a new subject `Re: {Job Title} @ {Company}` (the spec requires `Re:` prefix and threading — Day 1 IS the opener, so subject uses `Re:` to signal it's part of a thread). Day 1's `Message-ID` header is stored in `email_drafts.gmail_message_id`.

Day 3 and Day 7 MIME headers:
```
In-Reply-To: <day1_message_id>
References: <day1_message_id>
```
Gmail uses these headers to stitch them into the same thread. Additionally, pass `threadId` from Day 1's `gmail_thread_id` in the send request body.

**Attachments (FR-010)**: Day 1 uses `MIMEMultipart('mixed')`. Resume PDF and cover letter PDF are fetched from `resume_versions` table (latest approved version for the job's candidate + archetype). Attached as `application/pdf` with filenames `[candidateName]-resume.pdf` and `[company]-cover-letter.pdf`.

**Attachment gating**: If no PDF exists when Day 1 fires, set `email_cadences.status = 'attachment_missing'`, notify candidate, do not send.

**Alternatives considered**:
- **SMTP direct send (smtplib)**: Rejected — Gmail's SMTP-AUTH is deprecated for OAuth accounts; does not guarantee Sent folder visibility.
- **SendGrid / Mailgun relay**: Rejected — emails would NOT appear in candidate's Gmail Sent folder (FR-015); spec explicitly requires sending from candidate's own Gmail account.
- **Gmail API via requests (manual HTTP)**: Rejected — `google-api-python-client` handles token refresh, pagination, and retry automatically; no benefit to raw HTTP.

---

## Decision 3: Email Tracking — Custom Next.js Redirect Endpoints

**Decision**: Embed a 1×1 transparent PNG tracking pixel for opens and redirect URLs for clicks, both served by Next.js route handlers. No third-party email tracking service.

**Rationale**:

**Open tracking**:
- Embed `<img src="https://{host}/api/track/open/{draftId}" width="1" height="1">` in Day 1's HTML body (optional on Day 3/7 — same mechanism).
- `GET /api/track/open/[draftId]` → sets `email_drafts.open_detected_at = now()` → returns a 1×1 transparent GIF with `Cache-Control: no-store`.
- Limitation: image blocking (Apple Mail Privacy Protection) causes false positives. Acknowledged limitation; spec does not require 100% accuracy.

**Click tracking**:
- Any links in email body are replaced with `https://{host}/api/track/click/[draftId]?url={encodedOriginalUrl}`.
- `GET /api/track/click/[draftId]` → sets `email_drafts.click_detected_at = now()` → `301` redirect to original URL.

**Reply detection**:
- Python daemon secondary coroutine polls Gmail `INBOX` every hour: `GET users/me/messages?q=subject:"Re: {subject}" in:inbox`.
- If any message has `In-Reply-To` matching the Day 1 `Message-ID` → set `email_cadences.reply_detected_at = now()`, `status = 'replied'`.
- Cancel any pending scheduled sends.

**Bounce detection**:
- Gmail delivers bounce messages from `mailer-daemon@googlemail.com` to `INBOX`. Python daemon checks hourly for messages with `from:mailer-daemon` that contain the Day 1 `Message-ID` in the body.
- On detection: set `email_cadences.bounce_detected_at = now()`, `email_drafts.status = 'bounced'` for Day 1, `status = 'cancelled'` for Day 3 + Day 7 (FR-014).

**Alternatives considered**:
- **Postmark / SparkPost tracking webhooks**: Rejected — emails must be sent via their service; violates FR-015 (must send from candidate's Gmail).
- **Gmail push notifications (Pub/Sub)**: Considered but rejected for MVP — requires GCP Pub/Sub setup, domain verification, added infra complexity. Polling is sufficient.

---

## Decision 4: Cadence Scheduling — DB-Driven Daemon Polling Loop

**Decision**: Store `scheduled_send_at` timestamps in `email_drafts`. A Python daemon coroutine polls every 3 minutes for `status='approved' AND scheduled_send_at <= now()` and sends eligible emails after checking reply/bounce state.

**Rationale**:
Per the spec assumption: "Email scheduling is managed by the Python agent service's polling loop." The daemon already has multiple coroutines. Adding a cadence polling coroutine with `asyncio.sleep(180)` is consistent with the F5 LinkedIn acceptance polling pattern (24h sleep). 3-minute polling gives worst-case ±3min delivery window, well within SC-003's ±15min requirement.

**Scheduling logic**:
- Day 1: `scheduled_send_at = approved_at` (immediate, conditional on attachment availability)
- Day 3: `scheduled_send_at = day1_sent_at + 72 hours`
- Day 7: `scheduled_send_at = day1_sent_at + 168 hours`

**Daily volume cap (FR-016)**: Before each send, count `email_drafts WHERE candidate_id=? AND sent_at::date = today`. If `>= 20`, defer by recording `status='rate_limited'` and next attempt checks again at next poll cycle.

**Cadence pre-check before send**:
```python
# Before sending Day 3 or Day 7:
assert cadence.status == 'active'
assert cadence.reply_detected_at is None
assert cadence.bounce_detected_at is None
```

**Alternatives considered**:
- **Celery + Redis**: The spec mentions it as available but Celery requires a Redis broker, adds infra complexity, and introduces a second runtime dependency. DB-polling is consistent with the existing architecture and sufficient for the ±15min SLA.
- **APScheduler in-process**: Rejected — schedule state is lost on restart (FR-018 requires all cadence state to survive restarts). DB-driven timestamps survive restarts by definition.
- **`pg_cron` / Neon scheduled triggers**: Rejected — cannot make HTTP calls to Gmail API from within Postgres.

---

## Decision 5: Email Generation — LiteLLM + Pydantic Validation + Self-Review

**Decision**: LiteLLM single call returning `EmailCadence` Pydantic model with all three drafts; `@field_validator` enforces word count limits and forbidden phrases (FR-005); a second LLM call acts as self-reviewer (FR-008) scoring each draft on a "would a human send this?" rubric.

**Rationale**:

**Generation call**:
```python
class EmailDraftOutput(BaseModel):
    subject: str                  # shared subject line for all three
    day1_body: str                # ≤150 words
    day3_body: str                # ≤100 words, no "following up"/"checking in"
    day7_body: str                # ≤80 words, low-commitment

    @field_validator("day1_body")
    def validate_day1(cls, v: str) -> str:
        word_count = len(v.split())
        if word_count > 150:
            raise ValueError(f"Day 1 exceeds 150 words ({word_count})")
        return v

    @field_validator("day3_body")
    def validate_day3(cls, v: str) -> str:
        word_count = len(v.split())
        if word_count > 100:
            raise ValueError(f"Day 3 exceeds 100 words ({word_count})")
        forbidden = ["following up", "checking in", "just following", "just checking"]
        for phrase in forbidden:
            if phrase.lower() in v.lower():
                raise ValueError(f"Forbidden phrase in Day 3: '{phrase}'")
        return v

    @field_validator("day7_body")
    def validate_day7(cls, v: str) -> str:
        word_count = len(v.split())
        if word_count > 80:
            raise ValueError(f"Day 7 exceeds 80 words ({word_count})")
        pressure_phrases = ["last chance", "final follow-up", "urgent", "time-sensitive"]
        for phrase in pressure_phrases:
            if phrase.lower() in v.lower():
                raise ValueError(f"Pressure phrase in Day 7: '{phrase}'")
        return v
```

**Self-review call (FR-008)**: Second LiteLLM call with `SelfReviewResult` model: `{ passes: bool, feedback: str }`. Prompt: "Would a senior human professional send this email to a hiring manager? Score each email on: personalisation, tone, value-proposition clarity, absence of spam signals." If `passes=False`, the generation node retries (max 3 attempts total).

**Personalisation inputs** (from F5 enrichment + job data):
- Hiring manager name, current role, company
- Manager tenure (calculated from `enrichment_json.experiences[0].starts_at`)
- One specific hook: company's recent product launch / funding / strategic initiative (from job description's `enrichment_data` field)
- Candidate's most relevant proof point for this archetype (from `jobs.archetype + candidates.parsed_profile`)

**Alternatives considered**:
- **Separate LLM calls per email**: Rejected — more expensive, harder to ensure the three emails form a coherent narrative arc with shared subject and threading context.
- **Template-based generation with slot-filling**: Rejected — produces formulaic output that fails FR-004 (must open with specific detail about person or company) and FR-008 (self-review would likely flag it).

---

## Decision 6: Daily 20-Email Cap Enforcement

**Decision**: Count `email_drafts WHERE candidate_id=? AND sent_at::date=today AND status='sent'` before each send. If `>= 20`, update the draft's `status = 'rate_limited'` and `scheduled_send_at += 1 day`. Log to `pipeline_logs`.

**Rationale**:
Mirrors the LinkedIn 20/day cap implementation from F5. Simple DB count, no extra table. The `scheduled_send_at` bump-by-one-day ensures the daemon naturally retries the next UTC day without a separate queue mechanism.

**Note**: The 20/day cap counts ALL emails across ALL active cadences for the candidate. This prevents the candidate from unknowingly violating Gmail's per-day send limits during heavy pipeline activity.

---

## Decision 7: Outreach Mailer Trigger — Alongside F5 LinkedIn Connector

**Decision**: `POST /api/jobs/[jobId]/approve` inserts a `pipeline_jobs` row with `job_type='outreach_mailer'` alongside the existing `resume_builder` and `linkedin_connector` rows. The Python daemon handles all three types independently and concurrently.

**Rationale**:
F6 is fully independent of F5 (per spec: "F5 and F6 are independent outreach tracks for the same approved job"). Neither blocks the other. The daemon processes them concurrently via `asyncio.create_task`. Email discovery (Hunter.io) does not depend on LinkedIn discovery (Proxycurl) completing first.

**Note on F10 dependency**: Day 1 attachment requires resume + cover letter PDFs from F10 (Resume Builder). The `resume_builder` pipeline job also fires on approval. If `resume_builder` is still running when Day 1 is scheduled to fire, the send daemon checks `resume_versions` for the latest approved version. If none exists: hold Day 1 in `attachment_missing` status and re-check every 5 minutes for up to 1 hour, then notify candidate.
