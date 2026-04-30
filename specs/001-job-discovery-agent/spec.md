# Feature Specification: Job Discovery Agent (F2)

**Feature Branch**: `001-job-discovery-agent`
**Created**: 2026-04-30
**Status**: Draft
**Phase**: 2 — Core Pipeline

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Automated Job Discovery Run (Priority: P1)

The candidate triggers a pipeline run from the dashboard. The system fans out across LinkedIn, Naukri, iimjobs, and their configured target company careers pages simultaneously. New jobs are discovered, normalised, and stored — ready for scoring.

**Why this priority**: Without job discovery, the entire pipeline has no input. This is the entry point for all downstream processing.

**Independent Test**: Can be tested by triggering a run and verifying new job records appear in the database with status `discovered`.

**Acceptance Scenarios**:

1. **Given** the candidate has configured preferences including target seniority and location, **When** a pipeline run is triggered, **Then** the system generates 5–8 distinct search queries per job board and begins scraping all sources in parallel.
2. **Given** scraping is underway, **When** a job is extracted, **Then** a record is stored with title, company, location, raw JD text, source, posted date, and application URL.
3. **Given** a scraper source fails, **When** the retry fires, **Then** the failure is logged and the pipeline continues for all other sources without interruption.

---

### User Story 2 — Deduplication Across Sources (Priority: P2)

The same job posting often appears on multiple job boards simultaneously. The system must recognise duplicates so the candidate only reviews each opportunity once.

**Why this priority**: Without deduplication, the candidate wastes time reviewing the same job multiple times and the scoring engine wastes LLM calls.

**Independent Test**: Can be tested by ingesting two fixture jobs with the same company + normalised title and verifying only one record surfaces.

**Acceptance Scenarios**:

1. **Given** a job has already been ingested by URL, **When** the same URL appears in a new scraping run, **Then** the job is skipped and counted in the dedup log but not re-inserted.
2. **Given** the same job appears on two boards under slightly different titles (e.g. "Head of AI" vs "Head, Artificial Intelligence"), **When** normalised fuzzy matching runs, **Then** only one job record is created.
3. **Given** a new scraping run returns jobs previously seen, **When** no new jobs are found, **Then** the run completes with a summary of new vs duplicate counts.

---

### User Story 3 — Target Company Direct Scraping (Priority: P3)

Candidates target specific employers whose careers pages are not reliably indexed by job boards. The system navigates those pages directly to surface roles not found elsewhere.

**Why this priority**: Direct careers page scraping captures the highest-value roles that are often never posted on aggregators.

**Independent Test**: Can be tested by adding one target company URL and verifying that jobs from that page appear after a run.

**Acceptance Scenarios**:

1. **Given** the candidate has configured a target company list in preferences, **When** a run fires, **Then** each company's careers page is navigated and job listings extracted.
2. **Given** a target company's careers page has JavaScript-rendered content, **When** the scraper runs, **Then** the page is fully rendered before extraction begins.

---

### Edge Cases

- What happens when LinkedIn rate-limits the scraper mid-run? → Source is retried once with 30-second backoff; if it fails again, the source is skipped and its failure logged. Other sources continue unaffected.
- What happens when a job has no posted date? → Stored with `posted_at = null`; treated as newly discovered for ranking purposes.
- What happens when a careers page structure changes and scraping returns zero results? → Zero-result runs from a previously active source trigger a health warning in the run log.
- What happens when a pipeline run is triggered while one is already in progress? → The new run is queued and begins after the current run completes. Concurrent runs on the same candidate are not permitted.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST generate 5–8 distinct search queries per job board per run, adapted to each board's query syntax, based on the candidate's configured preferences.
- **FR-002**: System MUST scrape all job sources in parallel within a single run.
- **FR-003**: System MUST extract per-job data: title, company, location, raw JD text, source identifier, posted date, and application URL.
- **FR-004**: System MUST store all scraped jobs in a `jobs` table with status `discovered` before any scoring occurs.
- **FR-005**: System MUST perform URL-exact deduplication: any job URL already present in the scan history MUST be skipped and not re-inserted.
- **FR-006**: System MUST perform fuzzy deduplication: jobs with the same normalised company name and similar role title (within a configurable threshold) MUST be treated as duplicates.
- **FR-007**: System MUST maintain a scan history log of all URLs ever seen, persisted even after jobs are processed or rejected.
- **FR-008**: System MUST retry a failed source once with a 30-second backoff; if the retry fails, the source failure MUST be logged and processing MUST continue for remaining sources.
- **FR-009**: System MUST navigate JavaScript-rendered careers pages to extract listings (not just static HTML).
- **FR-010**: System MUST scrape the following sources: LinkedIn India, Naukri.com, iimjobs.com, and candidate-configured target company careers pages.
- **FR-011**: System MUST store the raw JD text before any normalisation or processing.
- **FR-012**: A pipeline run triggered while one is already in progress for the same candidate MUST be queued — not run concurrently.
- **FR-013**: Each run MUST produce a completion summary: sources scraped, new jobs found, duplicates skipped, sources that failed.

### Key Entities

- **Pipeline Job** (`pipeline_jobs`): A trigger record written by the Next.js layer to initiate a run. Contains status, job type, candidate ID, and payload. The Python agent polls this table to start processing.
- **Job** (`jobs`): A discovered job listing. Contains title, company, location, raw JD text, source, posted date, application URL, and current pipeline status.
- **Scan History** (`scan_history`): A permanent log of every URL ever seen, used for URL-exact deduplication across runs.
- **Pipeline Run** (`pipeline_runs`): Metadata about a single execution: start time, end time, counts of discovered / deduplicated / failed jobs.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A full scraping run across all configured sources completes within 10 minutes for up to 500 discovered jobs.
- **SC-002**: At least 15 new, non-duplicate job listings are discovered per run when the candidate's preferences are configured.
- **SC-003**: Duplicate rate across a single run is below 20% of total discovered records (meaning the scraper finds genuinely new listings, not repeats).
- **SC-004**: Source failure (one source down) does not prevent the run from completing — remaining sources always return results.
- **SC-005**: URL-exact deduplication catches 100% of exact-match duplicates with zero false positives.

## Assumptions

- The candidate has completed Phase 1 setup: CV uploaded, preferences configured (seniority, geography, target companies).
- Job board structures (page layouts, CSS selectors) are maintained in per-source scraper configuration and updated independently of this feature when boards change.
- Rate limits for LinkedIn scraping are managed within the scraper module via delays and are not guaranteed to be perpetually bypassed — the system is designed to degrade gracefully when rate-limited.
- Instahyre and Cutshort are optional sources (Phase 2+ extension) and are out of scope for the initial implementation.
- The Python polling daemon (per Constitution §VII) is the runtime for all scraping execution. The Next.js layer only enqueues the trigger.
- `pipeline_jobs`, `pipeline_runs`, and `jobs` tables are created via Drizzle migration as part of this feature, managed from the Next.js schema file.
