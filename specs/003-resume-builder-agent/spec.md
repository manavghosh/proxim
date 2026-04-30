# Feature Specification: Resume Builder Agent (F10)

**Feature Branch**: `003-resume-builder-agent`
**Created**: 2026-04-30
**Status**: Draft
**Phase**: 2.5d–2.5i

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Archetype-Matched Resume Generation (Priority: P1)

Once the candidate approves a job from the HITL dashboard, the system automatically generates a personalised resume tailored to the specific job's archetype. The candidate receives a ready-to-submit PDF without manual editing.

**Why this priority**: A generic CV fails ATS filters and doesn't convert for senior leadership roles. Archetype-targeted personalisation is the product's highest-leverage capability after job discovery.

**Independent Test**: Can be tested by feeding a fixture approved job (with archetype detected) and a fixture parsed candidate profile into the agent, and verifying the output PDF contains the correct archetype-specific summary and keyword injections.

**Acceptance Scenarios**:

1. **Given** a job is approved by the candidate and has a detected archetype, **When** the Resume Builder runs, **Then** it generates a personalised resume and cover letter PDF for that specific job within 60 seconds.
2. **Given** an archetype is detected with confidence ≥ 0.6, **When** personalisation applies, **Then** the resume summary, bullet ordering, and project selection all match the archetype's defined lead proof points.
3. **Given** archetype confidence is < 0.6, **When** personalisation applies, **Then** the system defaults to the "Agentic Systems Architect" archetype.
4. **Given** the resume is generated, **Then** all job titles, company names, employment dates, quantified outcomes, patent numbers, and credentials MUST exactly match the source CV — no fabrication or inflation permitted.

---

### User Story 2 — ATS Keyword Injection (Priority: P2)

The generated resume contains 15–20 high-signal keywords from the job description, injected naturally across the summary, role bullets, and skills section to maximise ATS parser scores.

**Why this priority**: Without keyword injection, even a strong candidate's resume may be filtered out by ATS before a human ever reads it.

**Independent Test**: Can be tested by extracting keywords from a fixture JD and verifying ≥ 15 distinct keywords appear in the generated resume text, with no keyword repeated more than 3 times.

**Acceptance Scenarios**:

1. **Given** a JD is provided, **When** keyword extraction runs, **Then** 15–20 high-signal keywords are identified and validated as a JSON array before injection begins.
2. **Given** keywords are extracted, **When** injection runs, **Then** each keyword appears in the resume summary, leading bullets, or skills section without appearing more than 3 times total across the document.
3. **Given** keyword injection would alter a factual claim (job title, company name, quantified metric), **Then** the injection MUST be skipped for that location and attempted at a less sensitive location.
4. **Given** injected text is generated, **When** a coherence self-review runs, **Then** the injected passage reads naturally and is approved before the text is finalised.

---

### User Story 3 — PDF Generation with Cover Letter (Priority: P3)

The agent renders the personalised resume and a one-page cover letter to ATS-safe PDF files. Both are stored and linked to the job record, ready for email attachment.

**Why this priority**: PDF generation is the final deliverable — the candidate cannot submit without it. A visually broken or ATS-unfriendly PDF undermines all upstream work.

**Independent Test**: Can be tested by generating PDFs from a fixture resume template and verifying the PDF opens correctly, all sections are present, and an ATS test tool extracts all sections correctly.

**Acceptance Scenarios**:

1. **Given** personalised resume content is ready, **When** PDF rendering runs, **Then** a resume PDF (2–3 pages) and a cover letter PDF (exactly 1 page) are generated within 60 seconds total.
2. **Given** the PDF is generated, **When** an ATS extraction test runs, **Then** all resume sections (name, contact, experience, skills, education) are correctly extracted.
3. **Given** the base CV has changed since a PDF was generated, **When** the candidate views the job on the dashboard, **Then** the PDF is flagged as stale and the candidate can trigger regeneration.

---

### User Story 4 — Resume Version Management (Priority: P4)

Every generated PDF is tracked with a version record linked to the specific job, archetype, and base CV hash at generation time. Submitted resumes are locked — they cannot be overwritten.

**Why this priority**: Version history protects against accidental overwrites and provides a compliance record of exactly what was submitted for each application.

**Independent Test**: Can be tested by generating two versions for the same job and verifying both are stored separately, with the first marked as an older version.

**Acceptance Scenarios**:

1. **Given** a resume is generated for a job, **When** the base CV is updated, **Then** the existing version is NOT overwritten — a new version is generated on next trigger.
2. **Given** a resume has been submitted (sent to a company), **When** the candidate attempts to regenerate, **Then** the submitted version is locked and a new separate version is created instead.
3. **Given** multiple versions exist for a job, **When** the candidate views the job, **Then** all versions are listed with their generation date and whether they were submitted.

