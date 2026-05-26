# Research: Resume Tailoring Visibility & Outreach Insights (009)

**Date**: 2026-05-26  
**Phase**: 0 — Research & Unknowns Resolution

---

## 1. Resume Versions Schema — Confirmed Columns

**Decision**: No schema migration required. All required columns already exist in `resume_versions`.

**Confirmed from `src/db/schema.ts`:**

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `jobId` | uuid FK → jobs | |
| `candidateId` | uuid FK → candidates | nullable |
| `archetype` | text | null if not detected |
| `archetypeConfidence` | numeric(3,2) | null if not detected |
| `keywords` | jsonb `string[]` | injected keywords from JD |
| `baseCvHash` | varchar(64) | hash of CV at time of generation |
| `generationStatus` | enum | `pending` \| `generating` \| `completed` \| `failed` |
| `versionN` | integer | retry count (1, 2, 3…) |
| `resumePdfPath` | text | null if PDF not yet written |
| `coverLetterPdfPath` | text | null if not generated |
| `isSubmitted` | boolean | |
| `createdAt` | timestamptz | |

**isStale computation**: Already computed server-side in `GET /api/jobs/[jobId]/resume`. The route handler compares `baseCvHash` on the resume version against `candidates.baseCvHash`. The `ResumeVersion` type in `src/lib/api.ts` already includes `isStale: boolean`.

---

## 2. Email Tracking Schema — Confirmed Columns

**Confirmed columns on `emailDrafts`:**

| Column | Tracking purpose |
|---|---|
| `sentAt` | When the draft was sent |
| `openDetectedAt` | When the tracking pixel fired |
| `clickDetectedAt` | When a link was clicked |

**Confirmed columns on `emailCadences`:**

| Column | Tracking purpose |
|---|---|
| `replyDetectedAt` | When a reply was detected |
| `candidateId` | Allows direct filter by candidate (indexed) |

---

## 3. Existing Indexes — Performance Validated

**Decision**: No new indexes required for the insights query.

Confirmed from schema:
- `email_cadences_candidate_status_idx` on `(candidateId, status)` — covers the cadences query
- `jobs` table has existing candidate FK + status columns queried in current pipeline routes with no N+1 issues reported
- `emailDrafts` joined via `inArray(cadenceId, ...)` — cadence IDs are filtered by `candidateId` first, keeping the set small

For the P99 target (< 2s dashboard load), the insights query runs in parallel with existing dashboard fetches via `Promise.all`. Each sub-query is O(n) on the candidate's data with covered indexes.

---

## 4. `grade` Column — Confirmed Name

**Decision**: The job grade column is `jobs.grade` (varchar 1), not `scoreGrade`. All references in the implementation plan use `grade`.

Confirmed from `src/db/schema.ts` line 156: `grade: varchar({ length: 1 })`.

---

## 5. `jdRaw` Availability in JobCard

**Decision**: `jdRaw` is present on `jobs` table (`text().notNull()`) but may not be included in the `ScoredJob` interface in `src/lib/api.ts`. The implementation must:
1. Verify `jdRaw` is returned in the jobs API response
2. If not, add `jdRaw: string` to `ScoredJob` and include it in the relevant `GET /api/jobs` select

Empty string (`''`) is the "not yet fetched" state — `jdRaw` is `notNull()` with a default empty string.

---

## 6. `TailoredResumeCard` Placement in JobCard

**Decision**: Render `TailoredResumeCard` in the expanded section of `JobCard`, replacing the existing "View Resume" / "View Cover Letter" buttons. The card unifies all resume-related actions in one place.

The resume version data is already fetched by `JobCard` via `getResumeVersions(jobId, candidateId)` on expand. The highest `versionN` row is shown (most recent retry).

---

## 7. Insights API — Dual Runtime Compatibility

**Decision**: The insights route uses Drizzle's `db` singleton from `src/db/index.ts`, which auto-detects SQLite (dev) vs. Neon (prod). The query uses `inArray` for the sub-select — Drizzle's SQLite adapter supports this.

**Verified**: `emailCadences.candidateId` is indexed. The `inArray(emailDrafts.cadenceId, subQuery)` pattern is used elsewhere in the codebase (e.g., email outreach routes).

---

## 8. Dashboard Page — Parallel Fetch Pattern

**Decision**: Add `getInsights(candidateId)` to the existing `Promise.all` in `loadData()`. The function returns `null` on error (graceful degradation) so a failing insights fetch does not break the rest of the dashboard.

`InsightsFunnelCard` accepts `insights: InsightsResponse | null` — null renders a loading skeleton, allowing the card to appear immediately and populate when data arrives.

---

## 9. `archetypeConfidence` Type Coercion

**Finding**: `archetypeConfidence` is stored as `numeric(3,2)` in Postgres. Drizzle returns it as a `string` (Postgres numeric → JS string). The `ResumeVersion` type in `api.ts` declares `archetypeConfidence: string | null`.

**Decision**: `TailoredResumeCard` converts to number with `Number(version.archetypeConfidence)` before comparison. The insights API route converts with `Number(j.archetypeConfidence)` in the mapping step before passing to `aggregateInsights`.

---

## 10. `Spinner` Component Availability

**Finding**: `src/components/ui/spinner.tsx` exists (referenced in `Button.tsx` via `isLoading` prop). Import path: `@/components/ui/spinner`.

**Decision**: `TailoredResumeCard` uses `<Spinner className="w-3 h-3" />` for the "PDF generating" state.

---

## Summary — No NEEDS CLARIFICATION Remaining

All unknowns resolved. No schema migrations needed. No Python agent changes needed. This is entirely a UI + API aggregation layer feature.
