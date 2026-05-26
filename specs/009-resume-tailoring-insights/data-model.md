# Data Model: Resume Tailoring Visibility & Outreach Insights (009)

**Date**: 2026-05-26  
**Status**: Confirmed — no schema migrations required

---

## Existing Tables (read-only for this feature)

### `resume_versions`

All columns consumed by `TailoredResumeCard`:

| Column | Type | Null? | Notes |
|---|---|---|---|
| `id` | uuid | NO | |
| `jobId` | uuid | NO | FK → jobs |
| `candidateId` | uuid | YES | nullable |
| `archetype` | text | YES | null if archetype not detected |
| `archetypeConfidence` | numeric(3,2) | YES | 0.0–1.0; returned as string by Drizzle |
| `keywords` | jsonb string[] | YES | injected keywords; may be null or empty |
| `versionN` | integer | NO | 1 = first generation; 2+ = retries |
| `resumePdfPath` | text | YES | null while PDF is being written |
| `coverLetterPdfPath` | text | YES | null if not generated |
| `baseCvHash` | varchar(64) | NO | SHA-256 of base CV at time of generation |
| `generationStatus` | enum | NO | `pending` / `generating` / `completed` / `failed` |
| `isSubmitted` | boolean | NO | |
| `createdAt` | timestamptz | NO | |

**Staleness detection**: `isStale = (candidates.baseCvHash !== null && resumeVersions.baseCvHash !== candidates.baseCvHash)`. Computed by the existing `GET /api/jobs/[jobId]/resume` route — no new logic required.

**Version selection**: When multiple rows exist for the same `jobId`, the UI selects `MAX(versionN)` — i.e., the most recent successful or in-progress generation.

---

### `jobs`

Columns consumed by the insights API:

| Column | Type | Null? | Role in insights |
|---|---|---|---|
| `id` | uuid | NO | join key |
| `candidateId` | uuid | NO | filter |
| `status` | enum | NO | approved-set filter |
| `grade` | varchar(1) | YES | A/B grade rate |
| `archetype` | text | YES | archetype breakdown grouping |
| `archetypeConfidence` | numeric(4,3) | YES | not used in insights (display only in JobCard) |
| `interviewCallbackAt` | timestamptz | YES | callback count |
| `jdRaw` | text | NO | empty string = JD not yet fetched |

**Approved-set statuses** (used for funnel `approved` count):
`approved`, `resume_ready`, `resume_failed`, `submitted`, `score_failed`

---

### `email_cadences`

| Column | Type | Null? | Role in insights |
|---|---|---|---|
| `id` | uuid | NO | join key |
| `jobId` | uuid | NO | join to jobs |
| `candidateId` | uuid | NO | filter (indexed) |
| `replyDetectedAt` | timestamptz | YES | replied count |
| `status` | enum | NO | not used for filtering replies (replies counted regardless of cancellation) |

---

### `email_drafts`

| Column | Type | Null? | Role in insights |
|---|---|---|---|
| `id` | uuid | NO | |
| `cadenceId` | uuid | NO | join to email_cadences |
| `candidateId` | uuid | NO | for per-draft status display |
| `dayNumber` | integer | NO | 1 = Day 1; used for deduplication of sent count |
| `sentAt` | timestamptz | YES | Day 1 sent count; null = not sent |
| `openDetectedAt` | timestamptz | YES | opened count; only counted if `sentAt` also set |
| `clickDetectedAt` | timestamptz | YES | per-draft display only (not in funnel) |

---

## New API Response Types (TypeScript)

These are not schema changes — they are application-layer types added to `src/types/candidate.ts`:

### `ResumeVersionSummary`

```typescript
interface ResumeVersionSummary {
  id: string
  jobId: string
  candidateId: string | null
  keywords: string[] | null
  archetype: string | null
  archetypeConfidence: number | null   // converted from DB string
  versionN: number
  resumePdfPath: string | null
  coverLetterPdfPath: string | null
  baseCvHash: string | null
  generationStatus: string
  isStale: boolean                     // computed by API route
  createdAt: string
}
```

Note: The existing `ResumeVersion` type in `src/lib/api.ts` already has `isStale: boolean` and `archetypeConfidence: string | null`. `ResumeVersionSummary` is a clean alias with `archetypeConfidence: number | null` — it is used exclusively by `TailoredResumeCard` after numeric conversion.

### `InsightsResponse`

```typescript
interface InsightsResponse {
  funnel: InsightsFunnel
  rates: InsightsRates
  archetypeBreakdown: ArchetypeBreakdownRow[]
}

interface InsightsFunnel {
  discovered: number
  approved: number
  day1Sent: number     // deduplicated: max 1 per cadence (latest sentAt)
  opened: number       // distinct cadences with sentAt + openDetectedAt
  replied: number      // cadences with replyDetectedAt (any status)
  callbacks: number    // jobs with interviewCallbackAt
}

interface InsightsRates {
  openRate: number | null      // opened / day1Sent — null when day1Sent = 0
  replyRate: number | null     // replied / day1Sent — null when day1Sent = 0
  abGradeRate: number | null   // AB-graded approved / approved — null when approved = 0
  callbackRate: number | null  // callbacks / approved — null when approved = 0
}

interface ArchetypeBreakdownRow {
  archetype: string
  approved: number
  sent: number
  replied: number
  replyRate: number | null     // replied / sent — null when sent = 0
}
```

---

## State Transitions (Resume Generation)

```
generationStatus: pending → generating → completed (resumePdfPath set)
                                       → failed     (errorMessage set)
```

UI polling behaviour:
- `resumePdfPath === null && generationStatus !== 'failed'` → show spinner, poll every 3s
- `generationStatus === 'failed'` → show "Retry Resume" button (existing `JobCard` behaviour)
- `generationStatus === 'completed' && resumePdfPath !== null` → show `TailoredResumeCard`

---

## Entity Relationships (for this feature)

```
candidates (1) ──── (N) jobs
                          │
                          │── (N) resume_versions
                          │
                          └── (N) email_cadences
                                      │
                                      └── (N) email_drafts
```

All reads are scoped by `candidateId`. No writes in this feature.
