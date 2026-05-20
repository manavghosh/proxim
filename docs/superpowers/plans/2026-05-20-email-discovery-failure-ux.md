# Email Discovery Failure UX — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When email discovery fails, show an actionable inline panel on the Pipeline page with three forward paths (enter email manually, use LinkedIn, skip), cap retries at 2, and generate email draft bodies optimistically so a manual email override proceeds instantly.

**Architecture:** Schema gets `retry_count`; the agent removes its early-return guard so drafts are always generated; the override-email API is expanded to accept both `email_not_found` and `low_confidence`; a new `EmailNotFoundPanel` React component replaces the passive badge for blocked cadences.

**Tech Stack:** Next.js 15, Drizzle ORM (PostgreSQL + SQLite), Python aiosqlite, LangGraph, Vitest + Testing Library

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `src/db/schema.ts` | Modify | Add `retryCount` column to `emailCadences` |
| `migrations/XXXX_retry_count.sql` | Generated | PostgreSQL migration |
| `migrations/sqlite/0007_add_retry_count.sql` | Create | SQLite dev migration |
| `src/types/candidate.ts` | Modify | Add `retryCount` to `EmailCadenceSummary` |
| `src/app/api/candidates/[id]/jobs/route.ts` | Modify | Select + map `retryCount` |
| `src/app/api/jobs/[jobId]/start-email-outreach/route.ts` | Modify | Read + enforce retry cap, increment counter |
| `src/app/api/email-cadence/[cadenceId]/override-email/route.ts` | Modify | Accept `email_not_found`; go direct to `pending_approval` when drafts exist |
| `agent/agent/daemon.py` | Modify | Remove early-return guard; always run generation |
| `agent/agent/nodes/outreach_mailer.py` | Modify | `write_cadence_checkpoint_node` sets status from state |
| `src/components/pipeline/EmailNotFoundPanel.tsx` | Create | Inline action strip for blocked cadences |
| `src/components/pipeline/JobReviewCard.tsx` | Modify | Swap badge → panel; add `onUpdate` prop |
| `src/app/candidates/[id]/pipeline/page.tsx` | Modify | Pass `onUpdate` to each `JobReviewCard` |
| `src/components/applications/JobCard.tsx` | Modify | Handle 429 from `startEmailOutreach` gracefully |
| `src/__tests__/components/EmailNotFoundPanel.test.tsx` | Create | Component unit tests |

---

### Task 1: Add `retry_count` to PostgreSQL schema and generate migration

**Files:**
- Modify: `src/db/schema.ts`
- Generated: `migrations/XXXX_*.sql` (via `npm run db:generate`)

- [ ] **Step 1: Add the column to the schema**

In `src/db/schema.ts`, find the `emailCadences` table definition and add `retryCount` after `errorMessage`:

```typescript
export const emailCadences = pgTable('email_cadences', {
  id:                 uuid().defaultRandom().primaryKey(),
  jobId:              uuid().references(() => jobs.id).notNull(),
  candidateId:        uuid().references(() => candidates.id).notNull(),
  hiringManagerEmail: text(),
  emailConfidence:    integer(),
  emailSource:        text(),
  gmailThreadId:      text(),
  day1MessageId:      text(),
  status:             emailCadenceStatusEnum().default('pending_discovery').notNull(),
  approvedAt:         timestamp({ withTimezone: true }),
  replyDetectedAt:    timestamp({ withTimezone: true }),
  bounceDetectedAt:   timestamp({ withTimezone: true }),
  errorMessage:       text(),
  retryCount:         integer().notNull().default(0),
  createdAt:          timestamp({ withTimezone: true }).defaultNow().notNull(),
  updatedAt:          timestamp({ withTimezone: true }).defaultNow().notNull().$onUpdateFn(() => new Date()),
}, (table) => [
  uniqueIndex('email_cadences_job_id_unique').on(table.jobId),
  index('email_cadences_candidate_status_idx').on(table.candidateId, table.status),
])
```

- [ ] **Step 2: Generate the Drizzle migration**

```bash
npm run db:generate
```

Expected: a new file appears in `migrations/` named something like `0011_*.sql` containing:
```sql
ALTER TABLE "email_cadences" ADD COLUMN "retry_count" integer DEFAULT 0 NOT NULL;
```

- [ ] **Step 3: Apply the migration**

