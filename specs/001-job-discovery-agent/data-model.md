# Data Model: Job Discovery Agent (F2)

**Phase 1 output** | Date: 2026-04-30

All tables are defined in `src/db/schema.ts` (Drizzle ORM) and managed via `drizzle-kit`. Python reads and writes them via asyncpg using the same snake_case column names that Drizzle generates.

---

## New Tables

### `pipeline_jobs` — Neon Job Queue

Written by: **Next.js Route Handler** (`POST /api/pipeline/trigger`)
Read and updated by: **Python polling daemon**

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `uuid` | PK, `defaultRandom()` | Returned to browser on trigger |
| `status` | `pipeline_job_status` enum | NOT NULL, default `queued` | `queued → running → completed \| failed` |
| `job_type` | `text` | NOT NULL | `full_pipeline`, `discovery_only` |
| `candidate_id` | `uuid` | FK → `candidates.id` | The candidate who triggered the run |
| `payload` | `jsonb` | NOT NULL, default `{}` | Arbitrary trigger parameters |
| `created_at` | `timestamptz` | NOT NULL, `defaultNow()` | When Next.js enqueued the job |
| `started_at` | `timestamptz` | nullable | When Python agent picked it up |
| `completed_at` | `timestamptz` | nullable | When agent finished |
| `error` | `text` | nullable | Failure message if status = `failed` |

**Enum**: `pipeline_job_status`: `queued`, `running`, `completed`, `failed`

---

### `pipeline_runs` — Execution Record

Written by: **Python discovery graph**
Read by: Next.js status + SSE endpoints

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `uuid` | PK, `defaultRandom()` | |
| `pipeline_job_id` | `uuid` | FK → `pipeline_jobs.id`, NOT NULL | One run per job trigger |
| `candidate_id` | `uuid` | FK → `candidates.id`, NOT NULL | |
| `status` | `text` | NOT NULL, default `running` | `running`, `completed`, `failed`, `partial` |
| `sources_attempted` | `integer` | NOT NULL, default `0` | |
| `sources_successful` | `integer` | NOT NULL, default `0` | |
| `jobs_discovered` | `integer` | NOT NULL, default `0` | New jobs (post-dedup) |
| `jobs_deduplicated` | `integer` | NOT NULL, default `0` | Skipped as duplicates |
| `started_at` | `timestamptz` | NOT NULL, `defaultNow()` | |
| `completed_at` | `timestamptz` | nullable | |
| `summary` | `jsonb` | nullable | Per-source breakdown: `{source: {found, duped, failed}}` |
| `error` | `text` | nullable | Top-level failure message |

---

### `jobs` — Discovered Job Listings

Written by: **Python discovery graph** (via `persist_jobs` node)
Read by: Next.js pipeline dashboard (F4, F7)

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `uuid` | PK, `defaultRandom()` | |
| `candidate_id` | `uuid` | FK → `candidates.id`, NOT NULL | |
| `pipeline_run_id` | `uuid` | FK → `pipeline_runs.id`, NOT NULL | Which run discovered this job |
| `title` | `text` | NOT NULL | As extracted from source |
| `company` | `text` | NOT NULL | As extracted from source |
| `location` | `text` | nullable | |
| `jd_raw` | `text` | NOT NULL | Original, unmodified JD text |
| `jd_text` | `text` | nullable | Normalised JD (whitespace-cleaned) |
| `source` | `text` | NOT NULL | `linkedin`, `naukri`, `iimjobs`, `careers_page` |
| `source_url` | `text` | NOT NULL | Canonical URL used for dedup |
| `application_url` | `text` | nullable | Direct apply URL (may differ from source_url) |
| `posted_at` | `timestamptz` | nullable | As reported by source; null if unavailable |
| `status` | `job_status` enum | NOT NULL, default `discovered` | See state machine below |
| `created_at` | `timestamptz` | NOT NULL, `defaultNow()` | |
| `updated_at` | `timestamptz` | NOT NULL, `defaultNow()`, `$onUpdateFn` | |

**Enum**: `job_status`: `discovered`, `scored`, `awaiting`, `approved`, `rejected`, `snoozed`, `score_failed`, `resume_failed`

**Indexes**:
- `(candidate_id, status)` — dashboard queries filter by candidate and status
- `(candidate_id, source_url)` — deduplication lookup
- `(pipeline_run_id)` — run-level job count queries

---

### `scan_history` — URL Deduplication Log

Written by: **Python discovery graph** (every URL seen, even if deduped)
Read by: Python normalise node

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `uuid` | PK, `defaultRandom()` | |
| `candidate_id` | `uuid` | FK → `candidates.id`, NOT NULL | |
| `url` | `text` | NOT NULL | Normalised URL (lowercase, stripped query params except `jobId`) |
| `job_id` | `uuid` | FK → `jobs.id`, nullable | Null if deduped (no job record created) |
| `first_seen_at` | `timestamptz` | NOT NULL, `defaultNow()` | |
| `last_seen_at` | `timestamptz` | NOT NULL, `defaultNow()` | Updated on re-encounter |

**Unique constraint**: `(candidate_id, url)` — one record per URL per candidate

---

## State Machine: `jobs.status`

```
discovered
  └─► scored          (F9: 10D Scoring Engine sets this)
        └─► awaiting   (F9: A/B grade jobs surface to HITL dashboard)
              ├─► approved   (F4: candidate approves → triggers F10)
              ├─► rejected   (F4: candidate rejects → terminal)
              └─► snoozed    (F4: hidden for 7 days → auto-returns to awaiting)

discovered → score_failed   (F9: scoring failed after retry)
approved → resume_failed    (F10: PDF generation failed after retry)
```

---

## Pydantic Models (Python — `agent/models.py`)

```python
class RawJob(BaseModel):
    """Output of a single scraper node."""
    title: str
    company: str
    location: str | None
    jd_raw: str
    source: Literal["linkedin", "naukri", "iimjobs", "careers_page"]
    source_url: str
    application_url: str | None
    posted_at: datetime | None

class NormalisedJob(RawJob):
    """After normalisation and dedup check — ready for DB write."""
    jd_text: str          # whitespace-normalised version of jd_raw
    is_duplicate: bool
    duplicate_of_url: str | None

class SourceError(BaseModel):
    source: str
    error: str
    retried: bool

class RunSummary(BaseModel):
    sources: dict[str, dict]   # {source: {found, duped, failed}}
    total_new: int
    total_deduped: int
    total_failed_sources: int
```

---

## Schema Migration Strategy

1. Add to `src/db/schema.ts`:
   - `pipelineJobStatusEnum` pgEnum
   - `jobStatusEnum` pgEnum
   - `pipelineJobs` table
   - `pipelineRuns` table
   - `jobs` table
   - `scanHistory` table

2. Run `npm run db:generate` → migration file created in `migrations/`
3. Run `npm run db:migrate` → applied to Neon

Python reads these tables via asyncpg — no Python migration tool needed.
