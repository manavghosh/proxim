# API Contracts: Resume Tailoring Visibility & Outreach Insights (009)

**Date**: 2026-05-26

---

## New Endpoint

### `GET /api/candidates/[id]/insights`

Returns aggregated outreach performance metrics for a candidate.

**Path params**: `id` — candidate UUID

**Auth**: none (candidate identity passed via path param, consistent with all other candidate routes)

**Success response — 200 OK**:

```json
{
  "funnel": {
    "discovered": 50,
    "approved": 20,
    "day1Sent": 10,
    "opened": 6,
    "replied": 3,
    "callbacks": 1
  },
  "rates": {
    "openRate": 0.6,
    "replyRate": 0.3,
    "abGradeRate": 0.65,
    "callbackRate": 0.05
  },
  "archetypeBreakdown": [
    {
      "archetype": "Enterprise CAIO",
      "approved": 10,
      "sent": 6,
      "replied": 3,
      "replyRate": 0.5
    },
    {
      "archetype": "Startup CTO",
      "approved": 10,
      "sent": 4,
      "replied": 0,
      "replyRate": 0
    }
  ]
}
```

**Empty state response — 200 OK** (zero outreach):

```json
{
  "funnel": {
    "discovered": 0,
    "approved": 0,
    "day1Sent": 0,
    "opened": 0,
    "replied": 0,
    "callbacks": 0
  },
  "rates": {
    "openRate": null,
    "replyRate": null,
    "abGradeRate": null,
    "callbackRate": null
  },
  "archetypeBreakdown": []
}
```

**Key invariants:**
- `rates.*` fields are `null` (not `0`) when the denominator is zero
- `archetypeBreakdown` is `[]` when fewer than 2 distinct archetypes exist in approved jobs
- `archetypeBreakdown` is sorted by `replyRate` descending, then `approved` descending as tiebreak
- `archetypeBreakdown` has at most 5 rows
- `day1Sent` counts at most 1 per cadence (most recent `sentAt` when retries exist)
- `opened` counts distinct cadences where at least one draft has both `sentAt` and `openDetectedAt` set
- `replied` counts cadences with `replyDetectedAt` regardless of cadence `status`

---

## Existing Endpoints — No Changes

### `GET /api/jobs/[jobId]/resume?candidateId=[id]`

Already returns:
```json
{
  "versions": [
    {
      "id": "...",
      "jobId": "...",
      "archetype": "Enterprise CAIO",
      "archetypeConfidence": "0.85",
      "keywords": ["AI Strategy", "Digital Transformation"],
      "resumePdfPath": "/pdfs/rv1.pdf",
      "coverLetterPdfPath": "/pdfs/rv1-cl.pdf",
      "baseCvHash": "abc123",
      "isSubmitted": false,
      "generationStatus": "completed",
      "versionN": 1,
      "createdAt": "2026-01-01T10:00:00Z",
      "isStale": false
    }
  ],
  "currentCvHash": "abc123"
}
```

`isStale` is computed by the route: `currentCvHash !== null && version.baseCvHash !== currentCvHash`.

`TailoredResumeCard` consumes this existing endpoint — no changes to the endpoint required.

---

## Existing Endpoints — `jdRaw` Verification Required

### `GET /api/jobs?candidateId=[id]` (or equivalent jobs listing endpoint)

**Action required during implementation (T005)**: Verify whether `jdRaw` is included in the jobs API response consumed by `JobCard`. If absent, add `jdRaw: string` to the `ScoredJob` interface and include it in the Drizzle select. The column exists in the DB (`text().notNull()` with default `''`).

**Guard logic**: Button is disabled when `job.jdRaw === ''` (empty string = JD not yet fetched).
