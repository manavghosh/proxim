# Feature Specification: LinkedIn Connector Agent (F5)

**Feature Branch**: `005-linkedin-connector-agent`
**Created**: 2026-04-30
**Status**: Draft
**Phase**: 4 — Outreach

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Hiring Manager Discovery and Connection Note (Priority: P1)

After the candidate approves a job, the system identifies the most relevant decision-maker at the target company and generates two A/B variant connection notes for the candidate to choose between — both personalised, both under 300 characters.

**Why this priority**: LinkedIn outreach to a known decision-maker has significantly higher response rates than applying cold via ATS. This is the first touchpoint in the outreach sequence.

**Independent Test**: Can be tested by providing a fixture approved job with a known company, running the discovery step, and verifying a hiring manager record is found with enrichment data and two distinct connection notes under 300 characters.

**Acceptance Scenarios**:

1. **Given** a job is approved, **When** the LinkedIn Connector runs, **Then** it identifies the most relevant decision-maker at the company (CAIO, CTO, VP AI, Head of AI, or engineering director) using profile enrichment.
2. **Given** no technical decision-maker is found, **When** the search completes, **Then** the system falls back to the HR/Talent Acquisition contact at the same company.
3. **Given** a hiring manager is found, **When** the system generates connection notes, **Then** exactly two A/B variant notes are produced — each under 300 characters, each using at least one personalisation hook from the enrichment data, neither mentioning "I saw your job posting".
4. **Given** two note variants are ready, **When** the candidate views the dashboard approval card, **Then** both variants are displayed for selection before the connection request is sent.

---

### User Story 2 — Candidate Reviews and Sends Connection Request (Priority: P2)

The candidate selects their preferred connection note variant and approves sending. The connection request fires immediately and the outcome is tracked.

**Why this priority**: Per Principle I of the constitution, no outbound action fires without explicit user approval. This is the HITL gate for LinkedIn outreach.

**Independent Test**: Can be tested by selecting a note variant in the approval UI and verifying the connection request is sent and the outreach record status updates to `sent`.

**Acceptance Scenarios**:

1. **Given** the candidate selects a connection note variant and clicks Send, **When** the request is submitted, **Then** the connection request is sent via the LinkedIn API and the outreach record is updated with sent timestamp.
2. **Given** the daily connection request limit (20/day) is reached, **When** a send is attempted, **Then** the request is queued for the next day and the candidate sees a "queued" status on the dashboard.
3. **Given** a connection request is sent, **When** the recipient accepts, **Then** the acceptance is recorded in the outreach record within 24 hours of it occurring.
4. **Given** a LinkedIn rate-limit warning is received, **When** the next send is attempted, **Then** all sends are auto-paused and the candidate is notified on the dashboard.

---

### Edge Cases

- What if no hiring manager or HR contact is found at the company? → The outreach target is marked `no_contact_found` and the job card notes this to the candidate. The email outreach track (F6) proceeds independently.
- What if the company has an active do-not-contact flag? → The LinkedIn agent skips the company without attempting any lookup or send.
- What if enrichment returns partial data (no recent posts, no shared connections)? → The system generates connection notes using available signals only; if no hooks exist, notes rely on the candidate's most relevant proof point for the company's context.
- What if the candidate edits the selected note before sending? → The edited note replaces the generated variant; no re-generation is triggered. The sent note is recorded as-is.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST search for decision-makers at the approved job's company in this priority order: CAIO, CTO, VP AI, Head of AI, Engineering Director.
- **FR-002**: System MUST fall back to HR/Talent Acquisition if no technical decision-maker is found.
- **FR-003**: System MUST skip outreach for companies flagged as do-not-contact.
- **FR-004**: Enrichment MUST attempt to retrieve: recent posts (last 30 days), shared connections, current role tenure, and education for the identified contact.
- **FR-005**: System MUST generate exactly two A/B variant connection notes per contact, both under 300 characters.
- **FR-006**: Each note variant MUST use at least one personalisation hook from enrichment data.
- **FR-007**: Connection note variants MUST NEVER contain the phrase "I saw your job posting" or equivalents.
- **FR-008**: Both note variants MUST be presented to the candidate on the dashboard before any send occurs. Sending requires explicit candidate selection and confirmation (HITL gate).
- **FR-009**: Connection requests MUST be rate-limited to a maximum of 20 per day per LinkedIn account.
- **FR-010**: All sends MUST be tracked: sent timestamp, acceptance status (polled every 24 hours), and message reply status.
- **FR-011**: On receipt of a LinkedIn rate-limit warning, all pending connection request sends MUST be automatically paused and the candidate notified.
- **FR-012**: Acceptance and reply status MUST be updated by polling the LinkedIn API no more frequently than every 24 hours.
- **FR-013**: Outreach targets MUST be stored with: `name`, `linkedin_url`, `title`, `company`, `seniority`, `enrichment_json`, `connection_notes` (both variants), and `status`.

### Key Entities

- **Outreach Target** (`outreach_targets`): Stores the identified hiring manager with enrichment data, generated connection notes, send status, and reply tracking.
- **Connection Note Variant**: One of two generated note options (A and B) — stored with the outreach target record for audit purposes after sending.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: LinkedIn acceptance rate ≥ 25% of sent connection requests within 14 days of sending.
- **SC-002**: Connection notes generated within 30 seconds of hiring manager enrichment completing.
- **SC-003**: Zero connection requests sent without explicit candidate approval (100% HITL compliance).
- **SC-004**: Zero rate-limit violations — daily cap of 20 requests enforced with 100% accuracy.
- **SC-005**: ≥ 90% of approved jobs have a hiring manager identified (or a documented reason why not).

## Assumptions

- F4 (HITL Review Dashboard) is complete — the LinkedIn approval card is an extension of the existing job approval flow, not a separate page.
- Profile enrichment uses Proxycurl API (already in the technology stack per the PRD). Proxycurl API credentials are stored as environment variables.
- The candidate has authorised Proxim to act on their LinkedIn account (OAuth or API token) — the mechanism for initial LinkedIn authorisation is out of scope for this feature spec and assumed to be handled in an onboarding step.
- LinkedIn write API access (for sending connection requests) is available via Proxycurl's write endpoints.
- Do-not-contact flags are managed as a simple list in the candidate's preferences, manually maintained by the candidate.
