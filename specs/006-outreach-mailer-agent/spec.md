# Feature Specification: Outreach Mailer Agent (F6)

**Feature Branch**: `006-outreach-mailer-agent`
**Created**: 2026-04-30
**Status**: Draft
**Phase**: 4 — Outreach

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Three-Email Cadence Fires After Job Approval (Priority: P1)

After the candidate approves a job, the system locates the hiring manager's email, generates a personalised 3-email cadence (Day 1 intro, Day 3 value-add, Day 7 gentle close), and fires the Day 1 email with the resume and cover letter PDFs attached. The subsequent emails fire automatically unless a reply is received.

**Why this priority**: Email outreach is the primary application mechanism. Without it, the pipeline produces no applications.

**Independent Test**: Can be tested by approving a fixture job with a known email, verifying the Day 1 email is sent with PDFs attached, Day 3 fires at +72h with no reply, and Day 7 fires at +168h with no reply.

**Acceptance Scenarios**:

1. **Given** a job is approved and a hiring manager email is found with confidence ≥ 70%, **When** the Day 1 email fires, **Then** it is sent from the candidate's Gmail account with the resume and cover letter PDFs attached, and the sent email appears in the candidate's Gmail Sent folder.
2. **Given** Day 1 email is sent and no reply is detected after 72 hours, **When** the Day 3 check runs, **Then** the value-add email fires without the candidate taking any action.
3. **Given** a reply arrives at any point in the cadence, **When** detected, **Then** the cadence pauses immediately and the candidate is notified on the dashboard.
4. **Given** the Day 1 email bounces, **When** the bounce is detected, **Then** Day 3 and Day 7 are permanently cancelled for that job.

---

### User Story 2 — Candidate Reviews Email Drafts Before Sending (Priority: P2)

The candidate can preview all three email drafts for a job before Day 1 fires. They can edit any draft. The system does not send until the candidate explicitly approves.

**Why this priority**: Email to a hiring manager carries reputational weight. Per Principle I, the candidate must explicitly approve outbound communication before it sends.

**Independent Test**: Can be tested by verifying all 3 drafts are available for preview/edit before Day 1 sends, and that editing a draft updates the stored content used for sending.

**Acceptance Scenarios**:

1. **Given** email drafts are generated, **When** the candidate opens the job's outreach panel, **Then** all three email drafts are displayed with full body text, subject line, and scheduling information.
2. **Given** the candidate edits a draft, **When** they save it, **Then** the updated draft is used for sending — the original generated version is not discarded but marked as superseded.
3. **Given** the candidate approves sending, **When** Day 1 fires, **Then** only the approved (possibly edited) draft is used.

---

### User Story 3 — Email Tracking and Dashboard Visibility (Priority: P3)

The candidate sees the send/open/reply status of every email in the cadence from their dashboard without leaving the product.

**Why this priority**: Without tracking, the candidate cannot prioritise follow-up conversations or measure outreach effectiveness.

**Independent Test**: Can be tested by verifying that sent, opened, and replied statuses update in the job outreach panel within 1 hour of the event occurring.

**Acceptance Scenarios**:

1. **Given** Day 1 email is sent, **When** the recipient opens it, **Then** the dashboard reflects "opened" status within 1 hour.
2. **Given** the recipient replies, **When** the reply is detected via webhook or polling, **Then** the dashboard reflects "replied" status and the cadence is stopped.
3. **Given** the entire cadence completes without a reply, **When** Day 7 email sends, **Then** the cadence status updates to `cadence_complete`.

---

### Edge Cases

