# Live Updates — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate manual page refreshes — Pipeline updates automatically when scoring/outreach completes; Applications stays live even when user navigates there after transients have cleared.

**Architecture:** Extend the existing SSE stream to watch `updatedAt` on three tables (jobs, email_cadences, outreach_targets) instead of only new job rows; Pipeline page tracks recently-approved jobs with `pendingOutreachIds` state and shows inline spinners until the SSE fires; Applications page subscribes to the same stream and calls its existing `silentRefresh` function on every event.

**Tech Stack:** Next.js 15, Drizzle ORM, React `useState`/`useEffect`, SSE (`ReadableStream`)

---

## File Map

| File | Change |
|---|---|
| `src/app/api/candidates/[id]/jobs/stream/route.ts` | Watch `updatedAt` on jobs + cadences + outreach; extend idle timeout to 300s |
| `src/app/candidates/[id]/pipeline/page.tsx` | Add `pendingOutreachIds` state; prune on jobs update; pass `isPendingOutreach` to card |
| `src/components/pipeline/JobReviewCard.tsx` | Add `isPendingOutreach` prop; render "Outreach starting…" spinner |
| `src/app/candidates/[id]/applications/page.tsx` | Subscribe to SSE stream; call `silentRefresh` on `jobs_arrived` |

---

### Task 1: Extend the SSE stream

**Files:**
- Modify: `src/app/api/candidates/[id]/jobs/stream/route.ts`

- [ ] **Step 1: Replace the route file**

The current file only watches `jobs.createdAt`. Replace it entirely with the version below that watches `updatedAt` on three tables and extends the idle timeout to 5 minutes.

```typescript
import { and, eq, gt } from 'drizzle-orm'
import { db } from '@/db'
import { jobs, emailCadences, outreachTargets } from '@/db/schema'

const POLL_INTERVAL_MS = 5000
const IDLE_TIMEOUT_MS  = 300000   // 5 minutes — was 60s

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: candidateId } = await params

  const stream = new ReadableStream({
    async start(controller) {
      const encode = (event: string, data: unknown) => {
        const json = JSON.stringify(data)
        return new TextEncoder().encode(`event: ${event}\ndata: ${json}\n\n`)
      }

      let lastSeenAt = new Date().toISOString()
      let idleMs = 0

      const poll = async () => {
        try {
          const since = new Date(lastSeenAt)

          const [changedJobs, changedCadences, changedOutreach] = await Promise.all([
            db.select({ id: jobs.id })
              .from(jobs)
              .where(and(eq(jobs.candidateId, candidateId), gt(jobs.updatedAt, since))),
            db.select({ id: emailCadences.id })
              .from(emailCadences)
              .where(and(eq(emailCadences.candidateId, candidateId), gt(emailCadences.updatedAt, since))),
            db.select({ id: outreachTargets.id })
              .from(outreachTargets)
              .where(and(eq(outreachTargets.candidateId, candidateId), gt(outreachTargets.updatedAt, since))),
          ])

          const hasChanges =
            changedJobs.length > 0 ||
            changedCadences.length > 0 ||
            changedOutreach.length > 0

          if (hasChanges) {
            lastSeenAt = new Date().toISOString()
            idleMs = 0
            controller.enqueue(
              encode('jobs_arrived', {
                count:  changedJobs.length,
                jobIds: changedJobs.map(j => j.id),
              })
            )
          } else {
            idleMs += POLL_INTERVAL_MS
            if (idleMs >= IDLE_TIMEOUT_MS) {
              controller.enqueue(encode('idle', {}))
              controller.close()
              return
            }
          }

          await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))
          poll()
        } catch {
          controller.close()
        }
      }

      poll()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type':    'text/event-stream',
      'Cache-Control':   'no-cache',
      Connection:        'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
```

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit
```
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/candidates/[id]/jobs/stream/route.ts"
git commit -m "feat: SSE stream watches updatedAt on jobs + cadences + outreach; extend idle timeout to 5m"
```

---

### Task 2: Pipeline page — `pendingOutreachIds` state + prune logic

**Files:**
- Modify: `src/app/candidates/[id]/pipeline/page.tsx`

- [ ] **Step 1: Add imports**

At the top of `src/app/candidates/[id]/pipeline/page.tsx`, add `OutreachStatus` and `EmailCadenceStatus` to the existing import from `@/types/candidate`:

```typescript
import type { OutreachStatus, EmailCadenceStatus } from '@/types/candidate'
```

