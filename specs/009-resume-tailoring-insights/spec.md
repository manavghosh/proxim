# Feature Specification: Resume Tailoring Visibility & Outreach Insights

**Feature Branch**: `009-resume-tailoring-insights`  
**Created**: 2026-05-26  
**Status**: Draft  
**Input**: Surface existing resume tailoring backend capabilities in the UI, and display outreach performance metrics (funnel, rates, archetype breakdown) on the dashboard.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — See What Was Tailored in My Resume (Priority: P1)

A senior IT professional approves a job, clicks "✨ Tailor for This Role", waits for the resume
to generate, and then — without leaving the job card — sees exactly which keywords were injected
from the job description and which archetype the system detected. They can open the tailored PDF
and confirm the resume is personalised for this specific role.

**Why this priority**: This is the headline competitive differentiator vs. trypoet.ai. Without
this visibility, candidates trust a black-box resume generator. With it, they see the system
working for them — which drives confidence and retention.

**Independent Test**: Can be fully tested by approving a single job with a JD already fetched,
triggering tailoring, and verifying the TailoredResumeCard renders with at least one keyword badge
and the detected archetype name.

**Acceptance Scenarios**:

1. **Given** a job with `status = 'approved'` and a fetched JD (`jd_raw` non-empty), **When** the
   user clicks "✨ Tailor for This Role", **Then** the BuildProgressPane shows generation progress
   and upon completion a `TailoredResumeCard` appears with keyword pill badges, the archetype name,
   confidence level, and links to the PDF and cover letter.

2. **Given** a job where `resume_versions` already exists, **When** the user expands the job card,
   **Then** the `TailoredResumeCard` renders immediately (no button shown) with all tailoring
   details visible.

3. **Given** a job with an empty `jd_raw`, **When** the user views the job card, **Then** the
   "✨ Tailor for This Role" button is disabled and shows a tooltip: "Fetch JD first before
   tailoring".

4. **Given** a job where `resume_versions.keywords` is an empty array, **When** the
   `TailoredResumeCard` renders, **Then** it shows "No keywords detected" in muted text rather
   than crashing or showing an empty section.

5. **Given** a job where `archetypeConfidence < 0.5`, **When** the `TailoredResumeCard` renders,
   **Then** the archetype is shown with an amber "Low confidence" badge alongside it.

---

### User Story 2 — Stale Resume Warning (Priority: P2)

A candidate uploaded their CV in March, had resumes tailored for 5 jobs, then updated their CV
in May to add a new project. When they return to the pipeline, each job card with a previously
tailored resume shows an amber warning: "CV updated since tailoring — consider re-tailoring."
They can click "✨ Tailor for This Role" again to regenerate.

**Why this priority**: Sending outdated resumes erodes the core value proposition. The warning
prevents silent quality degradation without blocking the user from proceeding.

**Independent Test**: Can be fully tested by (1) generating a resume for a job, (2) updating the
CV via the settings page, and (3) verifying the amber warning banner appears on the job card on
next load.

**Acceptance Scenarios**:

1. **Given** a job where `resume_versions.baseCvHash` differs from `candidates.baseCvHash`,
   **When** the user expands the job card, **Then** an amber banner reads "CV updated since
   tailoring — consider re-tailoring."

2. **Given** a job where `resume_versions.baseCvHash` matches `candidates.baseCvHash`, **When**
   the user expands the job card, **Then** no stale warning is shown.

3. **Given** a job with a stale resume warning, **When** the user clicks "✨ Tailor for This
   Role" to regenerate, **Then** a new `resume_versions` row is created and the stale warning
   disappears on the next render.

---

### User Story 3 — View Outreach Funnel on Dashboard (Priority: P2)

A candidate opens the dashboard and sees a compact `InsightsFunnelCard` showing: how many jobs
were discovered, approved, had emails sent, opened, replied to, and converted to interview
callbacks. Four rate metrics are shown: email open rate, reply rate, A/B grade mix, and callback
rate. When no outreach has been sent yet, the card shows a graceful empty state.

**Why this priority**: Without this, candidates cannot distinguish between "my outreach isn't
working" and "I haven't sent enough outreach yet." It closes the feedback loop on the core value
proposition.

**Independent Test**: Can be fully tested on a candidate with at least one sent email cadence.
Verify funnel counts match direct DB queries. Also verify empty state renders correctly on a
brand-new candidate with zero jobs.

