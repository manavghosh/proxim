# Research: LinkedIn Connector Agent (F5) — Phase 0

**Branch**: `005-linkedin-connector-agent` | **Date**: 2026-05-06
**Updated**: 2026-05-14 — Decisions 1 and 2 revised: Proxycurl replaced by Exa AI (Proxycurl shut down July 2026 due to LinkedIn lawsuit).

---

## Decision 1: Hiring Manager Discovery — Exa AI People Search

**Decision**: Use Exa's people search (`exa.search(query, category="person", num_results=1)`) with the query pattern `"{role} at {company_name}"`, iterating through roles in priority order (CAIO → CTO → VP AI → Head of AI → Engineering Director → HR/Talent Acquisition) and stopping at the first result.

**Background**: Proxycurl was shut down in July 2026 following a lawsuit brought by LinkedIn. The `agent/agent/proxycurl.py` module was rewritten as a drop-in Exa replacement — same `search_employees` / `enrich_profile` function signatures, same return shapes, zero changes required in `linkedin_connector.py` or the daemon.

**Key API details**:
```python
from exa_py import Exa
exa = Exa(api_key=EXA_API_KEY)
results = exa.search(
    f"{role} at {company_name}",
    category="person",
    num_results=1,
    use_autoprompt=False,
)
```
- Install: `pip install exa_py`
- Env var: `EXA_API_KEY` in `agent/.env`
- Free tier: 1,000 requests/month
- Returns: `result.url` (LinkedIn profile URL), `result.title` (name | role | LinkedIn)

**Return shape** (normalised to match original Proxycurl contract):
```python
{
    "name":        hit.title or "",   # parsed from "Name | Role at Company | LinkedIn"
    "title":       role,              # the role string that matched
    "profile_url": hit.url or "",     # LinkedIn public URL
}
```

**Fallback handling**:
- `no_contact_found` status if all role searches (including HR/Recruiter) return no result
- DNC check occurs before any Exa request (saves credits)
- `ProxycurlRateLimitError` is re-used as the exception class name for backwards compatibility; raised on HTTP 429 from Exa

**Alternatives considered** (re-evaluated after Proxycurl shutdown):
- **Hunter.io people search**: Rejected — email-focused, not designed for LinkedIn profile discovery by role seniority; used in F6 for email discovery instead
- **LinkedIn direct search**: Rejected — no official read API; scraping violates ToS
- **Apollo.io**: Rejected — SaaS credits model, ToS restricts automated use, higher per-lookup cost
- **RocketReach**: Rejected — contact-data focus rather than LinkedIn profile discovery; no free tier

---

## Decision 2: Profile Enrichment — Exa Content Fetch

**Decision**: Use `exa.get_contents([linkedin_url], text=True)` to fetch the LinkedIn profile page text; parse structured signals (name, headline, experiences, education) from the raw text using `_parse_profile_text()` in `proxycurl.py`.

**Rationale**:
Exa's content fetch returns the full text of a LinkedIn profile page. The `_parse_profile_text` function extracts best-effort signals by scanning the first 40 non-empty lines:
- **Name / headline**: parsed from the page `title` field (format: `"Name | Role at Company | LinkedIn"`)
- **Experience entries**: lines containing seniority keywords (`director`, `vp`, `head of`, `chief`, `manager`, ` at `, ` · `)
- **Education entries**: lines containing institution keywords (`university`, `iit`, `iim`, `college`, `institute`, `school of`)

**Return shape** (compatible with original `ProxycurlPersonEnrichment` TypeScript type):
```python
{
    "full_name":   str,
    "headline":    str,
    "summary":     None,           # not available from page text
    "experiences": list[dict],     # up to 5 entries: {title, company, starts_at, ends_at}
    "education":   list[dict],     # up to 3 entries: {degree_name, school, ends_at}
}
```

**Known limitations** (same category as original Proxycurl limitations):
- `starts_at` / `ends_at` dates are `None` — tenure cannot be calculated numerically; the note generation prompt falls back to role title as the tenure hook
- `summary` is `None` — no bio hook available; prompt relies on headline + experience title
- Parsing accuracy varies by profile structure; the note generation prompt is designed to degrade gracefully with partial signals

**Available hooks for note personalisation**:
1. Current role title (from `experiences[0].title`)
2. Education institution (alma mater hook, from `education[0].school.name`)
3. Headline (short bio hook, from `headline`)

**Alternatives considered**:
- **LinkedIn's own people API**: Rejected — requires LinkedIn partner access (restricted); impractical for MVP
- **Manual enrichment via candidate input**: Rejected — defeats automation purpose
- **Scraping LinkedIn directly (requests/Playwright)**: Rejected — violates ToS; high risk of IP bans

---

## Decision 3: LinkedIn Connection Request Sending — Official LinkedIn Invitations API

**Decision**: Use LinkedIn's official REST API `POST https://api.linkedin.com/v2/invitations` via OAuth 2.0 access token; the spec explicitly states LinkedIn auth is out of scope and assumed pre-configured.

**Note**: This decision is unchanged by the Proxycurl shutdown — the LinkedIn Invitations API is a separate write endpoint, unrelated to the read/enrichment layer that Proxycurl provided.

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
- **Proxycurl write endpoints**: Was read-only and is now shut down — not applicable

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

**Decision**: Store DNC company list as `string[]` in `candidates.preferences.do_not_contact_companies`; check before any Exa API call

**Rationale**:
Simplest viable approach for MVP. The DNC check is a string comparison: if `job.company.toLowerCase()` is in the candidate's `do_not_contact_companies` list (case-insensitive), skip the entire LinkedIn Connector pipeline for that job and mark `outreach_targets.status = 'skipped_dnc'`.

**Alternatives considered**:
- **Separate `do_not_contact` table**: Rejected — overkill for a small list maintained manually by the candidate