```bash
npm run db:migrate
```

Expected: migration runs without error.

- [ ] **Step 4: Commit**

```bash
git add src/db/schema.ts migrations/
git commit -m "feat: add retry_count to email_cadences schema"
```

---

### Task 2: Add SQLite dev migration

**Files:**
- Create: `migrations/sqlite/0007_add_retry_count.sql`

- [ ] **Step 1: Create the SQLite migration file**

```sql
ALTER TABLE email_cadences ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0;
```

- [ ] **Step 2: Apply to the local dev database**

```bash
cd agent
poetry run python - <<'EOF'
import asyncio, aiosqlite, os
from pathlib import Path

async def main():
    db_path = os.environ.get("DATABASE_URL", "../proxim-dev.db").replace("sqlite:///", "")
    async with aiosqlite.connect(db_path) as db:
        try:
            await db.execute("ALTER TABLE email_cadences ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0")
            await db.commit()
            print("Migration applied")
        except Exception as e:
            print(f"Already applied or error: {e}")

asyncio.run(main())
EOF
```

Expected: `Migration applied` or `Already applied or error: duplicate column name`.

- [ ] **Step 3: Commit**

```bash
git add migrations/sqlite/0007_add_retry_count.sql
git commit -m "feat: add retry_count SQLite migration"
```

---

### Task 3: Add `retryCount` to TypeScript types and jobs API response

**Files:**
- Modify: `src/types/candidate.ts`
- Modify: `src/app/api/candidates/[id]/jobs/route.ts`

- [ ] **Step 1: Add `retryCount` to `EmailCadenceSummary`**

In `src/types/candidate.ts`, find `EmailCadenceSummary` and add `retryCount`:

```typescript
export interface EmailCadenceSummary {
  id: string
  status: EmailCadenceStatus
  hiringManagerEmail: string | null
  emailConfidence: number | null
  approvedAt: string | null
  replyDetectedAt: string | null
  bounceDetectedAt: string | null
  retryCount: number
  drafts: EmailDraftSummary[]
}
```

- [ ] **Step 2: Select `retryCount` in the jobs query**

In `src/app/api/candidates/[id]/jobs/route.ts`, find the `.select({...})` block where cadence fields are selected and add:

```typescript
cadenceRetryCount:      emailCadences.retryCount,
```

Place it after `cadenceBounceAt`.

- [ ] **Step 3: Map `retryCount` into the response object**

In the same file, find the `emailCadence: r.cadenceId ? ({...}) : null` mapping block and add `retryCount`:

```typescript
emailCadence: r.cadenceId
  ? ({
      id:                 r.cadenceId,
      status:             r.cadenceStatus as EmailCadenceStatus,
      hiringManagerEmail: r.cadenceHiringEmail,
      emailConfidence:    r.cadenceEmailConfidence,
      approvedAt:         r.cadenceApprovedAt ? String(r.cadenceApprovedAt) : null,
      replyDetectedAt:    r.cadenceReplyAt ? String(r.cadenceReplyAt) : null,
      bounceDetectedAt:   r.cadenceBounceAt ? String(r.cadenceBounceAt) : null,
      retryCount:         r.cadenceRetryCount ?? 0,
      drafts:             draftsByC[r.cadenceId] ?? [],
    } satisfies EmailCadenceSummary)
  : null,
```

- [ ] **Step 4: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no output (zero errors).

- [ ] **Step 5: Commit**

```bash
git add src/types/candidate.ts src/app/api/candidates/[id]/jobs/route.ts
git commit -m "feat: add retryCount to EmailCadenceSummary type and jobs API"
```

---

### Task 4: Enforce retry cap in `start-email-outreach` API

**Files:**
- Modify: `src/app/api/jobs/[jobId]/start-email-outreach/route.ts`

- [ ] **Step 1: Replace the route file with the updated version**