- [ ] **Step 2: Add `pendingOutreachIds` state**

After the existing `retryJobIds` state declaration, add:

```typescript
const [pendingOutreachIds, setPendingOutreachIds] = useState<Set<string>>(new Set())
```

- [ ] **Step 3: Update `handleApprove` to track the approved job**

Find `handleApprove`. After the line `setJobs(prev => prev.map(j => j.id === jobId ? { ...j, status: 'approved' } : j))`, add:

```typescript
      setPendingOutreachIds(prev => new Set([...prev, jobId]))
```

The full updated function:

```typescript
const handleApprove = async (jobId: string) => {
  setPending(jobId, true)
  try {
    await approveJob(jobId, candidateId)
    setJobs(prev => prev.map(j => j.id === jobId ? { ...j, status: 'approved' } : j))
    setPendingOutreachIds(prev => new Set([...prev, jobId]))
    showToast('Job approved — LinkedIn outreach queued', 'success')
  } catch (e: unknown) {
    if (e instanceof Error && e.message.startsWith('409')) {
      showToast('Already decided — refreshing…', 'info')
      loadJobs(selectedGrades, sort)
    } else {
      showToast('Failed to approve job', 'error')
    }
  } finally {
    setPending(jobId, false)
  }
}
```

- [ ] **Step 4: Add prune `useEffect`**

Add a new `useEffect` that watches `jobs` state and removes IDs from `pendingOutreachIds` when their outreach and email statuses leave the transient state. Place it after the existing `reconnectStream` effect:

```typescript
useEffect(() => {
  if (pendingOutreachIds.size === 0) return
  const OUTREACH_TRANSIENT = new Set<OutreachStatus>(['pending', 'discovering', 'enriching', 'generating'])
  const EMAIL_TRANSIENT    = new Set<EmailCadenceStatus>(['pending_discovery', 'discovering', 'generating'])
  setPendingOutreachIds(prev => {
    const next = new Set(prev)
    for (const id of prev) {
      const job = jobs.find(j => j.id === id)
      if (!job) { next.delete(id); continue }
      const outreachDone = job.outreachTarget && !OUTREACH_TRANSIENT.has(job.outreachTarget.status as OutreachStatus)
      const emailDone    = job.emailCadence   && !EMAIL_TRANSIENT.has(job.emailCadence.status as EmailCadenceStatus)
      if (outreachDone && emailDone) next.delete(id)
    }
    return next
  })
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [jobs])
```

- [ ] **Step 5: Pass `isPendingOutreach` to `JobReviewCard`**

Find the `<JobReviewCard ... />` usage inside the `scoredJobs.map(...)` and add the prop:

```tsx
<JobReviewCard
  key={job.id}
  job={job}
  candidateId={candidateId}
  onApprove={handleApprove}
  onReject={handleReject}
  onSnooze={handleSnooze}
  onUnsnooze={handleUnsnooze}
  onGenerateResume={handleGenerateResume}
  isPending={pendingJobIds.has(job.id)}
  onUpdate={() => loadJobs(selectedGrades, sort)}
  isPendingOutreach={pendingOutreachIds.has(job.id)}
/>
```

- [ ] **Step 6: TypeScript check**

```bash
npx tsc --noEmit
```
Expected: one TS error about `isPendingOutreach` not being in `JobReviewCardProps` — that's fine, it will be fixed in Task 3.

- [ ] **Step 7: Commit**

```bash
git add "src/app/candidates/[id]/pipeline/page.tsx"
git commit -m "feat: Pipeline page tracks pendingOutreachIds and prunes on job update"
```

---

### Task 3: `JobReviewCard` — `isPendingOutreach` prop + spinner

**Files:**
- Modify: `src/components/pipeline/JobReviewCard.tsx`

- [ ] **Step 1: Add `isPendingOutreach` to `JobReviewCardProps`**

Find the `interface JobReviewCardProps` and add the new optional prop as the last field:

```typescript
interface JobReviewCardProps {
  job: HitlJob
  candidateId: string
  onApprove: (jobId: string) => void
  onReject: (jobId: string) => void
  onSnooze: (jobId: string) => void
  onUnsnooze: (jobId: string) => void
  onGenerateResume: (jobId: string) => void
  isPending: boolean
  outreachTarget?: OutreachTargetSummary | null
  emailCadence?: EmailCadenceSummary | null
  onUpdate: () => void
  isPendingOutreach?: boolean
}
```