**Acceptance Scenarios**:

1. **Given** a candidate with sent emails, **When** the dashboard loads, **Then** the
   `InsightsFunnelCard` renders with the correct discovered/approved/sent/opened/replied/callback
   counts, matching the values in the database.

2. **Given** zero emails have been sent, **When** the dashboard loads, **Then** open rate and
   reply rate display "—" (not "0%") and a note reads "Send your first email to see performance
   data."

3. **Given** one email was opened but has no `sentAt` (data integrity gap), **When** the insights
   are computed, **Then** that orphaned open is excluded from the open rate calculation.

4. **Given** a cadence with `status = 'cancelled'` that received a reply after cancellation,
   **When** insights are computed, **Then** the reply is counted in the funnel (reply happened
   regardless of cancellation status).

---

### User Story 4 — Archetype Learning Breakdown (Priority: P3)

A candidate who has sent outreach for multiple job archetypes (Enterprise CAIO, AI Product Lead,
Startup CTO) sees a breakdown table in the InsightsFunnelCard showing which archetype generated
the most replies. They use this to inform future approvals — focusing more on Enterprise CAIO
roles since those yield higher reply rates.

**Why this priority**: This is the learning loop that makes Proxim strategically valuable over
time. It's P3 because the funnel (US-3) must exist first, and a candidate needs sufficient
outreach history to make the breakdown meaningful.

**Independent Test**: Can be tested with a seed scenario: jobs with two different archetypes,
some with replied cadences and some without. Verify the breakdown table ranks archetypes by
reply rate descending.

**Acceptance Scenarios**:

1. **Given** jobs with multiple archetypes where one archetype has 2 replies and another has 0,
   **When** the insights card renders, **Then** the replied archetype appears first in the
   breakdown table.

2. **Given** jobs where `archetype` is null (not yet detected), **When** insights are computed,
   **Then** those jobs are excluded from the archetype breakdown without affecting other metrics.

3. **Given** fewer than 2 approved archetypes, **When** the card renders, **Then** the archetype
   section is hidden (insufficient data to show a meaningful breakdown).

---

### User Story 5 — Per-Draft Engagement Indicators (Priority: P3)

A candidate using manual send mode sends Day 1 to a hiring manager. The next day, they open the
email outreach panel and see a small status row beneath the Day 1 draft: "✉ Sent 3 May  👁 Opened
4 May." This confirms the hiring manager received and opened the email, helping the candidate
decide whether to proceed with Day 3.

**Why this priority**: Nice-to-have context that enriches the manual outreach experience. P3
because the data is already tracked — it only needs to be rendered.

**Independent Test**: Can be tested by (1) confirming a draft's `sentAt` and `openDetectedAt` are
set in the DB, and (2) verifying the timestamps appear in the email panel UI on next load.

**Acceptance Scenarios**:

1. **Given** a draft with `sentAt` set and `openDetectedAt` set, **When** the email panel renders,
   **Then** a status row shows the sent date and opened date.

2. **Given** a draft with `sentAt` set but `openDetectedAt` null, **When** the email panel
   renders, **Then** the status row shows the sent date and "Not opened yet."

3. **Given** a draft with `sentAt` null (not yet sent), **When** the email panel renders, **Then**
   no status row is shown for that draft.

---

### Edge Cases

**Resume tailoring edge cases:**
- `resume_versions.resumePdfPath` is null (PDF generation in progress) → show spinner, poll every
  3s until path appears or `generationStatus` transitions to `failed`
- Multiple `resume_versions` rows for same job (due to retries) → show highest `versionN` row
- Resume generation fails mid-way (`generationStatus = 'error'`) → show existing retry button;
  `TailoredResumeCard` does not render
- Job status transitions to `rejected` after resume generated → `TailoredResumeCard` renders as
  read-only (informational; no actions available)
- Email cadence is in `attachment_missing` status → cadence shows "Waiting for resume" badge;
  resolved automatically once PDF lands
- `keywords` array contains empty strings → filter empty strings before rendering badges

**Insights edge cases:**
- Tracking pixel blocked by corporate email client → open rate silently under-reports; tooltip
  clarifies this limitation
- Multiple Day 1 drafts for same cadence (retries) → count only the most recent `sentAt` per
  cadence to avoid double-counting sends
