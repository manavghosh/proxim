# Quickstart: Resume Tailoring Visibility & Outreach Insights (009)

**Date**: 2026-05-26

---

## Prerequisites

- Node.js 18+, npm installed
- `.env.local` configured with `DATABASE_URL` (Neon or local SQLite path)
- `npm install` already run
- At least one candidate with approved jobs in the database

## Running the Dev Environment

```bash
npm run dev
# → http://localhost:3000
```

## Verifying the Feature End-to-End

### 1. InsightsFunnelCard (dashboard)

Navigate to: `http://localhost:3000/candidates/[candidateId]/dashboard`

Expected:
- `InsightsFunnelCard` renders below `JobSearchCard`
- If no outreach sent: all rates show "—" and message reads "Send your first email to see performance data."
- If outreach exists: funnel counts and rates display correctly

Verify counts match DB:
```bash
# In Drizzle Studio or direct SQL:
SELECT COUNT(*) FROM jobs WHERE candidate_id = '[id]';
SELECT COUNT(*) FROM email_cadences WHERE candidate_id = '[id]' AND reply_detected_at IS NOT NULL;
```

### 2. TailoredResumeCard (pipeline job card)

Navigate to: `http://localhost:3000/candidates/[candidateId]/pipeline`

- Expand a job with `status = 'approved'` that has a `resume_versions` row
- `TailoredResumeCard` renders with keyword badges, archetype name, confidence percentage
- "View Resume" and "View Cover Letter" buttons open the PDF preview sheet

### 3. Stale Resume Warning

- Generate a resume for an approved job
- Navigate to Settings and update the CV (append any text and save)
- Return to Pipeline view and expand the job card
- Amber banner reads: "⚠ CV updated since tailoring — consider re-tailoring."

### 4. JD Guard on Tailor Button

- Find or create a job with an empty `jd_raw` column
- In Pipeline, expand the job card
- "✨ Tailor for This Role" button is disabled
- Hover shows tooltip: "Fetch JD first before tailoring"

### 5. Per-Draft Timestamps

- Open the Email Outreach panel for a cadence with sent drafts
- Each sent draft shows "✉ Sent [date]" and either "👁 Opened [date]" or "Not opened yet"
- Unsent drafts show no status row

## Running Tests

```bash
npm run test:run     # all tests, single run
npx tsc --noEmit     # TypeScript check
npm run build        # production build
```

## Key Files

| File | Purpose |
|---|---|
| `src/app/api/candidates/[id]/insights/route.ts` | Insights aggregation endpoint |
| `src/components/dashboard/InsightsFunnelCard.tsx` | Dashboard funnel card |
| `src/components/applications/TailoredResumeCard.tsx` | Resume tailoring display |
| `src/components/applications/JobCard.tsx` | Updated button + card render |
| `src/components/pipeline/EmailDraftCard.tsx` | Per-draft timestamp row |
| `src/components/pipeline/ManualSendDraftCard.tsx` | Per-draft timestamp row (manual mode) |
| `src/types/candidate.ts` | `InsightsResponse`, `ResumeVersionSummary` types |
| `src/lib/api.ts` | `getInsights()` client function |