- [ ] **Step 2: Destructure `isPendingOutreach` in the function signature**

Find `export function JobReviewCard({` and add `isPendingOutreach = false` to the destructuring list:

```typescript
export function JobReviewCard({
  job,
  candidateId,
  onApprove,
  onReject,
  onSnooze,
  onUnsnooze,
  onGenerateResume,
  isPending,
  outreachTarget,
  emailCadence,
  onUpdate,
  isPendingOutreach = false,
}: JobReviewCardProps) {
```

- [ ] **Step 3: Render the spinner row**

Find the "Generate Resume" button section that renders for `job.status === 'approved'`:

```tsx
{/* Generate Resume — shown on approved jobs that don't have a resume yet */}
{job.status === 'approved' && (
```

Add the spinner row immediately after that closing `</div>`:

```tsx
{/* Outreach pending indicator */}
{isApproved && isPendingOutreach && (
  <div className="mt-2 flex items-center gap-2 text-[10px] text-[#475569]">
    <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse shrink-0" />
    Outreach starting…
  </div>
)}
```

- [ ] **Step 4: TypeScript check**

```bash
npx tsc --noEmit
```
Expected: no output (zero errors).

- [ ] **Step 5: Run tests**

```bash
npm run test:run
```
Expected: 0 new failures.

- [ ] **Step 6: Commit**

```bash
git add src/components/pipeline/JobReviewCard.tsx
git commit -m "feat: JobReviewCard shows 'Outreach starting…' spinner when isPendingOutreach"
```

---

### Task 4: Applications page — SSE subscription

**Files:**
- Modify: `src/app/candidates/[id]/applications/page.tsx`

- [ ] **Step 1: Add `startJobStream` to the existing import**

Find the import line from `@/lib/api`:

```typescript
import { getJobs, markSubmitted, rejectJob, getResumeVersions, triggerResumeGeneration, getPreferences } from '@/lib/api'
```

Add `startJobStream`:

```typescript
import { getJobs, markSubmitted, rejectJob, getResumeVersions, triggerResumeGeneration, getPreferences, startJobStream } from '@/lib/api'
```

- [ ] **Step 2: Add the SSE subscription `useEffect`**

Place this new `useEffect` immediately after the existing transient-polling effect (after the block ending with `}, [jobs, loading, selectedGrades, silentRefresh])`):

```typescript
// SSE stream — fires immediately when the daemon writes any change,
// covering the case where the user navigates here after transients have cleared.
useEffect(() => {
  const cleanup = startJobStream(
    candidateId,
    () => { void silentRefresh(selectedGrades) },
    () => { /* idle/disconnect — transient polling covers reconnect */ }
  )
  return cleanup
}, [candidateId, selectedGrades, silentRefresh])
```

- [ ] **Step 3: TypeScript check**

```bash
npx tsc --noEmit
```
Expected: no output.

- [ ] **Step 4: Run full test suite**

```bash
npm run test:run
```
Expected: 0 new failures.

- [ ] **Step 5: Commit**

```bash
git add "src/app/candidates/[id]/applications/page.tsx"
git commit -m "feat: Applications page subscribes to SSE stream for real-time updates"
```

---

### Task 5: Final verification

- [ ] **Step 1: TypeScript check**

```bash
npx tsc --noEmit
```
Expected: no output.

- [ ] **Step 2: Full test run**

```bash
npm run test:run
```
Expected: 0 failures (excluding the 7 pre-existing mock failures in `override-email.test.ts` and `select-and-send.test.ts`).

- [ ] **Step 3: Production build**

```bash
npm run build
```
Expected: exit 0, no prerender errors.

- [ ] **Step 4: Manual smoke test**

1. Start dev server: `npm run dev`
2. Start daemon: `cd agent && poetry run python -m agent.daemon`
3. Open the Pipeline page. Import a job URL. Wait for scoring.
4. **Verify**: the scored job card appears automatically (no refresh) when scoring completes.
5. Approve the job. **Verify**: "Outreach starting…" spinner appears immediately on the card.
6. Wait for LinkedIn connector + outreach mailer to finish (~30s). **Verify**: spinner disappears, outreach status badge appears — all without refresh.
7. Navigate to Applications page. **Verify**: cadence status updates in-place as the daemon works.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: live updates — SSE watches updatedAt, Pipeline outreach spinners, Applications SSE subscription"
```