```typescript
import { NextResponse } from 'next/server'
import { eq, and } from 'drizzle-orm'
import { db } from '@/db'
import { jobs, pipelineJobs, emailCadences } from '@/db/schema'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params
    const url = new URL(request.url)
    const candidateId = url.searchParams.get('candidateId')
    if (!candidateId) return NextResponse.json({ error: 'candidateId required' }, { status: 400 })

    const [job] = await db
      .select({ company: jobs.company, title: jobs.title, archetype: jobs.archetype, archetypeConfidence: jobs.archetypeConfidence })
      .from(jobs)
      .where(and(eq(jobs.id, jobId), eq(jobs.candidateId, candidateId)))
      .limit(1)

    if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

    const [existing] = await db
      .select({ id: emailCadences.id, status: emailCadences.status, retryCount: emailCadences.retryCount })
      .from(emailCadences)
      .where(eq(emailCadences.jobId, jobId))
      .limit(1)

    const RESTARTABLE = ['failed', 'cancelled', 'email_not_found', 'low_confidence', 'pending_discovery', 'discovering', 'generating']
    if (existing && !RESTARTABLE.includes(existing.status)) {
      return NextResponse.json(
        { error: 'Email outreach already running', currentStatus: existing.status },
        { status: 409 }
      )
    }

    if (existing && existing.retryCount >= 2) {
      return NextResponse.json(
        { error: 'Max retries reached', retryCount: existing.retryCount },
        { status: 429 }
      )
    }

    // Increment retry counter on the existing cadence before queueing
    if (existing) {
      await db
        .update(emailCadences)
        .set({ retryCount: existing.retryCount + 1 })
        .where(eq(emailCadences.id, existing.id))
    }

    const [pj] = await db
      .insert(pipelineJobs)
      .values({
        jobType: 'outreach_mailer',
        candidateId,
        payload: {
          job_id:               jobId,
          candidate_id:         candidateId,
          company:              job.company ?? '',
          job_title:            job.title,
          archetype:            job.archetype ?? '',
          archetype_confidence: Number(job.archetypeConfidence ?? 0),
        },
      })
      .returning({ id: pipelineJobs.id })

    return NextResponse.json({ pipelineJobId: pj.id, status: 'queued' })
  } catch (e) {
    console.error('[start-email-outreach] error:', e)
    return NextResponse.json({ error: 'Failed to start email outreach' }, { status: 500 })
  }
}
```

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/jobs/[jobId]/start-email-outreach/route.ts
git commit -m "feat: enforce retry cap (max 2) in start-email-outreach"
```

---

### Task 5: Expand `override-email` to handle `email_not_found` with instant approval

**Files:**
- Modify: `src/app/api/email-cadence/[cadenceId]/override-email/route.ts`

- [ ] **Step 1: Replace the route with the expanded version**

```typescript
import { NextResponse } from 'next/server'
import { eq, and } from 'drizzle-orm'
import { db } from '@/db'
import { emailCadences, emailDrafts, pipelineJobs } from '@/db/schema'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ cadenceId: string }> }
) {
  try {
    const { cadenceId } = await params
    const url = new URL(request.url)
    const candidateId = url.searchParams.get('candidateId')
    if (!candidateId) {
      return NextResponse.json({ error: 'candidateId is required' }, { status: 400 })
    }

    const { confirmedEmail } = await request.json() as { confirmedEmail?: string }
    if (!confirmedEmail || !confirmedEmail.includes('@')) {
      return NextResponse.json({ error: 'A valid email address is required' }, { status: 400 })
    }

    const [cadence] = await db
      .select()
      .from(emailCadences)
      .where(and(eq(emailCadences.id, cadenceId), eq(emailCadences.candidateId, candidateId)))
      .limit(1)

    if (!cadence) {
      return NextResponse.json({ error: 'Cadence not found' }, { status: 404 })
    }

    const OVERRIDABLE = ['low_confidence', 'email_not_found', 'failed']
    if (!OVERRIDABLE.includes(cadence.status)) {
      return NextResponse.json(
        { error: `Cannot override email in status '${cadence.status}'` },
        { status: 422 }
      )
    }

    // Check whether drafts were already generated (optimistic generation)
    const [existingDraft] = await db
      .select({ id: emailDrafts.id })
      .from(emailDrafts)
      .where(eq(emailDrafts.cadenceId, cadenceId))
      .limit(1)

    if (existingDraft) {
      // Drafts exist — go straight to pending_approval, no generation job needed
      await db
        .update(emailCadences)
        .set({
          hiringManagerEmail: confirmedEmail,
          emailSource:        'manual',
          status:             'pending_approval',
          updatedAt:          new Date(),
        })
        .where(eq(emailCadences.id, cadenceId))

      return NextResponse.json({
        cadenceId,
        status:             'pending_approval',
        hiringManagerEmail: confirmedEmail,
        emailSource:        'manual',
      })
    }

    // No drafts yet (cadence pre-dates optimistic generation) — trigger generation
    await db
      .update(emailCadences)
      .set({
        hiringManagerEmail: confirmedEmail,
        emailSource:        'manual',
        status:             'generating',
        updatedAt:          new Date(),
      })
      .where(eq(emailCadences.id, cadenceId))

    await db.insert(pipelineJobs).values({
      jobType:     'outreach_mailer_generate',
      candidateId,
      payload: {
        cadence_id:   cadenceId,
        job_id:       cadence.jobId,
        candidate_id: candidateId,
      },
    })

    return NextResponse.json({
      cadenceId,
      status:             'generating',
      hiringManagerEmail: confirmedEmail,
      emailSource:        'manual',
    })
  } catch (e) {
    console.error('[/api/email-cadence/override-email] POST error:', e)
    return NextResponse.json({ error: 'Failed to override email' }, { status: 500 })
  }
}
```

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/email-cadence/[cadenceId]/override-email/route.ts
git commit -m "feat: override-email handles email_not_found and goes to pending_approval when drafts exist"
```

