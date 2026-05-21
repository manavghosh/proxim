# Live Updates — Design Spec
**Date:** 2026-05-21
**Status:** Approved for implementation

---

## 1. Problem

The Pipeline and Applications pages are static after load. Background daemon work (scoring, outreach, LinkedIn connector) writes to the DB but the pages have no mechanism to detect changes. Users must manually refresh to see scored jobs, outreach statuses, and email cadence updates.

---

## 2. Goals

1. Pipeline page automatically shows newly scored jobs and status changes without refresh.
2. After a user approves a job on the Pipeline page, the LinkedIn and email outreach sections update in-place as the daemon works — no refresh needed.
3. Applications page stays current even when the user navigates there after all transient states have already cleared.

---

## 3. Scope

| File | Change |
|---|---|
| `src/app/api/candidates/[id]/jobs/stream/route.ts` | Watch `updatedAt` instead of `createdAt`; also poll cadences and outreach targets |
| `src/app/candidates/[id]/pipeline/page.tsx` | Track `pendingOutreachIds`; show inline spinners; clear on SSE update |
| `src/components/pipeline/JobReviewCard.tsx` | Render outreach/email pending spinners when `isPendingOutreach` prop is true |
| `src/app/candidates/[id]/applications/page.tsx` | Subscribe to SSE stream; call `silentRefresh` on `jobs_arrived` |

---

## 4. Section 1 — Extended SSE Stream

### Current behaviour
The stream queries `jobs WHERE createdAt > lastSeenAt`. This only fires for brand-new job rows. Status changes to existing jobs (scoring completing, approval, etc.) are invisible.

### New behaviour
Replace the `createdAt` check with `updatedAt > lastSeenAt`. Additionally poll `email_cadences` and `outreach_targets` for changes. If any of these tables have rows updated since `lastSeenAt`, emit `jobs_arrived`.

### Updated poll logic (pseudocode)
```
changedJobs     = jobs WHERE candidateId=X AND updatedAt > lastSeenAt
changedCadences = email_cadences WHERE candidateId=X AND updatedAt > lastSeenAt
changedOutreach = outreach_targets WHERE candidateId=X AND updatedAt > lastSeenAt

if any of the above are non-empty:
  emit jobs_arrived { count, jobIds }
  lastSeenAt = now()
  idleMs = 0
else:
  idleMs += POLL_INTERVAL_MS
  if idleMs >= IDLE_TIMEOUT_MS: emit idle, close
```

### Compatibility note
The current query uses `sql\`${lastSeenAt}::timestamptz\`` (PostgreSQL raw cast). Replace with `gt(jobs.updatedAt, new Date(lastSeenAt))` — Drizzle handles the type correctly for both Neon and SQLite drivers.

### No event type changes
Still emits `jobs_arrived` only. All existing listeners (`startJobStream` in `api.ts`, Pipeline page, Applications page) require no interface change.

---

## 5. Section 2 — Pipeline page: optimistic outreach indicators

### Current behaviour
After `handleApprove`, job card shows "Approved" badge and nothing more. Outreach sections remain blank until user refreshes.

### New state
Add `pendingOutreachIds: Set<string>` to the Pipeline page state. When a job is approved, add its ID to this set.

```typescript
const [pendingOutreachIds, setPendingOutreachIds] = useState<Set<string>>(new Set())
```

Update `handleApprove`:
```typescript
const handleApprove = async (jobId: string) => {
  // ... existing approve logic ...
  setPendingOutreachIds(prev => new Set([...prev, jobId]))
}
```

Clear from the set after `loadJobs` completes and the job's outreach/cadence has left the transient state:
```typescript
// After loadJobs resolves, prune jobs that are no longer pending
setPendingOutreachIds(prev => {
  const next = new Set(prev)
  for (const id of prev) {
    const job = updatedJobs.find(j => j.id === id)
    if (!job) { next.delete(id); continue }
    const outreachDone = job.outreachTarget && !OUTREACH_TRANSIENT.has(job.outreachTarget.status)
    const emailDone    = job.emailCadence   && !EMAIL_TRANSIENT.has(job.emailCadence.status)
    if (outreachDone && emailDone) next.delete(id)
  }
  return next
})
```

Pass `isPendingOutreach` to `JobReviewCard`:
```tsx
<JobReviewCard
  ...
  isPendingOutreach={pendingOutreachIds.has(job.id)}
/>
```

### `JobReviewCard` changes

Add `isPendingOutreach?: boolean` to `JobReviewCardProps`.

When `isPendingOutreach` is true and the job is approved, render a subtle spinner row below the action area:

```tsx
{isApproved && isPendingOutreach && (
  <div className="mt-2 flex items-center gap-2 text-[10px] text-[#475569]">
    <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
    Outreach starting…
  </div>
)}
```

This disappears automatically once the SSE fires, `loadJobs` runs, and `pendingOutreachIds` is pruned.

---

## 6. Section 3 — Applications page: SSE subscription

### Current behaviour
The page polls every 5s only while transient outreach/cadence states are detected at load time. If the user arrives after all transients have cleared, polling never starts and stale data persists.

### New behaviour
Subscribe to the SSE stream using the existing `startJobStream` function from `api.ts`. On `jobs_arrived`, call `silentRefresh(selectedGrades)`.

```typescript
// In the Applications page useEffect (new):
useEffect(() => {
  const cleanup = startJobStream(
    candidateId,
    () => { void silentRefresh(selectedGrades) },  // jobs_arrived
    () => {}                                         // idle/disconnect — no action needed
  )
  return cleanup
}, [candidateId, selectedGrades, silentRefresh])
```

The existing 5s transient polling (`livePolling`) stays in place as a fallback. Together:
- SSE fires immediately when the daemon writes a change → page updates without polling delay
- Transient polling catches any SSE gaps (network hiccup, reconnect lag)

---

## 7. Data Flow Summary

```
Daemon completes scoring / outreach / cadence update
  → writes updatedAt to DB
  → SSE poll (5s) detects updatedAt > lastSeenAt
  → emits jobs_arrived to all connected clients
  → Pipeline page: loadJobs() runs → job list refreshes → pendingOutreachIds pruned
  → Applications page: silentRefresh() runs → job cards update in-place
```

---

## 8. IDLE_TIMEOUT change

Extend `IDLE_TIMEOUT_MS` from 60s to 300s (5 minutes). With the new `updatedAt` polling, the stream will fire more frequently and is more useful. A 1-minute timeout is too aggressive for a live-update system.

---

## 9. Files Touched

```
src/app/api/candidates/[id]/jobs/stream/route.ts   — updatedAt + cadences + outreach polling; extend idle timeout
src/app/candidates/[id]/pipeline/page.tsx           — pendingOutreachIds state + prune logic + pass to card
src/components/pipeline/JobReviewCard.tsx           — isPendingOutreach prop + spinner row
src/app/candidates/[id]/applications/page.tsx       — SSE subscription via startJobStream
```