---

### Edge Cases

- What if deep company research (F10.5) fails or times out? → The cover letter "Why this company" paragraph falls back to JD-derived reasoning. The PDF generation proceeds without waiting; the fallback is noted in the version record.
- What if the resume template exceeds the page limit after personalisation? → The template enforces page count via CSS `page-break` constraints; if content overflows, lower-priority sections (optional projects, older certifications) are auto-truncated and the truncation is logged.
- What if archetype detection returns an unrecognised archetype label? → Validation catches unknown labels before personalisation begins and forces the Agentic Systems Architect default.
- What happens if a factual integrity check fails after the self-repair loop is exhausted? → The job is marked `resume_failed`, the candidate is notified on the dashboard, and they can trigger a manual retry.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST detect one of 5 archetypes (Enterprise CAIO, Startup CTO/VP, Agentic Systems Architect, GCC AI Practice Head, AI Thought Leader) per JD, with a confidence score (0–1).
- **FR-002**: Confidence < 0.6 MUST default to "Agentic Systems Architect" archetype.
- **FR-003**: System MUST extract 15–20 high-signal keywords from the JD, validated as a structured list before injection.
- **FR-004**: Keyword injection MUST NOT alter any factual field (titles, company names, dates, quantified outcomes, patent numbers). Injection is limited to natural reformulation of existing proof points.
- **FR-005**: Injected text MUST pass a coherence self-review check before finalisation.
- **FR-006**: Resume personalisation MUST reorder and reframe existing proof points per archetype — it MUST NOT fabricate any credential, experience, or outcome.
- **FR-007**: All factual fields (job titles, company names, employment dates, quantified outcomes, patent numbers, education, certifications) MUST match the source CV exactly.
- **FR-008**: System MUST generate a resume PDF (2–3 pages enforced) and a cover letter PDF (exactly 1 page enforced).
- **FR-009**: The cover letter's "Why this company" paragraph MUST contain at least 1 verifiable company-specific detail sourced from research; if research fails, fallback to JD-derived content.
- **FR-010**: All generated PDFs MUST be stored as version records linked to job, archetype, and base CV hash (SHA-256 at generation time).
- **FR-011**: Submitted resumes MUST be locked — regeneration creates a new version, never overwrites a submitted version.
- **FR-012**: When the base CV changes (hash differs), jobs with previously generated resumes MUST be flagged as stale on the dashboard.
- **FR-013**: Full PDF generation for one job (resume + cover letter) MUST complete within 60 seconds.
- **FR-014**: All LLM outputs containing factual claims MUST pass Pydantic validation before being written to any storage. Failures trigger a self-repair retry (max 2). Persistent failure marks the job as `resume_failed`.

### Key Entities

- **Resume Version** (`resume_versions`): Stores `job_id`, `archetype`, `keywords` (JSONB), `score_at_generation`, `resume_pdf_path`, `cover_letter_pdf_path`, `base_cv_hash`, `created_at`, `is_submitted`.
- **Archetype**: One of 5 named archetypes. Each has a defined set of lead proof points and section ordering rules for personalisation.
- **Keyword Set**: A validated JSON array of 15–20 strings extracted from a specific JD. Stored with the version record for auditability.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Zero fabricated proof points across 50 generated resumes reviewed against the source CV (factual integrity: 100%).
- **SC-002**: Archetype detection accuracy ≥ 85% against a labelled 20-JD test set.
- **SC-003**: ATS extraction accuracy ≥ 85%: Jobscan and Resume Worded both correctly extract all resume sections from generated PDFs.
- **SC-004**: Full PDF pair (resume + cover letter) generated within 60 seconds per job.
- **SC-005**: All submitted resumes remain immutable — zero overwrite incidents across version history.
- **SC-006**: ≥ 15 JD keywords present in every generated resume, with no keyword appearing more than 3 times.

## Assumptions

- F9 (10D Scoring Engine) is complete and the detected archetype for each job is stored with the job record. The Resume Builder reads this stored archetype rather than re-detecting it.
- The HITL dashboard (F4) triggers resume generation after the candidate approves a job — the Resume Builder does not self-trigger.
- Deep company research (F10.5) is an optional enhancement within this feature scope; its absence degrades cover letter quality but does not block PDF generation.
- The HTML resume template and Jinja2 cover letter template are created as part of this feature and live in the Python agent service's asset directory.
- PDF rendering runs in the Python agent runtime. The Next.js layer stores the file path reference; it does not render PDFs.
- The Aptos font is self-hosted in the PDF template assets — no external font CDN call is made during PDF generation.