---

### Task 6: Agent — optimistic draft generation

**Files:**
- Modify: `agent/agent/daemon.py`
- Modify: `agent/agent/nodes/outreach_mailer.py`

- [ ] **Step 1: Remove early-return guard in `daemon.py`**

Find the `outreach_mailer` handler in `daemon.py` (around line 350). Replace:

```python
    if job['job_type'] == 'outreach_mailer':
        cadence_id = await insert_email_cadence(pool, job_id, cand_id)
    else:
        cadence_id = str(payload.get('cadence_id', ''))
        # Guard: cadence must exist ...
        async with pool.execute(
            "SELECT id FROM email_cadences WHERE id = ?", (cadence_id,)
        ) as cursor:
            if not await cursor.fetchone():
                logger.warning("outreach_mailer_generate.cadence_not_found", ...)
                await update_pipeline_job_status(pool, pj_id, 'failed', ...)
                return
```

The `outreach_mailer` (not `outreach_mailer_generate`) block further down has this early-return pattern. Find and replace these lines inside the `if job['job_type'] == 'outreach_mailer':` branch:

```python
        # BEFORE (remove these lines):
        if job['job_type'] == 'outreach_mailer':
            state = {**state, **(await discover_email_node(state, config))}
            if state["status"] in ("email_not_found", "low_confidence"):
                await update_pipeline_job_status(pool, pj_id, 'completed')
                return
            state = {**state, **(await generate_emails_node(state, config))}
            if state["status"] == "failed":
                await update_pipeline_job_status(pool, pj_id, 'failed',
                                                  error=state.get("error") or "Generation failed")
                return
            await write_cadence_checkpoint_node(state, config)
            await update_pipeline_job_status(pool, pj_id, 'completed')
```

Replace with:

```python
        if job['job_type'] == 'outreach_mailer':
            state = {**state, **(await discover_email_node(state, config))}
            # Always generate drafts — even when no email found, so a manual
            # override can proceed to pending_approval without a second wait.
            state = {**state, **(await generate_emails_node(state, config))}
            if state["status"] == "failed":
                await update_pipeline_job_status(pool, pj_id, 'failed',
                                                  error=state.get("error") or "Generation failed")
                return
            await write_cadence_checkpoint_node(state, config)
            await update_pipeline_job_status(pool, pj_id, 'completed')
```

- [ ] **Step 2: Update `write_cadence_checkpoint_node` to use discovery status**

In `agent/agent/nodes/outreach_mailer.py`, find `write_cadence_checkpoint_node`. Replace the final `update_email_cadence` call:

```python
    # BEFORE:
    await update_email_cadence(pool, cadence_id, status="pending_approval")

    # AFTER:
    # Use the discovery outcome to set the correct terminal status.
    # discovered_email is set only when discovery succeeded (high or low confidence).
    # When no email was found the status in state is already 'email_not_found'.
    discovery_status = state.get("status", "email_not_found")
    final_status = "pending_approval" if state.get("discovered_email") else discovery_status
    await update_email_cadence(pool, cadence_id, status=final_status)
```

- [ ] **Step 3: Verify the daemon starts cleanly**

```bash
cd agent
poetry run python -c "from agent.daemon import main; print('import ok')"
```

