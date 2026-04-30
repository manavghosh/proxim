# Feature Specification: 10-Dimension Scoring Engine (F9)

**Feature Branch**: `002-10d-scoring-engine`
**Created**: 2026-04-30
**Status**: Draft
**Phase**: 2.5a–2.5c

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Automatic Scoring of Discovered Jobs (Priority: P1)

Every job that passes the discovery phase is automatically scored across 10 structured dimensions. The candidate sees an A–F grade and numeric score on their dashboard — they do not need to read a single JD to triage their pipeline.

**Why this priority**: The grade is the primary signal that drives every downstream action. Without scoring, the candidate cannot prioritise, and outreach fires without quality control.

**Independent Test**: Can be tested by feeding a fixture JD and a fixture candidate profile into the scoring function and verifying the output contains a letter grade, numeric score (1 decimal), and per-dimension scores.

**Acceptance Scenarios**:

1. **Given** a discovered job with raw JD text, **When** the scoring agent runs, **Then** it evaluates both gate-pass dimensions first; if either scores < 2.5, the job receives an automatic F grade and processing stops.
2. **Given** a job passes gate-pass, **When** the 8 weighted dimensions are evaluated, **Then** a weighted average score (1.0–5.0, 1 decimal) is computed and mapped to a letter grade (A–F).
3. **Given** scoring completes, **Then** the numeric score, letter grade, per-dimension scores (JSON), and reasoning text MUST be persisted to the jobs record.
4. **Given** an F-grade job, **When** the dashboard loads, **Then** the F-grade job MUST NOT appear in any candidate-facing view.

---

### User Story 2 — 6-Block Score Report for B+ Jobs (Priority: P2)

For every job graded B or higher, the system generates a structured 6-block markdown report the candidate can read in under 60 seconds to decide whether to approve outreach.

**Why this priority**: The grade alone is insufficient for approval decisions. The report is what turns an opaque score into a trusted, actionable recommendation.

**Independent Test**: Can be tested by verifying a fixture B-grade job produces all 6 report blocks with correct content sourced from the candidate's actual CV proof points.

**Acceptance Scenarios**:

1. **Given** a job receives grade A or B, **When** report generation runs, **Then** all 6 blocks are generated: Executive Summary, CV Match table, Gaps & Mitigation, Level & Positioning, Compensation Analysis, and Interview Probability.
2. **Given** a job receives grade F, **When** report generation is evaluated, **Then** only Block A (Executive Summary) is generated.
3. **Given** the CV Match block is generated, **Then** every JD requirement listed in the table MUST map to an actual proof point from the candidate's parsed profile — hallucinated proof points are forbidden.
4. **Given** a report is generated, **When** a validation check runs, **Then** all factual claims (titles, company names, quantified outcomes) MUST match the source CV exactly.

---

### User Story 3 — Grade Filter Persistence (Priority: P3)

The candidate sets a grade filter (A only / A+B / all) on the review dashboard. This preference persists across sessions — they always return to their preferred view.

**Why this priority**: Senior candidates prioritising quality will only ever want to see A and B grades. Making them re-set the filter on every visit is friction that undermines the product's value proposition.

**Independent Test**: Can be tested by setting the filter, logging out, returning, and verifying the filter is still applied.

**Acceptance Scenarios**:

1. **Given** the candidate sets the grade filter to "A only", **When** they return to the dashboard in a new session, **Then** the filter is still set to "A only".
2. **Given** the filter is set to "A+B", **When** the job list loads, **Then** only jobs with grade A or B appear regardless of how many C/D jobs exist.

---

### Edge Cases

- What happens when the LLM returns a score outside the 1–5 range? → The Pydantic validation layer rejects the response, triggers a self-repair retry (up to 2 retries), and if still invalid, marks the job as `score_failed` so it can be retried manually.
- What if the candidate's parsed profile is incomplete (missing roles or skills)? → Scoring proceeds with available data; incomplete dimensions are noted in the reasoning text and weighted conservatively.
- What happens when a job's JD is extremely long (>10,000 words)? → The JD is truncated to the first 4,000 words plus the requirements section before being passed to the scoring model, with truncation noted in the run log.
- What if two scoring workers pick up the same job simultaneously? → The `pipeline_jobs` polling uses `FOR UPDATE SKIP LOCKED` — only one worker processes each job.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST evaluate gate-pass dimensions (Role-Level Match, AI/Agentic Stack Alignment) first; a score below 2.5 on either MUST produce an automatic F grade with no further processing.
- **FR-002**: System MUST evaluate 8 weighted dimensions after gate-pass and compute a weighted average score to 1 decimal place.
- **FR-003**: System MUST map the numeric score to a letter grade: A (4.5–5.0), B (4.0–4.4), C (3.0–3.9), D (2.0–2.9), F (< 2.0 or gate-fail).
- **FR-004**: System MUST persist to the job record: numeric score, letter grade, all 10 per-dimension scores with reasoning text (as JSONB), and the full score report (as markdown text).
- **FR-005**: F-grade jobs MUST be excluded from all candidate-facing dashboard views.
- **FR-006**: For B+ jobs, system MUST generate all 6 report blocks. For F-grade jobs, only Block A MUST be generated.
- **FR-007**: The CV Match block MUST cite actual proof points from `candidates.parsed_profile` — any output that cites fabricated proof points MUST be rejected by the validation layer.
- **FR-008**: All structured scoring output MUST be validated against a Pydantic schema before being written to the database. Invalid responses MUST trigger a self-repair retry (max 2 retries before marking `score_failed`).
- **FR-009**: Gate-pass dimension scores MUST be stored but MUST NOT contribute to the numeric score displayed to the candidate.
- **FR-010**: Grade filter preference (A only / A+B / all) MUST be persisted per candidate and applied automatically on dashboard load.
- **FR-011**: Scoring for a single job MUST complete within 45 seconds.
- **FR-012**: Scoring output MUST pass a factual integrity self-review check (titles, companies, quantified metrics match source CV) before being written.

### Key Entities

- **Job Score** (columns on `jobs`): `score_10d` (JSONB — all dimension scores and reasoning), `grade` (VARCHAR, A–F), `report_md` (TEXT — full 6-block report).
- **Score Dimensions**: 10 named dimensions, each with a 1–5 numeric score and reasoning string. Gate-pass dimensions are flagged separately.
- **Candidate Archetype** (output of scoring Block D): Detected archetype label and confidence, stored with the job for use by F10.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Scoring accuracy (human reviewer agrees with grade) ≥ 80% on a 20-job labelled test set.
- **SC-002**: Single-job scoring completes end-to-end within 45 seconds.
- **SC-003**: Zero fabricated proof points in CV Match tables across 100 generated reports (factual integrity: 100%).
- **SC-004**: F-grade jobs never appear on the candidate review dashboard (100% filter accuracy).
- **SC-005**: The self-repair loop resolves ≥ 95% of Pydantic validation failures within 2 retries without requiring manual intervention.

## Assumptions

- F2 (Job Discovery) is complete and jobs are stored in the `jobs` table with `status = discovered`.
- The candidate's parsed profile (`candidates.parsed_profile`) is populated — scoring degrades gracefully if it is partial but requires at least a name and one role.
- F3's legacy scoring framework is superseded by this feature; F3's structured dimension scores are not carried forward.
- The scoring model runs in the Python LangGraph agent runtime using LiteLLM (per Constitution §V). The Next.js layer does not call the scoring model directly.
- Archetype detection (used by F10) is a by-product of scoring Block D and is stored with the job record to avoid a second LLM call in F10.
