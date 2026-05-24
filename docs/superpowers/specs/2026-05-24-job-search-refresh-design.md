# Job Search Refresh — Design Doc

**Date:** 2026-05-24
**Status:** Approved — ready for implementation planning

---

## Problem

Job postings go stale within days. Candidates have no clear way to re-trigger the discovery pipeline from the dashboard to pull in fresh listings. The existing "Run Pipeline" split button is buried in the topbar, uses developer-centric labels (`discovery_only`, `fetch_jds`, `score_jobs`), and gives no context about when the last search ran or what it found.

---

## Solution

A dedicated **Job Search card** on the dashboard that makes re-triggering job discovery and re-scoring first-class, self-service actions — with full context about recency, results, and progress.

No new agent code is required. The backend pipeline already handles `discovery_only` → `fetch_jds` → `score_jobs` chaining. This is a frontend component + one read-only API endpoint.

---

## Architecture

### New API endpoint

```
GET /api/candidates/[id]/last-search
```

Queries `pipeline_runs` joined with `pipeline_jobs` for the most recent `completed` run where `jobType = 'discovery_only'`. Returns:

```json
{
  "lastSearchAt": "2026-05-16T09:00:00Z",
  "jobsDiscovered": 47,
  "newJobs": 12,
  "duplicatesSkipped": 35
}
```

- `newJobs` = `jobsDiscovered - jobsDeduplicated` (both columns already exist on `pipeline_runs`)
- Returns `null` for all fields if no completed discovery run exists yet

### New component

`src/components/dashboard/JobSearchCard.tsx`

Inserted in `DashboardPage` between the 4 stat cards and the ReadinessRing/ActivityFeed grid.

### Topbar change

Remove the existing split button (`▶ Full Pipeline ▾` with `discovery_only / fetch_jds / score_jobs` options). Its function moves entirely into the `JobSearchCard`. The following topbar buttons are kept unchanged: `⚡ Score Batch`, `⚠ Rescore Failed`, `+ Add Jobs`, `CandidateSwitcher`.

### Data flow

```
DashboardPage mounts
  → GET /api/candidates/[id]/last-search   (new)
  → GET /api/jobs/stats                    (existing)
  → render JobSearchCard with lastSearch + stats

Candidate clicks "Search for New Jobs"
  → POST /api/pipeline/trigger { jobType: 'discovery_only', candidateId }
  → card enters Running state
  → polls GET /api/pipeline/[jobId]/status every 5s
  → follows followUpJobId chain (discovery → fetch_jds → score_jobs)
  → each step update drives the P1 step tracker UI
  → on completion: show C1 summary, refresh last-search + stats, transition to idle after 8s

Candidate clicks "Re-score All"
  → POST /api/pipeline/trigger { jobType: 'score_jobs', candidateId }
  → same polling pattern, card enters Running state
  → only the Score step lights up (Discover and Fetch stay grey)
  → scores all jobs currently in 'discovered' status (not yet graded); does not re-score already-graded jobs
```

---

## Component: JobSearchCard

### Props

```ts
interface JobSearchCardProps {
  candidateId: string
  lastSearch: {
    lastSearchAt: string | null
    jobsDiscovered: number
    newJobs: number
    duplicatesSkipped: number
  } | null
  awaitingReview: number   // from job stats
  scoreFailed: number      // from job stats
  onSearchComplete: () => void  // triggers parent stats refresh
}
```

### Card States

#### Idle / Fresh (< 6 hours since last search)
- Header: "Job Search" label + "Last searched X hours ago"
- Staleness badge: none
- Stats row: Last run found (N jobs, +N new) · Awaiting review · Score failures
- Actions: "🔍 Search for New Jobs" (full opacity) + "↻ Re-score All"
- Below search button: small note — "Searched Xh ago · results may be similar"

#### Idle / Normal (6 hours – 7 days)
- Same as Fresh but no note below the button

#### Idle / Stale (> 7 days)
- Orange badge: "⚠ Stale · Xd"
- All stats and buttons present, no cooldown note

#### Running
P1 step tracker replaces the stats row and action buttons:

```
[ ✓ Discovering   47 found ]  [ ⟳ Fetching JDs  31/47 ]  [ ◯ Scoring  Waiting… ]
```

- Steps: Discover → Fetch JDs → Score
- Each step box shows: status icon + label + live count
- Completed step: green border, "✓" icon
- Active step: blue border, "⟳" icon + count updates
- Pending step: dim, "◯" icon
- Driven by the `followUpJobId` chain from the status polling loop — step advances when the active `pipeline_job` completes and a follow-up is queued
- Step mapping: `jobType = 'discovery_only'` → step 1 active; `fetch_jds` → step 2 active; `score_jobs` → step 3 active. When the final step completes with no `followUpJobId`, transition to Complete state.
- Cancel link shown (sets status to no-op — daemon will complete; UI just stops polling and resets to idle)

#### Complete (shown for 8 seconds, then idle)
C1 summary card:
- Green border + "✓ Search complete" header
- Three mini-stats: new jobs · total found · duplicates skipped
- CTA button: "Review X New Jobs in Pipeline →" (navigates to `/candidates/[id]/pipeline`)
- Auto-transitions to idle after 8 seconds; also dismissible

#### Error
- Red border
- Error message (from `pipeline_job.error`)
- "Try Again" button

### Soft Cooldown (CD1)

- If `lastSearchAt` is within the past 6 hours, display a muted note below the search button:
  `"Searched Xh ago · results may be similar"`
- Button remains fully enabled — no hard block
- Re-score All has no cooldown (it does not call external APIs)

---

## Staleness Logic

| Time since last search | Badge | Note below button |
|---|---|---|
| Never searched | "No searches yet" hint text | — |
| < 6 hours | None | "Searched Xh ago · results may be similar" |
| 6h – 7d | None | — |
| > 7 days | Orange "⚠ Stale · Xd" | — |

---

## What Is Removed

| Removed | Reason |
|---|---|
| Topbar split button (▶ Full Pipeline ▾) | Replaced by JobSearchCard — clearer, more contextual |
| `PHASE_OPTIONS` array in DashboardPage | No longer needed |
| `selectedPhase`, `showPhaseMenu` state in DashboardPage | No longer needed |

`ScoreFailedSection` on the Pipeline page is **kept** — it handles per-job retry, while "Re-score All" on the card handles the bulk case.

---

## Files Touched

| File | Change |
|---|---|
| `src/app/api/candidates/[id]/last-search/route.ts` | New — GET handler |
| `src/components/dashboard/JobSearchCard.tsx` | New component |
| `src/app/candidates/[id]/dashboard/page.tsx` | Remove split button; add JobSearchCard; fetch last-search data |
| `src/lib/api.ts` | Add `getLastSearch(candidateId)` client function |

---

## Out of Scope

- Scheduling automatic periodic searches (cron-style) — future feature
- Per-source search control (LinkedIn only, Indeed only) — future feature
- Hard cooldown / rate limiting at the API layer — not needed; deduplication handles waste
- Mobile layout — follow existing responsive patterns