Expected: `import ok`

- [ ] **Step 4: Commit**

```bash
git add agent/agent/daemon.py agent/agent/nodes/outreach_mailer.py
git commit -m "feat: generate email drafts optimistically regardless of email discovery outcome"
```

---

### Task 7: Create `EmailNotFoundPanel` component

**Files:**
- Create: `src/components/pipeline/EmailNotFoundPanel.tsx`
- Create: `src/__tests__/components/EmailNotFoundPanel.test.tsx`

- [ ] **Step 1: Write the failing tests first**

Create `src/__tests__/components/EmailNotFoundPanel.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { EmailNotFoundPanel } from '@/components/pipeline/EmailNotFoundPanel'
import type { EmailCadenceSummary } from '@/types/candidate'
import type { OutreachTargetSummary } from '@/types/candidate'

vi.mock('@/lib/api', () => ({
  overrideEmail:      vi.fn().mockResolvedValue({ cadenceId: 'c1', status: 'pending_approval' }),
  cancelCadence:      vi.fn().mockResolvedValue({ cadenceId: 'c1', status: 'cancelled' }),
  startEmailOutreach: vi.fn().mockResolvedValue({ pipelineJobId: 'pj1', status: 'queued' }),
}))

const baseCadence: EmailCadenceSummary = {
  id: 'c1', status: 'email_not_found', hiringManagerEmail: null,
  emailConfidence: null, approvedAt: null, replyDetectedAt: null,
  bounceDetectedAt: null, retryCount: 0, drafts: [],
}

const baseProps = {
  jobId: 'j1', candidateId: 'cand1',
  cadence: baseCadence, company: 'Acme Corp',
  outreachTarget: null, onUpdate: vi.fn(),
}

describe('EmailNotFoundPanel', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows "No email found" message for email_not_found status', () => {
    render(<EmailNotFoundPanel {...baseProps} />)
    expect(screen.getByText('No email found for Acme Corp')).toBeInTheDocument()
  })

  it('shows "could not be verified" message for low_confidence status', () => {
    render(<EmailNotFoundPanel {...baseProps} cadence={{ ...baseCadence, status: 'low_confidence' }} />)
    expect(screen.getByText(/could not be verified for Acme Corp/)).toBeInTheDocument()
  })

  it('shows Retry (0/2) when retryCount is 0', () => {
    render(<EmailNotFoundPanel {...baseProps} />)
    expect(screen.getByText('Retry (0/2)')).toBeInTheDocument()
  })

  it('shows Retry (1/2) when retryCount is 1', () => {
    render(<EmailNotFoundPanel {...baseProps} cadence={{ ...baseCadence, retryCount: 1 }} />)
    expect(screen.getByText('Retry (1/2)')).toBeInTheDocument()
  })

  it('disables retry and shows max message when retryCount is 2', () => {
    render(<EmailNotFoundPanel {...baseProps} cadence={{ ...baseCadence, retryCount: 2 }} />)
    expect(screen.getByText('Max retries reached')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /max retries/i })).toBeDisabled()
  })

  it('hides LinkedIn button when outreachTarget is null', () => {
    render(<EmailNotFoundPanel {...baseProps} outreachTarget={null} />)
    expect(screen.queryByText(/Use LinkedIn/)).not.toBeInTheDocument()
  })

  it('shows LinkedIn button when outreachTarget has a linkedinUrl', () => {
    const target: OutreachTargetSummary = {
      id: 't1', status: 'notes_ready', name: 'Ivy Wong',
      linkedinUrl: 'https://linkedin.com/in/ivy-wong',
      title: 'HR Director', seniority: null,
      noteA: null, noteB: null, selectedNote: null,
      editedNote: null, sentAt: null, acceptedAt: null, errorMessage: null,
    }
    render(<EmailNotFoundPanel {...baseProps} outreachTarget={target} />)
    expect(screen.getByText(/Use LinkedIn/)).toBeInTheDocument()
  })

  it('shows email input when Enter email button is clicked', () => {
    render(<EmailNotFoundPanel {...baseProps} />)
    fireEvent.click(screen.getByText(/Enter email/))
    expect(screen.getByPlaceholderText('hiring@company.com')).toBeInTheDocument()
  })

  it('calls overrideEmail and onUpdate when a valid email is saved', async () => {
    const { overrideEmail } = await import('@/lib/api')
    render(<EmailNotFoundPanel {...baseProps} />)
    fireEvent.click(screen.getByText(/Enter email/))
    fireEvent.change(screen.getByPlaceholderText('hiring@company.com'), {
      target: { value: 'test@acme.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => expect(overrideEmail).toHaveBeenCalledWith('c1', 'cand1', 'test@acme.com'))
    expect(baseProps.onUpdate).toHaveBeenCalled()
  })

  it('calls cancelCadence and onUpdate when Skip is clicked', async () => {
    const { cancelCadence } = await import('@/lib/api')
    render(<EmailNotFoundPanel {...baseProps} />)
    fireEvent.click(screen.getByText(/Skip/))
    await waitFor(() => expect(cancelCadence).toHaveBeenCalledWith('c1', 'cand1'))
    expect(baseProps.onUpdate).toHaveBeenCalled()
  })

  it('calls startEmailOutreach and onUpdate when Retry is clicked', async () => {
    const { startEmailOutreach } = await import('@/lib/api')
    render(<EmailNotFoundPanel {...baseProps} />)
    fireEvent.click(screen.getByText('Retry (0/2)'))
    await waitFor(() => expect(startEmailOutreach).toHaveBeenCalledWith('j1', 'cand1'))
    expect(baseProps.onUpdate).toHaveBeenCalled()
  })

  it('shows Max retries reached when retry returns 429', async () => {
    const { startEmailOutreach } = await import('@/lib/api')
    ;(startEmailOutreach as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('429: Max retries reached'))
    render(<EmailNotFoundPanel {...baseProps} />)
    fireEvent.click(screen.getByText('Retry (0/2)'))
    await waitFor(() => expect(screen.getByText('Max retries reached')).toBeInTheDocument())
  })
})
```

