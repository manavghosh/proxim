# Research: LinkedIn Connector Agent (F5) — Phase 0

**Branch**: `005-linkedin-connector-agent` | **Date**: 2026-05-06

---

## Decision 1: Hiring Manager Discovery — Proxycurl Employee Search

**Decision**: Use Proxycurl `GET /api/v2/linkedin/company/employees/` with sequential role priority lookups (CAIO → CTO → VP AI → Head of AI → Engineering Director → HR/Talent Acquisition)

**Rationale**:
Proxycurl's Company Employee Search endpoint allows filtering by job title for a given company. Because a single title search returns one best match, the discovery node executes one title query per role in priority order, stopping at the first result. If none of the technical titles yield a result, the system falls back to an HR/Talent Acquisition search. This sequential approach avoids unnecessary credits for companies where the first title matches.

**Key endpoint details**:
- URL: `GET https://nubela.co/proxycurl/api/v2/linkedin/company/employees/`
- Parameters: `company_name` (or `linkedin_company_url`), `role` (text filter), `enrich_profiles=enrich`
- Credits: 10 per request + 6 per returned employee profile
- Coverage: US, UK, Canada, Israel, Australia, Ireland, New Zealand, Singapore (limited for other geographies)

**Fallback handling**:
- `no_contact_found` status if all searches (including HR) return no result
- DNC check occurs before any Proxycurl request (saves credits)

**Alternatives considered**:
- **Exa AI people search**: Rejected — returns unstructured web results; requires additional parsing; less reliable for LinkedIn profile URLs
- **Hunter.io**: Rejected — email-focused; not designed for LinkedIn discovery by role seniority
- **LinkedIn direct search**: Rejected — no official read API; scraping violates ToS

---

## Decision 2: Profile Enrichment — Proxycurl Person API

**Decision**: Use Proxycurl `GET /api/v2/linkedin/person/` with the discovered profile URL; derive tenure from dates; use work history and education as personalisation hooks

**Rationale**:
Proxycurl's Person enrichment API returns: current role with start date, work history, education records, skills, and bio summary. Current role tenure can be calculated as `(today - role.start_date).months`. Recent posts are NOT returned by Proxycurl — this is a known limitation. The note generation prompt compensates with: current role + tenure, education signals, and the candidate's most relevant proof point for the company's context (from the approved job's archetype data).

**Available hooks for personalisation**:
1. Current role tenure (calculated from `experiences[0].starts_at`)
2. Most recent company stage (from enrichment work history)
3. Education institution (alma mater hook)
4. Headline/summary (short bio hook)

**Unavailable hooks** (noted in FR-004 as required but Proxycurl does not provide):
- Recent posts (last 30 days): Not available via Proxycurl. Fallback: use tenure + education hooks only
- Shared connections: Not available. Omit from personalisation
- These limitations are documented and the LLM prompt instructs to generate notes with available signals only (per edge case spec: "if no hooks exist, notes rely on the candidate's most relevant proof point")

**Alternatives considered**:
- **LinkedIn's own people search API**: Rejected — requires LinkedIn partner access (restricted); impractical for an MVP
- **Manual enrichment via candidate input**: Rejected — defeats automation purpose

---

## Decision 3: LinkedIn Connection Request Sending — Official LinkedIn Invitations API

**Decision**: Use LinkedIn's official REST API `POST https://api.linkedin.com/v2/invitations` via OAuth 2.0 access token; the spec explicitly states LinkedIn auth is out of scope and assumed pre-configured

**Rationale**:
The spec assumption: "The candidate has authorised Proxim to act on their LinkedIn account (OAuth or API token) — the mechanism for initial LinkedIn authorisation is out of scope for this feature spec and assumed to be handled in an onboarding step."

Given this, the implementation uses:
- Auth: LinkedIn OAuth 2.0 `access_token` stored in candidate preferences/secrets
- Endpoint: `POST https://api.linkedin.com/v2/invitations`
- Body: `{ "invitee": { "com.linkedin.voyager.growth.invitation.InviteeProfile": { "profileId": "<profileId>" } }, "message": "<selected_note>" }`
- Rate limits: LinkedIn enforces a weekly connection request limit; we additionally enforce our own 20/day cap

**Rate-limit violation response**:
- LinkedIn returns HTTP 429 or a specific error code when the account is rate-limited
- On detection: set `candidates.preferences.linkedin_paused = true`; update `outreach_targets.status = 'paused'`; notify user via SSE/dashboard badge

**Alternatives considered**:
- **tomquirk/linkedin-api Python library**: Rejected — uses credential-based scraping; violates LinkedIn ToS; high risk of account suspension; inappropriate for a production product
- **PhantomBuster API**: Rejected — SaaS with per-action pricing; not suitable for per-candidate per-job fine-grained control; bulk-scheduling oriented
- **Proxycurl write endpoints**: Confirmed unavailable — Proxycurl is read-only

---

## Decision 4: A/B Connection Note Generation — LiteLLM + Pydantic Validation

**Decision**: LiteLLM completion call with `response_format=NoteVariants` (Pydantic model); `@field_validator` enforces ≤300 chars and forbidden-phrase check; LangGraph conditional edge retries up to 3× on validation failure

