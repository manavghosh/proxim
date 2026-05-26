# Tasks: Resume Tailoring Visibility & Outreach Insights (009)

**Input**: Design documents from `/specs/009-resume-tailoring-insights/`  
**Branch**: `proxim-mvp`  
**Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no shared state)
- **[US#]**: User story from spec.md
- Each task includes exact file path

---

## Phase 1: Setup

No new packages, no migrations, no new environment variables. This feature is purely additive — existing tables and dependencies are sufficient.

- [x] T001 Confirm `src/components/ui/spinner.tsx` exports `Spinner` component (used by TailoredResumeCard) — read the file and verify `export function Spinner`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: TypeScript types + API client + aggregation API route. All user story phases depend on these.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [x] T002 Add `ResumeVersionSummary`, `InsightsFunnel`, `InsightsRates`, `ArchetypeBreakdownRow`, `InsightsResponse` interfaces to `src/types/candidate.ts` — append after existing `PipelineRunSummary` interface
- [x] T003 Add `getInsights(candidateId: string): Promise<InsightsResponse | null>` to `src/lib/api.ts` — append after `exportRunHistory`, wraps `GET /api/candidates/[id]/insights`, returns `null` on any error
- [x] T004 Write unit tests for `aggregateInsights` helper in `src/__tests__/api/candidates/insights.test.ts` — test: zero-data returns null rates; open rate computed correctly; orphaned opens excluded; cancelled cadence replies counted; Day-1 retry deduplication; archetype ranking; breakdown hidden when < 2 archetypes
- [x] T005 Create `src/app/api/candidates/[id]/insights/route.ts` — export `aggregateInsights(candidateId, { jobs, cadences, drafts })` as a pure function (for unit testability) + `GET` handler that fetches all three tables via Drizzle `Promise.all` and calls `aggregateInsights`; use `jobs.grade` (not `scoreGrade`) for A/B rate; use `inArray(emailDrafts.cadenceId, subQuery)` for draft fetch
- [x] T006 Run `npx vitest run src/__tests__/api/candidates/insights.test.ts` — all tests must pass; fix any failures before proceeding
- [x] T007 Run `npx tsc --noEmit` — zero errors; fix any type issues in T002–T005

**Checkpoint**: Insights API is live and tested. Types are defined. `getInsights()` is callable from any component.

---

## Phase 3: User Story 1 — See What Was Tailored (Priority: P1) 🎯 MVP

**Goal**: When a `resume_versions` row exists for an approved job, a `TailoredResumeCard` renders inside the job card expanded section showing injected keywords, archetype + confidence, PDF/cover-letter links, and disables the tailor button when `jdRaw` is empty.

**Independent Test**: Approve a job with a fetched JD, generate a tailored resume, expand the job card — `TailoredResumeCard` appears with at least one keyword badge and the archetype name, without navigating away.

### Tests for User Story 1

- [x] T008 [US1] Write `src/__tests__/components/applications/TailoredResumeCard.test.tsx` — test cases: (a) renders archetype + confidence percentage; (b) renders keyword pills; (c) shows "Low confidence" amber badge when `archetypeConfidence < 0.5`; (d) shows "No keywords detected" when `keywords = []`; (e) shows spinner when `resumePdfPath = null`; (f) filters empty strings from keywords array; (g) `onViewResume` / `onViewCoverLetter` callbacks called on button click

### Implementation for User Story 1

- [x] T009 [US1] Create `src/components/applications/TailoredResumeCard.tsx` — `'use client'`; props: `version: ResumeVersion`, `onViewResume: () => void`, `onViewCoverLetter: () => void`; sections: (1) archetype row with confidence badge (amber "Low confidence" when `Number(archetypeConfidence) < 0.5`); (2) keywords flex-wrap of `<Badge>` pills (filter empty strings, show "No keywords detected" in muted text when empty); (3) PDF actions row: "View Resume" + "View Cover Letter" `<Button size="sm" variant="outline">` when `resumePdfPath` non-null, else `<Spinner>` + "Generating PDF…"; (4) version number `v{versionN}` right-aligned; use `@/components/ui/{card,badge,button,spinner}` and `lucide-react` only
- [x] T010 [US1] Run `npx vitest run src/__tests__/components/applications/TailoredResumeCard.test.tsx` — all tests must pass; fix any failures
- [x] T011 [US1] Verify `jdRaw` is included in the `ScoredJob` interface in `src/lib/api.ts` — if missing, add `jdRaw: string` and confirm it is returned by the jobs API route (`src/app/api/jobs/route.ts` or equivalent Drizzle select); empty string `''` means JD not fetched
- [x] T012 [US1] Update `src/components/applications/JobCard.tsx` — (a) add `import { TailoredResumeCard } from '@/components/applications/TailoredResumeCard'`; (b) rename button label from `'Generate Resume'` to `'✨ Tailor for This Role'` and `'AI Agent writing…'` stays unchanged; (c) add `disabled={isPending || buildRunning || !job.jdRaw}` and `title={!job.jdRaw ? 'Fetch JD first before tailoring' : undefined}` to the generate button; (d) in the expanded section after the action buttons, render `TailoredResumeCard` when `resumeVersions` state has at least one row — select the row with max `versionN` to display; `onViewResume` and `onViewCoverLetter` call the existing `onViewResume?.(job.id)` and `onViewCoverLetter?.(job.id)` handlers
- [x] T013 [US1] Run `npm run test:run` — all existing + new tests must pass; fix any failures

**Checkpoint**: TailoredResumeCard visible in job card after resume generation. Keyword badges + archetype + PDF links render correctly. Button is disabled when JD not fetched.

---

## Phase 4: User Story 2 — Stale Resume Warning (Priority: P2)

**Goal**: When `resume_versions.baseCvHash` differs from `candidates.baseCvHash`, an amber warning banner appears on the `TailoredResumeCard` prompting re-tailoring. Computed by existing API route — `isStale: boolean` already on `ResumeVersion`.

**Independent Test**: Generate a resume for a job, update the CV in Settings, return to Pipeline — amber banner "CV updated since tailoring — consider re-tailoring." appears on the job card.

### Tests for User Story 2

- [x] T014 [US2] Add stale warning test cases to `src/__tests__/components/applications/TailoredResumeCard.test.tsx` — (a) `version.isStale = true` renders amber banner with text matching `/cv updated since tailoring/i`; (b) `version.isStale = false` renders no amber banner; run tests and confirm they fail before T015

### Implementation for User Story 2

- [x] T015 [US2] Add stale warning section to `src/components/applications/TailoredResumeCard.tsx` — at the TOP of the card (before archetype row), render when `version.isStale === true`: `<div className="rounded-md bg-amber-950/30 border border-amber-800/40 px-2.5 py-1.5"><p className="text-[11px] text-amber-400">⚠ CV updated since tailoring — consider re-tailoring.</p></div>`
- [x] T016 [US2] Run `npx vitest run src/__tests__/components/applications/TailoredResumeCard.test.tsx` — all tests including new stale cases must pass

**Checkpoint**: Stale warning appears on job cards where CV was updated after tailoring. No warning when hashes match.

---

## Phase 5: User Story 3 — View Outreach Funnel on Dashboard (Priority: P2)

**Goal**: Dashboard page shows `InsightsFunnelCard` below `JobSearchCard` with funnel stage counts (Discovered → Approved → Sent → Opened → Replied → Callback) and four rate metrics (open rate, reply rate, A/B grade mix, callback rate). Rates display "—" when denominator is zero.

**Independent Test**: Navigate to dashboard for a candidate with sent email outreach — funnel counts and rates render correctly. Navigate to dashboard for a brand-new candidate — all rates show "—" and "Send your first email to see performance data." message appears.

### Tests for User Story 3

- [x] T017 [US3] Write `src/__tests__/components/dashboard/InsightsFunnelCard.test.tsx` — test cases: (a) renders 6 funnel stage counts; (b) rate displayed as percentage string (e.g. "60%"); (c) null rates display "—"; (d) empty state shows "Send your first email to see performance data." when `funnel.day1Sent = 0`; (e) `insights = null` renders loading skeleton without crashing; run and confirm they fail before T018

### Implementation for User Story 3

- [x] T018 [US3] Create `src/components/dashboard/InsightsFunnelCard.tsx` — `'use client'`; props: `insights: InsightsResponse | null`; when null: return loading skeleton (6 `<Skeleton>` boxes in a grid); when loaded: (1) header label "Outreach Insights"; (2) 6-column funnel grid showing count + label for each stage; (3) 4-column rate card grid (open rate, reply rate, A/B grade, callback) — `null` rates display "—" in muted colour; (4) empty state text when `funnel.day1Sent === 0`; use `@/components/ui/{card,skeleton,badge}` and Tailwind v4 only
- [x] T019 [US3] Run `npx vitest run src/__tests__/components/dashboard/InsightsFunnelCard.test.tsx` — all tests must pass; fix any failures
- [x] T020 [US3] Update `src/app/candidates/[id]/dashboard/page.tsx` — (a) import `getInsights` from `@/lib/api` and `InsightsFunnelCard` from `@/components/dashboard/InsightsFunnelCard` and `InsightsResponse` from `@/types/candidate`; (b) add `const [insights, setInsights] = useState<InsightsResponse | null>(null)`; (c) add `getInsights(candidateId)` to the existing `Promise.all` in `loadData()` and `setInsights(insightsRes)` after the other setters; (d) render `<InsightsFunnelCard insights={insights} />` immediately below the `<JobSearchCard>` component in the JSX
- [x] T021 [US3] Run `npm run test:run` — all tests pass; run `npx tsc --noEmit` — zero errors

**Checkpoint**: InsightsFunnelCard renders on dashboard with correct funnel counts + rates. Empty state graceful. No additional page load time (parallel fetch).

---

## Phase 6: User Story 4 — Archetype Learning Breakdown (Priority: P3)

**Goal**: When ≥2 distinct archetypes exist in approved jobs, `InsightsFunnelCard` shows a top-5 archetype breakdown table sorted by reply rate descending. Hidden when fewer than 2 archetypes.

**Independent Test**: Seed scenario with 2+ job archetypes and at least one cadence with `replyDetectedAt` set — breakdown table ranks the replied archetype first. Single-archetype candidate — no table rendered.

### Tests for User Story 4

- [x] T022 [US4] Add archetype breakdown test cases to `src/__tests__/components/dashboard/InsightsFunnelCard.test.tsx` — (a) renders archetype names when `archetypeBreakdown.length >= 2`; (b) first row is highest reply-rate archetype; (c) no breakdown section when `archetypeBreakdown = []`; run and confirm new cases fail before T023

### Implementation for User Story 4

- [x] T023 [US4] Add `ArchetypeTable` sub-component to `src/components/dashboard/InsightsFunnelCard.tsx` — renders when `insights.archetypeBreakdown.length >= 2`; shows heading "Archetype Reply Rates" + one row per archetype with: archetype name, sent count, reply rate badge (amber if > 0, muted if 0); rows already sorted by API (highest `replyRate` first)
- [x] T024 [US4] Run `npx vitest run src/__tests__/components/dashboard/InsightsFunnelCard.test.tsx` — all tests including archetype cases must pass

**Checkpoint**: Archetype breakdown table ranks highest-performing archetype first. Hidden for candidates with < 2 archetypes.

---

## Phase 7: User Story 5 — Per-Draft Engagement Indicators (Priority: P3)

**Goal**: Each email draft card shows a status row with sent date, opened date (or "Not opened yet"), and clicked date (or nothing) — only when `sentAt` is set. Covers both `EmailDraftCard` (agentic send mode) and `ManualSendDraftCard` (manual send mode).

**Independent Test**: Open the email outreach panel for a cadence with sent drafts where `sentAt` and `openDetectedAt` are set in DB — "✉ Sent [date]  👁 Opened [date]" appears below the draft. Draft with `sentAt` but no `openDetectedAt` shows "Not opened yet". Draft with `sentAt = null` shows no status row.

### Tests for User Story 5

- [x] T025 [US5] Add timestamp row test cases to `src/__tests__/components/pipeline/EmailDraftCard.test.tsx` (or create if absent) — (a) draft with `sentAt + openDetectedAt` both set: status row shows text matching `/sent/i` and `/opened/i`; (b) draft with `sentAt` but no `openDetectedAt`: shows "Not opened yet"; (c) draft with `sentAt = null`: `data-testid="draft-send-status"` element not in document; run and confirm fail before T026

### Implementation for User Story 5

- [x] T026 [P] [US5] Update `src/components/pipeline/EmailDraftCard.tsx` — find the `{draft.sentAt && <p ...>}` block (shows plain "Sent [date]" text) and replace with: `<div data-testid="draft-send-status" className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-[#475569]"><span>✉ Sent {new Date(draft.sentAt).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })}</span>{draft.openDetectedAt ? <span>👁 Opened {new Date(draft.openDetectedAt).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })}</span> : <span className="text-[#334155]">Not opened yet</span>}{draft.clickDetectedAt && <span>→ Clicked {new Date(draft.clickDetectedAt).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })}</span>}</div>`
- [x] T027 [P] [US5] Update `src/components/pipeline/ManualSendDraftCard.tsx` — in the `if (isAlreadySent)` branch, add `<CardContent className="pt-0 pb-2">` with identical status row structure (same `data-testid`, same date format, same open/click conditional logic) using `draft.sentAt`, `draft.openDetectedAt`, `draft.clickDetectedAt`
- [x] T028 [US5] Run `npx vitest run src/__tests__/components/pipeline/EmailDraftCard.test.tsx` — all tests including new timestamp cases must pass

**Checkpoint**: Sent drafts in both agentic and manual mode show engagement timestamps. Unsent drafts show no status row.

---

## Phase 8: Polish & Verification Gate

**Purpose**: Full verification before claiming feature complete.

- [x] T029 Run `npm run test:run` — must show 0 failures; screenshot or copy the summary line; fix any failures
- [x] T030 Run `npx tsc --noEmit` — must show no output (zero errors); fix any type errors
- [x] T031 Run `npm run build` — must exit 0 with no prerender errors; fix any build failures
- [ ] T032 Manual smoke test — TailoredResumeCard: approve job with fetched JD → click "✨ Tailor for This Role" → BuildProgressPane runs → TailoredResumeCard appears with keyword badges + archetype; then click "View Resume" to confirm PDF preview opens
- [ ] T033 Manual smoke test — stale warning: generate resume for a job → update CV in Settings → return to Pipeline → amber banner reads "⚠ CV updated since tailoring"
- [ ] T034 Manual smoke test — JD guard: find job with empty `jd_raw` → "✨ Tailor for This Role" button is disabled; hover shows tooltip "Fetch JD first before tailoring"
- [ ] T035 Manual smoke test — InsightsFunnelCard: open dashboard for candidate with sent outreach → funnel counts match DB; open dashboard for brand-new candidate → all rates show "—" and empty state message appears
- [ ] T036 Manual smoke test — per-draft timestamps: open email outreach panel for a cadence with a sent Day 1 draft → status row shows "✉ Sent [date]" and either "👁 Opened [date]" or "Not opened yet"
- [x] T037 Commit all changes with message: `feat(009): resume tailoring visibility + outreach insights dashboard`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (Foundational)**: Depends on Phase 1 — BLOCKS all user story phases
- **Phase 3 (US1)**: Depends on Phase 2 (needs types + API)
- **Phase 4 (US2)**: Depends on Phase 3 (stale warning is part of TailoredResumeCard)
- **Phase 5 (US3)**: Depends on Phase 2 (needs `InsightsResponse` type + `getInsights`)
- **Phase 6 (US4)**: Depends on Phase 5 (adds to InsightsFunnelCard)
- **Phase 7 (US5)**: Depends on Phase 2 only (types needed for `EmailDraftSummary`); can run in parallel with Phase 3–6
- **Phase 8 (Verification)**: Depends on all phases complete

### User Story Dependencies

- **US1 (P1)**: After Phase 2
- **US2 (P2)**: After US1 (stale warning extends TailoredResumeCard)
- **US3 (P2)**: After Phase 2 (independent of US1/US2)
- **US4 (P3)**: After US3 (archetype table is inside InsightsFunnelCard)
- **US5 (P3)**: After Phase 2 only — fully independent of US1–US4

### Parallel Opportunities

| Tasks | Can run together |
|---|---|
| T002, T003 | Both modify different files (types vs. api.ts) |
| T004, T008, T017 | All write test files before their implementations exist |
| T009, T018 | Different component files (TailoredResumeCard vs InsightsFunnelCard) |
| T026, T027 | Different component files (EmailDraftCard vs ManualSendDraftCard) |
| Phase 3–4 (US1/US2) + Phase 7 (US5) | Entirely different files |

---

## Parallel Example: Phases 3–4 + Phase 7 (after Phase 2 complete)

```
# Launch in parallel:
Task A: "Implement TailoredResumeCard and JobCard integration (T008-T013)"
Task B: "Implement per-draft timestamps in EmailDraftCard + ManualSendDraftCard (T025-T027)"
Task C: "Implement InsightsFunnelCard (T017-T021)"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 2: Foundational (T002–T007)
2. Complete Phase 3: TailoredResumeCard + JobCard (T008–T013)
3. **STOP and VALIDATE**: Keyword badges + archetype visible in job card
4. Continue to US2 (stale warning), US3 (funnel), US4 (archetype table), US5 (timestamps)

### Incremental Delivery

1. Foundation → Types + insights API live
2. US1 → Tailored resume visible in job card (headline differentiator vs. trypoet.ai)
3. US2 → Stale CV warning prevents silent quality degradation
4. US3+US4 → Outreach funnel + archetype breakdown (closes learning loop)
5. US5 → Per-draft timestamps (enriches manual send experience)

---

## Notes

- All tasks target `src/` directory (Next.js single project structure)
- No Python agent changes, no schema migrations, no new npm packages
- `aggregateInsights` is a pure function — unit test it directly without mocking the DB
- `jobs.grade` (varchar 1) is the grade column — not `scoreGrade`
- `archetypeConfidence` returned as string from Drizzle numeric column — convert with `Number()` before comparison
- Verify tests FAIL before implementing each component
- Commit after each phase checkpoint