- [ ] **Step 2: Run tests — expect failure**

```bash
npx vitest run src/__tests__/components/EmailNotFoundPanel.test.tsx
```

Expected: FAIL — `EmailNotFoundPanel` not found.

- [ ] **Step 3: Create the component**

Create `src/components/pipeline/EmailNotFoundPanel.tsx`:

```typescript
'use client'

import { useState } from 'react'
import { Mail, Linkedin, X, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { overrideEmail, cancelCadence, startEmailOutreach } from '@/lib/api'
import type { EmailCadenceSummary, OutreachTargetSummary } from '@/types/candidate'

interface Props {
  jobId: string
  candidateId: string
  cadence: EmailCadenceSummary
  company: string
  outreachTarget: OutreachTargetSummary | null
  onUpdate: () => void
}

export function EmailNotFoundPanel({ jobId, candidateId, cadence, company, outreachTarget, onUpdate }: Props) {
  const [showInput, setShowInput]     = useState(false)
  const [emailValue, setEmailValue]   = useState('')
  const [saving, setSaving]           = useState(false)
  const [cancelling, setCancelling]   = useState(false)
  const [retrying, setRetrying]       = useState(false)
  const [retryCount, setRetryCount]   = useState(cadence.retryCount ?? 0)
  const [retryMaxed, setRetryMaxed]   = useState((cadence.retryCount ?? 0) >= 2)
  const [error, setError]             = useState<string | null>(null)

  const isLowConfidence = cadence.status === 'low_confidence'
  const message = isLowConfidence
    ? `Email found but could not be verified for ${company}`
    : `No email found for ${company}`

  const emailValid = emailValue.includes('@') && emailValue.includes('.')

  async function handleSave() {
    if (!emailValid) return
    setSaving(true)
    setError(null)
    try {
      await overrideEmail(cadence.id, candidateId, emailValue)
      onUpdate()
    } catch {
      setError('Failed to save — please try again')
    } finally {
      setSaving(false)
    }
  }

  async function handleSkip() {
    setCancelling(true)
    try {
      await cancelCadence(cadence.id, candidateId)
      onUpdate()
    } finally {
      setCancelling(false)
    }
  }

  async function handleRetry() {
    setRetrying(true)
    setError(null)
    try {
      await startEmailOutreach(jobId, candidateId)
      onUpdate()
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('429')) {
        setRetryMaxed(true)
      } else {
        setError('Retry failed — please try again')
      }
    } finally {
      setRetrying(false)
    }
  }

  return (
    <div className="mt-1 space-y-2">
      <p className="text-[11px] text-[#64748b]">{message}</p>

      {!showInput ? (
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            size="sm"
            variant="outline"
            className="h-6 text-[10px] border-blue-700/40 text-blue-400 hover:bg-blue-950/30 gap-1"
            onClick={() => setShowInput(true)}
          >
            <Mail className="w-3 h-3" />
            Enter email
          </Button>

          {outreachTarget?.linkedinUrl && (
            <Button
              size="sm"
              variant="outline"
              className="h-6 text-[10px] border-[#1e3a5f] text-[#94a3b8] hover:bg-[#1e3a5f] gap-1"
              asChild
            >
              <a href={outreachTarget.linkedinUrl} target="_blank" rel="noopener noreferrer">
                <Linkedin className="w-3 h-3" />
                Use LinkedIn
              </a>
            </Button>
          )}

          <Button
            size="sm"
            variant="ghost"
            className="h-6 text-[10px] text-[#475569] hover:text-[#94a3b8] gap-1"
            onClick={handleSkip}
            isLoading={cancelling}
          >
            <X className="w-3 h-3" />
            Skip
          </Button>

          <Button
            size="sm"
            variant="ghost"
            className="h-6 text-[10px] text-[#334155] hover:text-[#64748b] gap-1 ml-auto"
            onClick={handleRetry}
            disabled={retryMaxed || retrying}
            isLoading={retrying}
          >
            <RotateCcw className="w-3 h-3" />
            {retryMaxed ? 'Max retries reached' : `Retry (${retryCount}/2)`}
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Input
            autoFocus
            value={emailValue}
            onChange={e => setEmailValue(e.target.value)}
            placeholder="hiring@company.com"
            className="h-7 text-[11px] bg-[#060d1f] border-[#2d4a6e] text-[#f1f5f9] flex-1"
            onKeyDown={e => {
              if (e.key === 'Enter') void handleSave()
              if (e.key === 'Escape') { setShowInput(false); setEmailValue('') }
            }}
          />
          <Button
            size="sm"
            className="h-7 text-[10px] bg-blue-600 hover:bg-blue-700 text-white shrink-0"
            onClick={handleSave}
            disabled={!emailValid || saving}
            isLoading={saving}
          >
            Save
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-[10px] text-[#475569] shrink-0"
            onClick={() => { setShowInput(false); setEmailValue('') }}
          >
            Cancel
          </Button>
        </div>
      )}

      {error && <p className="text-[10px] text-red-400">{error}</p>}
    </div>
  )
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
npx vitest run src/__tests__/components/EmailNotFoundPanel.test.tsx
```