- What if email discovery (Hunter.io) returns no verified address? → The email track is skipped for this job; the job card notes "email not found". LinkedIn outreach continues independently.
- What if confidence is < 70%? → The email is not sent. The candidate is shown the found address with its confidence score and can manually approve sending despite low confidence.
- What if the candidate's Gmail OAuth2 token expires mid-cadence? → All pending sends are paused, the candidate is prompted to re-authorise on the dashboard, and the cadence resumes from where it left off after re-authorisation.
- What if Day 3 fires on a weekend or public holiday? → This is not detected or deferred — timing is based purely on the 72-hour elapsed time, not business calendar.
- What if Day 1 is never approved? → Drafts remain in `pending_approval` state indefinitely. The candidate can approve or discard them at any time.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST search for a verified email address for each hiring manager; the search MUST use both domain search and person-level lookup.
- **FR-002**: Email send MUST only proceed if email confidence is ≥ 70%. Below threshold, the candidate MUST be shown the address and confidence level for manual override.
- **FR-003**: System MUST generate three email drafts per job: Day 1 (intro, ≤ 150 words), Day 3 (value-add, ≤ 100 words), Day 7 (gentle close, ≤ 80 words).
- **FR-004**: Day 1 email MUST open with a specific detail about the person or company sourced from enrichment data.
- **FR-005**: Day 3 email MUST NOT use the phrase "following up" or "checking in" — it MUST share a genuinely useful insight.
- **FR-006**: Day 7 email MUST be low-commitment and leave the door open — no pressure language.
- **FR-007**: All three emails MUST thread under the same subject line using the `Re:` prefix.
- **FR-008**: Each draft MUST pass a "would a human send this?" self-review check before being stored.
- **FR-009**: All three drafts MUST be presented to the candidate for preview and optional editing before Day 1 fires. Sending requires explicit candidate approval (HITL gate).
- **FR-010**: Day 1 MUST attach the resume PDF and cover letter PDF generated by F10.
- **FR-011**: Day 3 MUST fire only if no reply is detected 72 hours after Day 1 sends.
- **FR-012**: Day 7 MUST fire only if no reply is detected 168 hours after Day 1 sends.
- **FR-013**: Cadence MUST pause immediately upon reply detection — no further emails fire.
- **FR-014**: Day 1 bounce MUST cancel Day 3 and Day 7 permanently.
- **FR-015**: Emails MUST be sent from the candidate's own Gmail account and appear in their Sent folder.
- **FR-016**: Maximum 20 emails per day per Gmail account across all active cadences.
- **FR-017**: System MUST track per-email: sent timestamp, open status, click status, reply status, bounce status.
- **FR-018**: All cadence state MUST survive service restarts — no cadence steps may be lost due to infrastructure events.

### Key Entities

- **Email Cadence** (`email_cadences`): Links a job to its 3-email sequence, with overall status and per-email state.
- **Email Draft** (`email_drafts`): Stores the generated and (optionally) edited body, subject, scheduling time, sent status, open/click/reply tracking, and whether it is the approved or superseded version.
- **Outreach Target** (from F5): Extended with `email`, `email_confidence` fields.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Email reply rate ≥ 8% across all sent cadences within 30 days.
- **SC-002**: Email open rate ≥ 35% (measure of subject line quality and personalisation).
- **SC-003**: Day 3 and Day 7 auto-fire accuracy: 100% of scheduled emails fire within ±15 minutes of their scheduled time when no reply has been received.
- **SC-004**: Zero emails sent without explicit candidate approval (100% HITL compliance).
- **SC-005**: Cadence auto-pause on reply works in 100% of cases — zero follow-up emails sent after a reply is detected.
- **SC-006**: Bounce detection cancels remaining cadence steps in 100% of bounce cases.

## Assumptions

- F10 (Resume Builder Agent) is complete — the Day 1 email attachment depends on PDF availability. If no PDF exists at the time Day 1 fires, the send is blocked and the candidate is notified.
- F5 (LinkedIn Connector Agent) runs in parallel with this feature — they are independent outreach tracks for the same approved job.
- The candidate has completed Gmail OAuth2 authorisation as part of onboarding — this authorisation flow is out of scope for this spec.
- Email scheduling is managed by the Python agent service's polling loop — Celery/Redis is available as a task queue for scheduled firing.
- Open/click tracking uses a simple redirect endpoint — no third-party email tracking service required.
- The `Re:` threading convention works for Gmail-to-Gmail and most corporate email clients. Threading behaviour on legacy clients is acceptable degradation.