- `interviewCallbackAt` toggled off by user → callback rate updates immediately on next fetch
- Large dataset (candidate active for 6+ months) → queries use existing `candidate_id` indexes;
  no N+1 queries
- InsightsFunnelCard fetch fails (API error) → card shows error state with retry; does not block
  rest of dashboard from loading

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: When a `resume_versions` row exists for a job, the system MUST render a
  `TailoredResumeCard` inside the expanded job card showing injected keywords, detected archetype,
  confidence level, PDF link, and cover letter link.

- **FR-002**: The "Generate Resume" button label MUST be renamed "✨ Tailor for This Role" across
  all contexts where it currently appears.

- **FR-003**: The system MUST disable the "✨ Tailor for This Role" button when `jd_raw` is empty
  for a job, and display a tooltip explaining that the JD must be fetched first.

- **FR-004**: When `resume_versions.baseCvHash` differs from `candidates.baseCvHash`, the system
  MUST display an amber warning on the `TailoredResumeCard` prompting the user to consider
  re-tailoring.

- **FR-005**: The dashboard page MUST include an `InsightsFunnelCard` displayed below the
  `JobSearchCard` showing the outreach funnel with stage counts and inter-stage conversion rates.

- **FR-006**: The `InsightsFunnelCard` MUST display four rate metrics: email open rate, reply
  rate, A/B grade mix, and interview callback rate. Rates MUST show "—" when the denominator is
  zero.

- **FR-007**: The `InsightsFunnelCard` MUST display a top-5 archetype breakdown table sorted by
  reply rate descending. The breakdown MUST be hidden when fewer than 2 archetypes have approved
  jobs.

- **FR-008**: Each email draft card MUST display a status row showing sent date, opened date (or
  "Not opened yet"), and clicked date (or nothing) — only when `sentAt` is set.

- **FR-009**: The insights API MUST return null-safe values for all rate metrics when no outreach
  has been sent. The dashboard MUST render a graceful empty state rather than an error.

- **FR-010**: The `InsightsFunnelCard` MUST load in parallel with existing dashboard data (not
  sequentially) to prevent it from increasing perceived page load time.

### Key Entities

- **ResumeVersionSummary**: Per-job tailored resume record. Key attributes: id, jobId,
  candidateId, keywords (string[]), archetype, archetypeConfidence, versionN, resumePdfPath,
  coverLetterPdfPath, baseCvHash, generationStatus.

- **InsightsResponse**: Aggregated outreach performance snapshot. Key attributes: funnel (stage
  counts), rates (open/reply/grade/callback), archetypeBreakdown (top-5 rows with sent/replied
  counts and reply rate).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-01**: A user who generates a tailored resume can see the injected keywords and archetype
  within 3 seconds of generation completing, without leaving the job card.

- **SC-02**: A user whose CV was updated after resume generation sees a stale warning on all
  affected job cards within one page load (no additional action required).

- **SC-03**: A user with at least one sent email sees their complete outreach funnel on the
  dashboard within 2 seconds of page load.

- **SC-04**: The archetype breakdown correctly ranks the highest-reply-rate archetype first when
  one archetype has ≥2 replies and another has 0 replies.

- **SC-05**: Per-draft open timestamps appear in the email outreach panel within one polling cycle
  (≤3 seconds) after the tracking event is recorded.

- **SC-06**: All success criteria above hold when zero outreach has been sent — empty states render
  without errors and no metrics show "0%" for undefined rates.

## Assumptions

- The `resume_versions` table already exists with `keywords` (JSONB), `archetype`,
  `archetypeConfidence`, `baseCvHash`, `generationStatus`, `versionN`, `resumePdfPath`, and
  `coverLetterPdfPath` columns — no schema migration required.
- Email open and click tracking infrastructure (`openDetectedAt`, `clickDetectedAt` on
  `emailDrafts`) is already in production and recording events correctly.
- The `baseCvHash` on `candidates` is updated every time the user saves a new CV (existing
  behaviour in `cv-service.ts`).
- The dashboard page can add one additional parallel fetch to its existing `Promise.all` without
  meaningful impact on Time to First Contentful Paint (the other fetches are similarly fast
  Drizzle queries).
- This feature is UI-only — no changes to the Python agent service or LangGraph pipeline are
  required.
- Mobile support is out of scope; the dashboard is desktop-first.
- Historical insights (trends over time, date range filtering) are deferred to a future spec.