Expected: all 11 tests PASS.

- [ ] **Step 5: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/components/pipeline/EmailNotFoundPanel.tsx src/__tests__/components/EmailNotFoundPanel.test.tsx
git commit -m "feat: EmailNotFoundPanel component with enter email / LinkedIn / skip / retry actions"
```

---

### Task 8: Wire `EmailNotFoundPanel` into `JobReviewCard`

**Files:**
- Modify: `src/components/pipeline/JobReviewCard.tsx`

- [ ] **Step 1: Add `onUpdate` prop and import `EmailNotFoundPanel`**

At the top of `src/components/pipeline/JobReviewCard.tsx`, add the import:

```typescript
import { EmailNotFoundPanel } from './EmailNotFoundPanel'
```

Find the `JobReviewCardProps` interface and add `onUpdate`:

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
}
```

Update the function signature to destructure `onUpdate`:

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
}: JobReviewCardProps) {
```

- [ ] **Step 2: Replace the email section to use `EmailNotFoundPanel`**

Find this block near the bottom of the JSX (the F6 email cadence section):

```tsx
{/* F6 Email cadence status */}
{emailCadence && job.status === 'approved' && (
  <div
    className="mt-2 flex items-center gap-2"
    data-testid="email-outreach-section"
  >
    <span className="text-[9px] font-semibold text-[#334155] tracking-widest uppercase shrink-0">
      Email
    </span>
    <EmailCadenceStatusBadge status={emailCadence.status} />
  </div>
)}
```

Replace with:

```tsx
{/* F6 Email cadence status */}
{emailCadence && job.status === 'approved' && (
  <div
    className="mt-2"
    data-testid="email-outreach-section"
  >
    {(emailCadence.status === 'email_not_found' || emailCadence.status === 'low_confidence') ? (
      <EmailNotFoundPanel
        jobId={job.id}
        candidateId={candidateId}
        cadence={emailCadence}
        company={job.company ?? ''}
        outreachTarget={outreachTarget ?? null}
        onUpdate={onUpdate}
      />
    ) : (
      <div className="flex items-center gap-2">
        <span className="text-[9px] font-semibold text-[#334155] tracking-widest uppercase shrink-0">
          Email
        </span>
        <EmailCadenceStatusBadge status={emailCadence.status} />
      </div>
    )}
  </div>
)}
```

- [ ] **Step 3: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no output. If there is a TS error about `onUpdate` missing in callers, that's expected and will be fixed in Task 9.

- [ ] **Step 4: Commit**

```bash
git add src/components/pipeline/JobReviewCard.tsx
git commit -m "feat: swap EmailCadenceStatusBadge for EmailNotFoundPanel on failure statuses"
```

---

### Task 9: Pass `onUpdate` from Pipeline page and fix `JobCard` 429 handling

**Files:**
- Modify: `src/app/candidates/[id]/pipeline/page.tsx`
- Modify: `src/components/applications/JobCard.tsx`

- [ ] **Step 1: Pass `onUpdate` in the Pipeline page**

In `src/app/candidates/[id]/pipeline/page.tsx`, find each `<JobReviewCard ... />` usage and add `onUpdate`:

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
/>
```

- [ ] **Step 2: Handle 429 in `JobCard.tsx` (Applications page)**

In `src/components/applications/JobCard.tsx`, find both `startEmailOutreach` call sites in the retry button handler. Each looks like:

```tsx
onClick={async () => {
  setEmStarting(true)
  try {
    await startEmailOutreach(job.id, candidateId)
    setEmailCadence({ id: '', status: 'pending_discovery', hiringManagerEmail: null,
      emailConfidence: null, approvedAt: null, replyDetectedAt: null, bounceDetectedAt: null, drafts: [] })
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('409')) {
```

Add a `429` handler after the `409` handler in both call sites:

```tsx
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('409')) {
      try {
        const body = JSON.parse(e.message.replace(/^\d+:\s*/, ''))
        if (body.currentStatus && emailCadence) {
          setEmailCadence({ ...emailCadence, status: body.currentStatus as EmailCadenceStatus })
        }
      } catch { /* ignore JSON parse failure */ }
    } else if (e instanceof Error && e.message.startsWith('429')) {
      // Retry cap hit — update local cadence state so the retry button disables
      if (emailCadence) {
        setEmailCadence({ ...emailCadence, retryCount: 2 })
      }
    }
  } finally { setEmStarting(false) }
```

Note: `EmailCadenceSummary` now has `retryCount`, so `{ ...emailCadence, retryCount: 2 }` is valid.

- [ ] **Step 3: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no output.

- [ ] **Step 4: Run full test suite**

```bash
npm run test:run
```

Expected: 0 failures.

- [ ] **Step 5: Commit**

```bash
git add src/app/candidates/[id]/pipeline/page.tsx src/components/applications/JobCard.tsx
git commit -m "feat: wire onUpdate to JobReviewCard; handle 429 in JobCard"
```

---

### Task 10: Verification

- [ ] **Step 1: Full TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no output.

- [ ] **Step 2: Full test run**

```bash
npm run test:run
```

Expected: 0 failures.

- [ ] **Step 3: Production build**

```bash
npm run build
```

Expected: exits 0, no prerender errors.

- [ ] **Step 4: Smoke test the happy path**

1. Start the dev server: `npm run dev`
2. Start the daemon: `cd agent && poetry run python -m agent.daemon`
3. On the Pipeline page, approve a job for a company with poor Hunter.io coverage
4. Wait for the `outreach_mailer` job to run
5. Verify the Pipeline page shows "No email found for [Company]" with the 3-button strip (not just a badge)
6. Click **Enter email**, type a valid address, click **Save**
7. Verify the card updates to show "Review & Approve" badge (status = `pending_approval`)
8. Click **Retry (0/2)** — verify it increments to `Retry (1/2)` after reload
9. Click **Retry (1/2)** — verify it shows `Max retries reached` after reload

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: email discovery failure UX — panel, retry cap, optimistic generation"
```
