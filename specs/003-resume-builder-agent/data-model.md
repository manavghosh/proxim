# Data Model: Resume Builder Agent (F10)

**Branch**: `003-resume-builder-agent` | **Date**: 2026-05-03

---

## 1. Database Schema (Drizzle — `src/db/schema.ts`)

### New Table: `resume_versions`

```typescript
export const resumeVersions = pgTable('resume_versions', {
  id:                  uuid('id').defaultRandom().primaryKey(),
  jobId:               uuid('job_id').notNull().references(() => jobs.id),
  candidateId:         uuid('candidate_id').references(() => candidates.id),
  archetype:           text('archetype').notNull(),           // one of 5 archetype names
  archetypeConfidence: numeric('archetype_confidence'),       // 0.0–1.0
  keywords:            jsonb('keywords').$type<string[]>(),   // 15–20 extracted keywords
  scoreAtGeneration:   numeric('score_at_generation'),        // numeric_score at time of gen
  resumePdfPath:       text('resume_pdf_path'),               // absolute path on agent host
  coverLetterPdfPath:  text('cover_letter_pdf_path'),
  baseCvHash:          text('base_cv_hash').notNull(),        // SHA-256 of CV at generation
  isSubmitted:         boolean('is_submitted').default(false).notNull(),
  companyResearchUsed: boolean('company_research_used').default(false).notNull(),
  generationStatus:    text('generation_status').default('pending').notNull(),
  // 'pending' | 'generating' | 'completed' | 'failed'
  errorMessage:        text('error_message'),
  createdAt:           timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('resume_versions_job_id_idx').on(table.jobId),
  index('resume_versions_base_cv_hash_idx').on(table.baseCvHash),
])

export type ResumeVersion = typeof resumeVersions.$inferSelect
export type NewResumeVersion = typeof resumeVersions.$inferInsert
```

### Modification: `jobs` table

Add computed staleness flag (application layer — not a DB column):
- A resume is **stale** when `resume_versions.base_cv_hash ≠ candidates.cv_hash` for the latest version of that job.
- No new column needed; staleness is derived at query time in `GET /api/jobs/[jobId]/resume/versions`.

---

## 2. Pipeline Jobs Integration

Resume generation is triggered by writing a `pipeline_jobs` row with `job_type = 'resume_builder'`. The Python daemon dispatches this to `graphs/resume_builder.py`.

**Payload schema** (stored in `pipeline_jobs.payload` JSONB):
```json
{
  "job_id": "<uuid>",
  "candidate_id": "<uuid>"
}
```

---

## 3. Python Agent Pydantic Models (`agent/models.py`)

### `ResumeBuilderState`

```python
class ResumeBuilderState(BaseModel):
    # ── Inputs ─────────────────────────────────────────────────────────────
    candidate_id:         str
    pipeline_job_id:      str
    pipeline_run_id:      str = ""
    job_id:               str
    job_title:            str
    job_company:          str
    jd_raw:               str
    parsed_profile:       dict
    archetype:            str           # from jobs.archetype
    archetype_confidence: float         # from jobs.archetype_confidence

    # ── Intermediate outputs ────────────────────────────────────────────────
    keywords:             list[str] = []
    personalised_resume:  str = ""
    review_feedback:      str = ""
    cover_letter:         str = ""

    # ── Retry tracking ──────────────────────────────────────────────────────
    self_review_attempt:  int  = 0
    review_passed:        bool = False

    # ── Final outputs ───────────────────────────────────────────────────────
    resume_pdf_path:       str = ""
    cover_letter_pdf_path: str = ""
    base_cv_hash:          str = ""
    version_id:            str = ""     # UUID of inserted resume_versions row

    # ── Error tracking ──────────────────────────────────────────────────────
    error:                str = ""
```

### `KeywordSet` (validated LLM output)

```python
class KeywordSet(BaseModel):
    keywords: list[str] = Field(min_length=15, max_length=20)

    @field_validator("keywords")
    @classmethod
    def unique_and_trimmed(cls, v: list[str]) -> list[str]:
        seen: dict[str, None] = {}
        for kw in v:
            seen[kw.strip().lower()] = None
        unique = list(seen.keys())
        if len(unique) < 15:
            raise ValueError(f"Too few unique keywords: {len(unique)}")
        return unique[:20]
```

### `PersonalisedResume` (validated LLM output — factual integrity gate)

```python
class PersonalisedResume(BaseModel):
    summary:       str           # 3–5 sentence archetype-targeted summary
    roles:         list[RoleSection]  # reordered, no new dates/companies
    skills:        list[str]
    proof_points:  list[str]     # OSS, patents, publications — verbatim from profile
    coherence_ok:  bool          # set by self-review node

class RoleSection(BaseModel):
    title:      str   # MUST match parsed_profile verbatim
    company:    str   # MUST match parsed_profile verbatim
    start_date: str   # MUST match parsed_profile verbatim
    end_date:   str   # MUST match parsed_profile verbatim
    bullets:    list[str]   # reframed, keyword-injected — no new metrics
```

### `CoverLetterContent` (validated LLM output)

```python
class CoverLetterContent(BaseModel):
    opening:    str   # personalised opener referencing job title + company
    body:       str   # 2–3 paragraphs: why this role, value proposition, company fit
    closing:    str   # call-to-action paragraph
    company_research_used: bool = False
```

### `ArchetypeConfig` (`agent/archetype_registry.py`)

```python
class ArchetypeConfig(BaseModel):
    name:                 str
    section_order:        list[str]   # ordered resume sections
    lead_proof_point_types: list[str] # proof point categories to surface first
    tone:                 str         # "corporate" | "startup" | "thought_leadership"
    keywords_emphasis:    list[str]   # domain-specific keywords to prioritise in injection
```

---

## 4. Entity Relationships

```
candidates (1)
  └─► jobs (N)
        └─► resume_versions (N)   one per generation trigger
              ├── job_id → jobs.id
              ├── candidate_id → candidates.id
              ├── base_cv_hash  (snapshot of candidates.cv_hash at generation time)
              └── is_submitted  (immutable lock when True)

pipeline_jobs (1 per trigger)
  └── job_type = 'resume_builder'
  └── payload → { job_id, candidate_id }
```

---

## 5. State Transitions

### `resume_versions.generation_status`

```
pending → generating → completed
                    └─► failed      (after self-repair loop exhausted; job marked resume_failed)
```

### `jobs.status` additions

| Status | Meaning |
|---|---|
| `approved` | Candidate approved — resume generation queued |
| `resume_generating` | Python agent currently building resume |
| `resume_ready` | PDF pair available for download |
| `resume_failed` | Generation failed after retries |
| `submitted` | Candidate submitted application; version locked |

### Staleness check (application layer)

```
latest_version.base_cv_hash ≠ candidates.cv_hash  →  resume is stale  →  UI shows "Regenerate" banner
```

---

## 6. File System Layout (agent host)

```
$RESUME_OUTPUT_DIR/              ← env var, default: agent/output/resumes/
  <job_id>/
    v1/
      resume.pdf
      cover_letter.pdf
    v2/                          ← created on regeneration; v1 never overwritten
      resume.pdf
      cover_letter.pdf
```