**Rationale**:
LiteLLM supports Pydantic model `response_format` which is automatically converted to JSON Schema. Pydantic validators run synchronously after parsing — no additional LLM call needed for validation. If validation fails (note > 300 chars or forbidden phrase detected), the error message is appended to the conversation and the generate node retries.

```python
class NoteVariants(BaseModel):
    note_a: str
    note_b: str

    @field_validator("note_a", "note_b")
    @classmethod
    def validate_note(cls, v: str) -> str:
        if len(v) > 300:
            raise ValueError(f"Exceeds 300 chars ({len(v)})")
        forbidden = ["I saw your job posting", "I noticed your job posting",
                     "I came across your job posting"]
        for phrase in forbidden:
            if phrase.lower() in v.lower():
                raise ValueError(f"Forbidden phrase: '{phrase}'")
        return v
```

**LangGraph node pattern**: `generate_notes` → `validate_notes_edge` (conditional) → `generate_notes` (retry, max 3) or `write_checkpoint` (success)

**Alternatives considered**:
- **Two separate LLM calls (one per variant)**: Rejected — doubles cost; no guarantee of distinctiveness between independently generated notes
- **Post-generation regex validation in a separate node**: Rejected — Pydantic field validators are cleaner and co-located with the data model; no additional node needed

---

## Decision 5: Daily Rate Limit Enforcement (20/day cap)

**Decision**: Count `outreach_targets WHERE candidate_id = ? AND sent_at::date = today::date` before each send; if count ≥ 20, set `status = 'queued'` with no send; a daemon job processes queued targets the next calendar day (UTC midnight reset)

**Rationale**:
A simple DB count is atomic, accurate, and requires no additional table. The `sent_at` column timestamp allows querying by date. If rate limit is hit, the target is marked `queued` and the candidate sees a "queued" status badge on the dashboard card. The daemon's secondary loop (already exists for snooze resurface) gains a third check: process `outreach_targets WHERE status='queued'` and `linkedin_paused IS NOT TRUE` when the daily count < 20.

**Alternatives considered**:
- **Separate `linkedin_rate_limits` table**: Rejected — overkill; a COUNT query on `outreach_targets` achieves the same result with zero extra schema
- **In-memory counter in daemon**: Rejected — lost on restart; not accurate across multiple workers

---

## Decision 6: Acceptance / Reply Status Polling

**Decision**: Python daemon tertiary coroutine polls LinkedIn Invitations API every 24 hours for `outreach_targets WHERE status='sent'`; updates `accepted_at` when accepted

**Rationale**:
LinkedIn doesn't push webhooks for connection acceptance. Polling is the only option. A 24-hour interval satisfies FR-012 ("no more frequently than every 24 hours"). The daemon already has multiple coroutines (job polling, snooze resurface); a third coroutine with `asyncio.sleep(86400)` is a natural extension.

**Polling approach**:
- `GET https://api.linkedin.com/v2/invitations?start=0&count=50&direction=SENT`
- Find records matching sent LinkedIn profile URLs
- If invitation status = `ACCEPTED`: update `outreach_targets.accepted_at = now()`, `status = 'accepted'`
- If invitation status = `WITHDRAWN` or timed out (>30 days): update `status = 'expired'`

---

## Decision 7: Dashboard Extension — Note Variant Selection UI

**Decision**: Extend the existing `JobReviewCard` with a new `OutreachNoteSelector` section; shown only on approved jobs with `status = 'notes_ready'`; reuses existing shadcn Card, Button, Badge components

**Rationale**:
The spec states "the LinkedIn approval card is an extension of the existing job approval flow, not a separate page." The outreach section appears below the existing approve/reject/snooze actions on cards that already have `approved` status. It does not disrupt the HITL gate flow — approval and outreach are sequential stages on the same card.

A new `outreachTarget` field is included in `GET /api/candidates/[id]/jobs` response (for approved jobs). The UI renders two radio buttons with the note text, an optional edit textarea, and a Send button.

**Status display**:
- `notes_ready` → Show note selector
- `sent` → Show "Sent · Pending acceptance" badge
- `queued` → Show "Queued — sends tomorrow" badge
- `accepted` → Show "Connected ✓" badge (green)
- `no_contact_found` → Show "No contact found" badge (muted)
- `skipped_dnc` → Show "Do-not-contact" badge (muted)
- `paused` → Show "LinkedIn paused — rate limit" warning badge

---

## Decision 8: Do-Not-Contact Implementation

**Decision**: Store DNC company list as `string[]` in `candidates.preferences.do_not_contact_companies`; check before any Proxycurl API call

**Rationale**:
Simplest viable approach for MVP. The DNC check is a string comparison: if `job.company.toLowerCase()` is in the candidate's `do_not_contact_companies` list (case-insensitive), skip the entire LinkedIn Connector pipeline for that job and mark `outreach_targets.status = 'skipped_dnc'`.

**Alternatives considered**:
- **Separate `do_not_contact` table**: Rejected — overkill for a small list maintained manually by the candidate
