# Email Outreach Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Manual/Agentic toggle for email outreach so candidates can choose whether Proxim sends emails automatically via Gmail API or generates drafts they send themselves.

**Architecture:** The mode is stored in `candidates.preferences.email_outreach_mode` (JSONB, no migration). The daemon checks this before auto-sending. The `EmailOutreachPanel` renders two completely different UIs based on mode. Three new API routes handle manual-mode actions (start countdown, mark draft sent, cancel cadence).

**Tech Stack:** Next.js 15 App Router, Drizzle ORM, shadcn/ui, Tailwind v4, Vitest + @testing-library/react, Python asyncio daemon

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `src/types/candidate.ts` | Modify | Add `email_outreach_mode` to `Preferences` |
| `src/components/settings/EmailOutreachModeCard.tsx` | Create | Settings toggle UI |
| `src/app/candidates/[id]/settings/page.tsx` | Modify | Mount EmailOutreachModeCard |
| `src/app/candidates/[id]/applications/page.tsx` | Modify | Fetch preferences, pass mode to JobCard |
| `src/components/applications/JobCard.tsx` | Modify | Accept + pass `mode` prop to EmailOutreachPanel |
| `src/lib/api.ts` | Modify | Add `startCountdown`, `markDraftSent`, `cancelCadence` |
| `src/app/api/email-cadence/[cadenceId]/start-countdown/route.ts` | Create | POST: compute Day 3/7 due dates |
| `src/app/api/email-cadence/[cadenceId]/mark-sent/route.ts` | Create | POST: manually mark draft as sent |
| `src/app/api/email-cadence/[cadenceId]/cancel/route.ts` | Create | POST: cancel cadence + pending drafts |
| `src/components/pipeline/EmailOutreachPanel.tsx` | Modify | Dual rendering: manual vs agentic |
| `src/components/pipeline/ManualSendDraftCard.tsx` | Create | Per-draft card for manual mode with Gmail compose |
| `agent/agent/daemon.py` | Modify | Skip auto-send when mode = manual |
| `src/__tests__/api/email-cadence/start-countdown.test.ts` | Create | Route tests |
| `src/__tests__/api/email-cadence/mark-sent.test.ts` | Create | Route tests |
| `src/__tests__/api/email-cadence/cancel.test.ts` | Create | Route tests |

---

## Task 1: Add `email_outreach_mode` to Preferences type and `bodyText` to EmailDraftSummary

**Files:**
- Modify: `src/types/candidate.ts`

- [ ] Add `email_outreach_mode` to the `Preferences` interface and `bodyText` to `EmailDraftSummary` in `src/types/candidate.ts`:

```typescript
// In Preferences interface, add after gmail_token_expiry:
email_outreach_mode?: 'agentic' | 'manual'
```

```typescript
// In EmailDraftSummary interface, add bodyText field:
export interface EmailDraftSummary {
  id: string
  dayNumber: 1 | 3 | 7
  subject: string
  bodyHtml: string
  bodyText: string        // ← add this line
  originalBodyHtml: string
  isApproved: boolean
  status: EmailDraftStatus
  scheduledSendAt: string | null
  sentAt: string | null
  openDetectedAt: string | null
  clickDetectedAt: string | null
}
```

Also add a helper type export at the bottom of the file:

```typescript
export type EmailOutreachMode = 'agentic' | 'manual'
```

- [ ] Run TypeScript check — should pass with zero errors:
```bash
npx tsc --noEmit
```
Expected: no output (zero errors).

- [ ] Commit:
```bash
git add src/types/candidate.ts
git commit -m "feat: add email_outreach_mode to Preferences type"
```

---

## Task 2: Settings UI — EmailOutreachModeCard component

**Files:**
- Create: `src/components/settings/EmailOutreachModeCard.tsx`

- [ ] Write a failing component test at `src/__tests__/components/settings/EmailOutreachModeCard.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('@/lib/api', () => ({
  getPreferences: vi.fn(),
  updatePreferences: vi.fn(),
}))

import { getPreferences, updatePreferences } from '@/lib/api'
import { EmailOutreachModeCard } from '@/components/settings/EmailOutreachModeCard'

describe('EmailOutreachModeCard', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('shows Manual selected by default when no preference set', async () => {
    vi.mocked(getPreferences).mockResolvedValue({ preferences: {} })
    render(<EmailOutreachModeCard candidateId="cand-1" />)
    await waitFor(() => {
      const manualRadio = screen.getByTestId('mode-manual')
      expect((manualRadio as HTMLInputElement).checked).toBe(true)
    })
  })

  it('shows Agentic selected when preference is agentic', async () => {
    vi.mocked(getPreferences).mockResolvedValue({
      preferences: { email_outreach_mode: 'agentic' }
    })
    render(<EmailOutreachModeCard candidateId="cand-1" />)
    await waitFor(() => {
      const agenticRadio = screen.getByTestId('mode-agentic')
      expect((agenticRadio as HTMLInputElement).checked).toBe(true)
    })
  })

  it('calls updatePreferences with agentic on save', async () => {
    vi.mocked(getPreferences).mockResolvedValue({ preferences: {} })
    vi.mocked(updatePreferences).mockResolvedValue({ preferences: { email_outreach_mode: 'agentic' } })
    render(<EmailOutreachModeCard candidateId="cand-1" />)
    await waitFor(() => screen.getByTestId('mode-agentic'))
    fireEvent.click(screen.getByTestId('mode-agentic'))
    fireEvent.click(screen.getByTestId('save-mode-btn'))
    await waitFor(() => {
      expect(updatePreferences).toHaveBeenCalledWith(
        expect.objectContaining({ email_outreach_mode: 'agentic' }),
        'cand-1'
      )
    })
  })

  it('shows gmail-not-connected warning when selecting agentic without gmail', async () => {
    vi.mocked(getPreferences).mockResolvedValue({ preferences: {} })
    render(<EmailOutreachModeCard candidateId="cand-1" gmailConnected={false} />)
    await waitFor(() => screen.getByTestId('mode-agentic'))
    fireEvent.click(screen.getByTestId('mode-agentic'))
    expect(screen.getByTestId('gmail-not-connected-warning')).toBeDefined()
  })
})
```

- [ ] Run tests to confirm FAIL:
```bash
npx vitest run src/__tests__/components/settings/EmailOutreachModeCard.test.tsx
```
Expected: 4 failures (component doesn't exist yet).

- [ ] Create `src/components/settings/EmailOutreachModeCard.tsx`:

```typescript
'use client'

import { useEffect, useState } from 'react'
import { Mail, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getPreferences, updatePreferences } from '@/lib/api'
import type { EmailOutreachMode } from '@/types/candidate'

interface Props {
  candidateId: string
  gmailConnected?: boolean
}

export function EmailOutreachModeCard({ candidateId, gmailConnected = false }: Props) {
  const [mode, setMode]       = useState<EmailOutreachMode>('manual')
  const [saving, setSaving]   = useState(false)
  const [saved, setSaved]     = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getPreferences(candidateId).then(({ preferences }) => {
      setMode(preferences.email_outreach_mode ?? 'manual')
      setLoading(false)
    })
  }, [candidateId])

  async function handleSave() {
    setSaving(true)
    setSaved(false)
    try {
      await updatePreferences({ email_outreach_mode: mode }, candidateId)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } finally {
      setSaving(false)
    }
  }

  const agenticWarn = mode === 'agentic' && !gmailConnected

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Mail className="w-4 h-4 text-[#64748b]" />
        <p className="text-[9px] font-semibold text-[#334155] tracking-widest uppercase">
          Email Outreach
        </p>
      </div>

      {loading ? (
        <p className="text-xs text-[#475569]">Loading…</p>
      ) : (
        <div className="space-y-2">
          {/* Manual option */}
          <label className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-all ${
            mode === 'manual' ? 'border-blue-500 bg-blue-950/20' : 'border-[#1e2d4a] hover:border-[#2d4a6f]'
          }`}>
            <input
              type="radio"
              name="outreach-mode"
              value="manual"
              checked={mode === 'manual'}
              onChange={() => setMode('manual')}
              data-testid="mode-manual"
              className="mt-0.5 accent-blue-500"
            />
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-[#e2e8f0]">Manual</span>
                <span className="text-[9px] bg-emerald-900/40 text-emerald-400 border border-emerald-700/40 rounded px-1.5 py-0.5">
                  Recommended
                </span>
              </div>
              <p className="text-[10px] text-[#64748b] mt-0.5">
                Proxim generates drafts. You review and send from your own Gmail.
                No Gmail authorisation required.
              </p>
            </div>
          </label>

          {/* Agentic option */}
          <label className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-all ${
            mode === 'agentic' ? 'border-blue-500 bg-blue-950/20' : 'border-[#1e2d4a] hover:border-[#2d4a6f]'
          }`}>
            <input
              type="radio"
              name="outreach-mode"
              value="agentic"
              checked={mode === 'agentic'}
              onChange={() => setMode('agentic')}
              data-testid="mode-agentic"
              className="mt-0.5 accent-blue-500"
            />
            <div>
              <div className="flex items-center gap-2">
                <Zap className="w-3 h-3 text-amber-400" />
                <span className="text-xs font-medium text-[#e2e8f0]">Agentic</span>
              </div>
              <p className="text-[10px] text-[#64748b] mt-0.5">
                Proxim sends automatically via Gmail API.
                Requires Gmail authorisation in settings.
              </p>
            </div>
          </label>

          {agenticWarn && (
            <p
              className="text-[10px] text-amber-400 flex items-center gap-1"
              data-testid="gmail-not-connected-warning"
            >
              ⚠ Connect Gmail above before enabling agentic mode.
            </p>
          )}

          {mode === 'agentic' && gmailConnected && (
            <p className="text-[10px] text-[#475569]">
              Proxim will resume auto-sending any pending Day 3/7 emails.
            </p>
          )}

          <Button
            size="sm"
            onClick={handleSave}
            isLoading={saving}
            data-testid="save-mode-btn"
            className="text-xs"
          >
            {saved ? 'Saved ✓' : 'Save'}
          </Button>
        </div>
      )}
    </div>
  )
}
```

- [ ] Run tests — confirm PASS:
```bash
npx vitest run src/__tests__/components/settings/EmailOutreachModeCard.test.tsx
```
Expected: 4 passed.

- [ ] Commit:
```bash
git add src/components/settings/EmailOutreachModeCard.tsx src/__tests__/components/settings/EmailOutreachModeCard.test.tsx
git commit -m "feat: EmailOutreachModeCard settings component"
```

---

## Task 3: Mount EmailOutreachModeCard in Settings page

**Files:**
- Modify: `src/app/candidates/[id]/settings/page.tsx`

- [ ] Add import and mount the card. In `src/app/candidates/[id]/settings/page.tsx`, add the import:

```typescript
import { EmailOutreachModeCard } from '@/components/settings/EmailOutreachModeCard'
```

- [ ] Find the section where `LinkedInConnectCard` is rendered (around line 134) and add `EmailOutreachModeCard` directly below it:

```typescript
<LinkedInConnectCard candidateId={candidateId} flash={linkedinFlash} />

{/* Email Outreach mode toggle — below LinkedIn */}
<div className="mt-6 pt-6 border-t border-[#1e2d4a]">
  <EmailOutreachModeCard
    candidateId={candidateId}
    gmailConnected={!!candidate?.preferences?.gmail_access_token}
  />
</div>
```

- [ ] Run TypeScript check:
```bash
npx tsc --noEmit
```
Expected: no output.

- [ ] Run full test suite:
```bash
npm run test:run
```
Expected: all tests pass.

- [ ] Commit:
```bash
git add src/app/candidates/[id]/settings/page.tsx
git commit -m "feat: mount EmailOutreachModeCard in Settings page"
```

---

## Task 4: Three new API routes — start-countdown, mark-sent, cancel

**Files:**
- Create: `src/app/api/email-cadence/[cadenceId]/start-countdown/route.ts`
- Create: `src/app/api/email-cadence/[cadenceId]/mark-sent/route.ts`
- Create: `src/app/api/email-cadence/[cadenceId]/cancel/route.ts`
- Create: `src/__tests__/api/email-cadence/start-countdown.test.ts`
- Create: `src/__tests__/api/email-cadence/mark-sent.test.ts`
- Create: `src/__tests__/api/email-cadence/cancel.test.ts`

- [ ] Write failing tests for all three routes.

`src/__tests__/api/email-cadence/start-countdown.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/db', () => ({ db: { select: vi.fn(), update: vi.fn() } }))
vi.mock('@/db/schema', () => ({
  emailCadences: { id: 'id', candidateId: 'candidateId', status: 'status' },
  emailDrafts: { id: 'id', cadenceId: 'cadenceId', dayNumber: 'dayNumber', status: 'status', scheduledSendAt: 'scheduledSendAt' },
}))

describe('POST /api/email-cadence/[cadenceId]/start-countdown', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules() })

  it('returns 200 with day3Due and day7Due', async () => {
    const { db } = await import('@/db')
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([{ id: 'cad-1', candidateId: 'cand-1', status: 'approved' }]),
    } as never)
    vi.mocked(db.update).mockReturnValue({
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
    } as never)

    const { POST } = await import('@/app/api/email-cadence/[cadenceId]/start-countdown/route')
    const req = new Request('http://localhost/api/email-cadence/cad-1/start-countdown?candidateId=cand-1', { method: 'POST' })
    const res = await POST(req, { params: Promise.resolve({ cadenceId: 'cad-1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('day3Due')
    expect(body).toHaveProperty('day7Due')
  })

  it('returns 422 when cadence not in approved state', async () => {
    const { db } = await import('@/db')
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([{ id: 'cad-1', candidateId: 'cand-1', status: 'pending_approval' }]),
    } as never)
    const { POST } = await import('@/app/api/email-cadence/[cadenceId]/start-countdown/route')
    const req = new Request('http://localhost/api/email-cadence/cad-1/start-countdown?candidateId=cand-1', { method: 'POST' })
    const res = await POST(req, { params: Promise.resolve({ cadenceId: 'cad-1' }) })
    expect(res.status).toBe(422)
  })

  it('returns 404 when cadence not found', async () => {
    const { db } = await import('@/db')
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
    } as never)
    const { POST } = await import('@/app/api/email-cadence/[cadenceId]/start-countdown/route')
    const req = new Request('http://localhost/api/email-cadence/unknown/start-countdown?candidateId=cand-1', { method: 'POST' })
    const res = await POST(req, { params: Promise.resolve({ cadenceId: 'unknown' }) })
    expect(res.status).toBe(404)
  })
})
```

`src/__tests__/api/email-cadence/mark-sent.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/db', () => ({ db: { select: vi.fn(), update: vi.fn() } }))
vi.mock('@/db/schema', () => ({
  emailDrafts: { id: 'id', cadenceId: 'cadenceId', dayNumber: 'dayNumber', status: 'status', sentAt: 'sentAt' },
  emailCadences: { id: 'id', candidateId: 'candidateId' },
}))

describe('POST /api/email-cadence/[cadenceId]/mark-sent', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules() })

  it('returns 200 with manually_sent status', async () => {
    const { db } = await import('@/db')
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([{ id: 'draft-1', cadenceId: 'cad-1', dayNumber: 1, status: 'approved' }]),
    } as never)
    vi.mocked(db.update).mockReturnValue({
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([{ id: 'draft-1', status: 'manually_sent', sentAt: new Date().toISOString() }]),
    } as never)

    const { POST } = await import('@/app/api/email-cadence/[cadenceId]/mark-sent/route')
    const req = new Request('http://localhost/api/email-cadence/cad-1/mark-sent?candidateId=cand-1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ draftId: 'draft-1' }),
    })
    const res = await POST(req, { params: Promise.resolve({ cadenceId: 'cad-1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('manually_sent')
  })

  it('returns 409 when draft already sent', async () => {
    const { db } = await import('@/db')
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([{ id: 'draft-1', cadenceId: 'cad-1', dayNumber: 1, status: 'sent' }]),
    } as never)
    const { POST } = await import('@/app/api/email-cadence/[cadenceId]/mark-sent/route')
    const req = new Request('http://localhost/api/email-cadence/cad-1/mark-sent?candidateId=cand-1', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ draftId: 'draft-1' }),
    })
    const res = await POST(req, { params: Promise.resolve({ cadenceId: 'cad-1' }) })
    expect(res.status).toBe(409)
  })
})
```

`src/__tests__/api/email-cadence/cancel.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/db', () => ({ db: { select: vi.fn(), update: vi.fn() } }))
vi.mock('@/db/schema', () => ({
  emailCadences: { id: 'id', candidateId: 'candidateId', status: 'status' },
  emailDrafts: { id: 'id', cadenceId: 'cadenceId', status: 'status' },
}))

describe('POST /api/email-cadence/[cadenceId]/cancel', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules() })

  it('returns 200 with cancelled status', async () => {
    const { db } = await import('@/db')
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([{ id: 'cad-1', candidateId: 'cand-1', status: 'active' }]),
    } as never)
    vi.mocked(db.update).mockReturnValue({
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
    } as never)
    const { POST } = await import('@/app/api/email-cadence/[cadenceId]/cancel/route')
    const req = new Request('http://localhost/api/email-cadence/cad-1/cancel?candidateId=cand-1', { method: 'POST' })
    const res = await POST(req, { params: Promise.resolve({ cadenceId: 'cad-1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('cancelled')
  })

  it('returns 409 when cadence already terminal', async () => {
    const { db } = await import('@/db')
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([{ id: 'cad-1', candidateId: 'cand-1', status: 'cancelled' }]),
    } as never)
    const { POST } = await import('@/app/api/email-cadence/[cadenceId]/cancel/route')
    const req = new Request('http://localhost/api/email-cadence/cad-1/cancel?candidateId=cand-1', { method: 'POST' })
    const res = await POST(req, { params: Promise.resolve({ cadenceId: 'cad-1' }) })
    expect(res.status).toBe(409)
  })
})
```

- [ ] Run to confirm all 7 tests FAIL:
```bash
npx vitest run src/__tests__/api/email-cadence/start-countdown.test.ts src/__tests__/api/email-cadence/mark-sent.test.ts src/__tests__/api/email-cadence/cancel.test.ts
```
Expected: 7 failures.

- [ ] Create `src/app/api/email-cadence/[cadenceId]/start-countdown/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { eq, and, inArray } from 'drizzle-orm'
import { db } from '@/db'
import { emailCadences, emailDrafts } from '@/db/schema'

const TERMINAL = ['replied', 'bounced', 'cancelled', 'cadence_complete', 'failed']

export async function POST(
  request: Request,
  { params }: { params: Promise<{ cadenceId: string }> }
) {
  try {
    const { cadenceId } = await params
    const url = new URL(request.url)
    const candidateId = url.searchParams.get('candidateId')
    if (!candidateId) return NextResponse.json({ error: 'candidateId required' }, { status: 400 })

    const [cadence] = await db.select().from(emailCadences)
      .where(and(eq(emailCadences.id, cadenceId), eq(emailCadences.candidateId, candidateId)))
    if (!cadence) return NextResponse.json({ error: 'Cadence not found' }, { status: 404 })
    if (cadence.status !== 'approved')
      return NextResponse.json({ error: "Cadence must be in 'approved' status" }, { status: 422 })

    const now = new Date()
    const day3Due = new Date(now.getTime() + 72 * 60 * 60 * 1000)
    const day7Due = new Date(now.getTime() + 168 * 60 * 60 * 1000)

    // Schedule Day 3 and Day 7
    await db.update(emailDrafts)
      .set({ status: 'approved', scheduledSendAt: day3Due })
      .where(and(eq(emailDrafts.cadenceId, cadenceId), eq(emailDrafts.dayNumber, 3)))

    await db.update(emailDrafts)
      .set({ status: 'approved', scheduledSendAt: day7Due })
      .where(and(eq(emailDrafts.cadenceId, cadenceId), eq(emailDrafts.dayNumber, 7)))

    // Advance cadence to active
    await db.update(emailCadences)
      .set({ status: 'active', updatedAt: now })
      .where(eq(emailCadences.id, cadenceId))

    return NextResponse.json({
      cadenceId,
      status: 'active',
      day3Due: day3Due.toISOString(),
      day7Due: day7Due.toISOString(),
    })
  } catch (e) {
    console.error('[start-countdown] error:', e)
    return NextResponse.json({ error: 'Failed to start countdown' }, { status: 500 })
  }
}
```

- [ ] Create `src/app/api/email-cadence/[cadenceId]/mark-sent/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { eq, and, inArray } from 'drizzle-orm'
import { db } from '@/db'
import { emailDrafts, emailCadences } from '@/db/schema'

const ALREADY_SENT = ['sent', 'manually_sent']

export async function POST(
  request: Request,
  { params }: { params: Promise<{ cadenceId: string }> }
) {
  try {
    const { cadenceId } = await params
    const url = new URL(request.url)
    const candidateId = url.searchParams.get('candidateId')
    if (!candidateId) return NextResponse.json({ error: 'candidateId required' }, { status: 400 })

    const { draftId } = await request.json()
    if (!draftId) return NextResponse.json({ error: 'draftId required' }, { status: 400 })

    const [draft] = await db.select().from(emailDrafts)
      .where(and(eq(emailDrafts.id, draftId), eq(emailDrafts.cadenceId, cadenceId)))
    if (!draft) return NextResponse.json({ error: 'Draft not found' }, { status: 404 })
    if (ALREADY_SENT.includes(draft.status))
      return NextResponse.json({ error: 'Draft already sent', currentStatus: draft.status }, { status: 409 })

    const now = new Date()
    const [updated] = await db.update(emailDrafts)
      .set({ status: 'manually_sent', sentAt: now, updatedAt: now })
      .where(eq(emailDrafts.id, draftId))
      .returning()

    return NextResponse.json({
      draftId: updated.id,
      dayNumber: updated.dayNumber,
      status: 'manually_sent',
      sentAt: now.toISOString(),
    })
  } catch (e) {
    console.error('[mark-sent] error:', e)
    return NextResponse.json({ error: 'Failed to mark draft as sent' }, { status: 500 })
  }
}
```

- [ ] Create `src/app/api/email-cadence/[cadenceId]/cancel/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { eq, and, inArray } from 'drizzle-orm'
import { db } from '@/db'
import { emailCadences, emailDrafts } from '@/db/schema'

const TERMINAL = ['replied', 'bounced', 'cancelled', 'cadence_complete', 'failed']
const CANCELLABLE_DRAFTS = ['draft', 'approved', 'scheduled']

export async function POST(
  request: Request,
  { params }: { params: Promise<{ cadenceId: string }> }
) {
  try {
    const { cadenceId } = await params
    const url = new URL(request.url)
    const candidateId = url.searchParams.get('candidateId')
    if (!candidateId) return NextResponse.json({ error: 'candidateId required' }, { status: 400 })

    const [cadence] = await db.select().from(emailCadences)
      .where(and(eq(emailCadences.id, cadenceId), eq(emailCadences.candidateId, candidateId)))
    if (!cadence) return NextResponse.json({ error: 'Cadence not found' }, { status: 404 })
    if (TERMINAL.includes(cadence.status))
      return NextResponse.json({ error: 'Cadence already in terminal state', currentStatus: cadence.status }, { status: 409 })

    const now = new Date()
    await db.update(emailDrafts)
      .set({ status: 'cancelled', updatedAt: now })
      .where(and(eq(emailDrafts.cadenceId, cadenceId), inArray(emailDrafts.status, CANCELLABLE_DRAFTS)))

    await db.update(emailCadences)
      .set({ status: 'cancelled', updatedAt: now })
      .where(eq(emailCadences.id, cadenceId))

    return NextResponse.json({ cadenceId, status: 'cancelled' })
  } catch (e) {
    console.error('[cancel] error:', e)
    return NextResponse.json({ error: 'Failed to cancel cadence' }, { status: 500 })
  }
}
```

- [ ] Run tests — confirm all 7 PASS:
```bash
npx vitest run src/__tests__/api/email-cadence/start-countdown.test.ts src/__tests__/api/email-cadence/mark-sent.test.ts src/__tests__/api/email-cadence/cancel.test.ts
```
Expected: 7 passed.

- [ ] Commit:
```bash
git add src/app/api/email-cadence/[cadenceId]/start-countdown/ src/app/api/email-cadence/[cadenceId]/mark-sent/ src/app/api/email-cadence/[cadenceId]/cancel/ src/__tests__/api/email-cadence/start-countdown.test.ts src/__tests__/api/email-cadence/mark-sent.test.ts src/__tests__/api/email-cadence/cancel.test.ts
git commit -m "feat: add start-countdown, mark-sent, cancel email cadence routes"
```

---

## Task 5: API client functions

**Files:**
- Modify: `src/lib/api.ts`

- [ ] Add three new functions to `src/lib/api.ts` in the Outreach Mailer (F6) section:

```typescript
export async function startCountdown(
  cadenceId: string,
  candidateId: string,
): Promise<{ cadenceId: string; status: string; day3Due: string; day7Due: string }> {
  return request(`/api/email-cadence/${cadenceId}/start-countdown${qs(candidateId)}`, { method: 'POST' })
}

export async function markDraftSent(
  cadenceId: string,
  draftId: string,
  candidateId: string,
): Promise<{ draftId: string; dayNumber: number; status: string; sentAt: string }> {
  return request(`/api/email-cadence/${cadenceId}/mark-sent${qs(candidateId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ draftId }),
  })
}

export async function cancelCadence(
  cadenceId: string,
  candidateId: string,
): Promise<{ cadenceId: string; status: string }> {
  return request(`/api/email-cadence/${cadenceId}/cancel${qs(candidateId)}`, { method: 'POST' })
}
```

- [ ] Run TypeScript check and full tests:
```bash
npx tsc --noEmit && npm run test:run
```
Expected: 0 errors, all tests pass.

- [ ] Commit:
```bash
git add src/lib/api.ts
git commit -m "feat: add startCountdown, markDraftSent, cancelCadence API client functions"
```

---

## Task 6: ManualSendDraftCard component

**Files:**
- Create: `src/components/pipeline/ManualSendDraftCard.tsx`

This component replaces `EmailDraftCard` in manual mode. It shows the draft body, an "Open in Gmail →" button, and (after Gmail is opened) a "Mark as Sent" button.

- [ ] Create `src/components/pipeline/ManualSendDraftCard.tsx`:

```typescript
'use client'

import { useState } from 'react'
import { ExternalLink, CheckCircle2, Clock, AlertTriangle } from 'lucide-react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { markDraftSent } from '@/lib/api'
import type { EmailDraftSummary, EmailDraftStatus } from '@/types/candidate'

const DAY_LABELS: Record<number, string> = { 1: 'Day 1', 3: 'Day 3', 7: 'Day 7' }
const DAY_SUBLABELS: Record<number, string> = { 1: 'Intro', 3: 'Value add', 7: 'Gentle close' }

interface Props {
  draft: EmailDraftSummary
  cadenceId: string
  candidateId: string
  hiringManagerEmail: string
  scheduledAt?: string | null   // for Day 3/7 due-date display
  onDraftSent: (draftId: string) => void
}

function formatDue(iso: string): { label: string; overdue: boolean } {
  const due = new Date(iso)
  const now = new Date()
  const diffMs = due.getTime() - now.getTime()
  const diffH = Math.floor(diffMs / 3600000)
  if (diffMs < 0) return { label: `Overdue — was due ${due.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })}`, overdue: true }
  if (diffH < 24) return { label: `Due in ${diffH}h`, overdue: false }
  const diffD = Math.floor(diffH / 24)
  const remH = diffH % 24
  return { label: `Due in ${diffD}d ${remH}h`, overdue: false }
}

function buildGmailUrl(to: string, subject: string, bodyText: string): string {
  return `https://mail.google.com/mail/?view=cm&to=${encodeURIComponent(to)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyText)}`
}

export function ManualSendDraftCard({
  draft, cadenceId, candidateId, hiringManagerEmail, scheduledAt, onDraftSent,
}: Props) {
  const [gmailOpened, setGmailOpened] = useState(false)
  const [marking, setMarking]         = useState(false)

  const isAlreadySent = draft.status === 'sent' || draft.status === 'manually_sent'
  const dueInfo = scheduledAt ? formatDue(scheduledAt) : null

  async function handleMarkSent() {
    setMarking(true)
    try {
      await markDraftSent(cadenceId, draft.id, candidateId)
      onDraftSent(draft.id)
    } finally {
      setMarking(false)
    }
  }

  function handleOpenGmail() {
    const url = buildGmailUrl(hiringManagerEmail, draft.subject, draft.bodyText ?? draft.bodyHtml.replace(/<[^>]+>/g, ''))
    window.open(url, '_blank', 'noopener,noreferrer')
    setGmailOpened(true)
  }

  if (isAlreadySent) {
    return (
      <Card className="border border-emerald-800/30 bg-emerald-950/10" data-testid={`manual-draft-day-${draft.dayNumber}`}>
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-xs font-medium text-emerald-400">
              {DAY_LABELS[draft.dayNumber]} — Sent
            </span>
            {draft.sentAt && (
              <span className="text-[10px] text-[#475569]">
                {new Date(draft.sentAt).toLocaleDateString('en-IN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
        </CardHeader>
      </Card>
    )
  }

  return (
    <Card className="border border-[#1e2d4a]" data-testid={`manual-draft-day-${draft.dayNumber}`}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold text-[#94a3b8]">
              {DAY_LABELS[draft.dayNumber]}
            </span>
            <span className="text-[9px] text-[#475569]">{DAY_SUBLABELS[draft.dayNumber]}</span>
          </div>
          {dueInfo && (
            <Badge className={`text-[10px] ${dueInfo.overdue ? 'bg-red-950/40 text-red-400 border-red-800/40' : 'bg-[#0d1829] text-[#64748b] border-[#1e2d4a]'}`}>
              {dueInfo.overdue ? <AlertTriangle className="w-2.5 h-2.5 mr-1" /> : <Clock className="w-2.5 h-2.5 mr-1" />}
              {dueInfo.label}
            </Badge>
          )}
        </div>
        <p className="text-[10px] text-[#475569] mt-0.5">{draft.subject}</p>
      </CardHeader>

      <CardContent className="space-y-2">
        <div
          className="text-xs text-[#94a3b8] prose prose-invert prose-sm max-w-none max-h-[120px] overflow-y-auto"
          dangerouslySetInnerHTML={{ __html: draft.bodyHtml }}
        />

        <Button
          size="sm"
          variant="outline"
          className="w-full text-xs border-blue-700/40 text-blue-400 hover:bg-blue-950/20 gap-1.5"
          onClick={handleOpenGmail}
          data-testid={`open-gmail-day-${draft.dayNumber}`}
        >
          <ExternalLink className="w-3 h-3" />
          Open in Gmail →
        </Button>

        {gmailOpened && (
          <Button
            size="sm"
            className="w-full text-xs bg-emerald-700 hover:bg-emerald-800 text-white gap-1.5"
            onClick={handleMarkSent}
            isLoading={marking}
            data-testid={`mark-sent-day-${draft.dayNumber}`}
          >
            <CheckCircle2 className="w-3 h-3" />
            Mark as Sent
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
```

- [ ] Run TypeScript check:
```bash
npx tsc --noEmit
```
Expected: no output.

- [ ] Commit:
```bash
git add src/components/pipeline/ManualSendDraftCard.tsx
git commit -m "feat: ManualSendDraftCard with Gmail compose URL and mark-as-sent"
```

---

## Task 7: EmailOutreachPanel — manual mode rendering

**Files:**
- Modify: `src/components/pipeline/EmailOutreachPanel.tsx`

The panel now accepts a `mode: 'manual' | 'agentic'` prop and renders differently for each.

- [ ] Replace the contents of `src/components/pipeline/EmailOutreachPanel.tsx` with:

```typescript
'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { approveCadence, overrideEmail, startCountdown, cancelCadence } from '@/lib/api'
import { EmailDraftCard } from './EmailDraftCard'
import { ManualSendDraftCard } from './ManualSendDraftCard'
import type { EmailCadenceSummary, EmailDraftSummary, EmailOutreachMode } from '@/types/candidate'

interface Props {
  cadence: EmailCadenceSummary
  candidateId: string
  mode?: EmailOutreachMode
  onCadenceUpdated: (c: EmailCadenceSummary) => void
}

const DAY_LABELS: Record<number, string> = { 1: 'Day 1', 3: 'Day 3', 7: 'Day 7' }
const DAY_SUBLABELS: Record<number, string> = { 1: 'Intro', 3: 'Value add', 7: 'Gentle close' }

export function EmailOutreachPanel({ cadence: initialCadence, candidateId, mode = 'manual', onCadenceUpdated }: Props) {
  const [cadence, setCadence]         = useState(initialCadence)
  const [drafts, setDrafts]           = useState<EmailDraftSummary[]>(initialCadence.drafts)
  const [activeTab, setActiveTab]     = useState('1')
  const [isApproving, setIsApproving] = useState(false)
  const [isOverriding, setIsOverriding] = useState(false)
  const [isCancelling, setIsCancelling] = useState(false)
  const [isStarting, setIsStarting]   = useState(false)
  const [day1GmailOpened, setDay1GmailOpened] = useState(false)

  function handleDraftUpdated(updated: EmailDraftSummary) {
    setDrafts(prev => prev.map(d => d.id === updated.id ? updated : d))
  }

  function handleDraftSent(draftId: string) {
    setDrafts(prev => prev.map(d => d.id === draftId ? { ...d, status: 'manually_sent' as const, sentAt: new Date().toISOString() } : d))
  }

  async function handleApprove() {
    setIsApproving(true)
    try {
      const result = await approveCadence(cadence.id, candidateId)
      const updated: EmailCadenceSummary = { ...cadence, status: result.status, approvedAt: result.approvedAt, drafts }
      setCadence(updated)
      onCadenceUpdated(updated)
    } finally { setIsApproving(false) }
  }

  async function handleManualApprove() {
    // In manual mode, "Approve Drafts" just calls the approve endpoint (which schedules Day 1 = now)
    // but the daemon won't auto-send because mode = 'manual'
    setIsApproving(true)
    try {
      const result = await approveCadence(cadence.id, candidateId)
      const updated: EmailCadenceSummary = { ...cadence, status: result.status, approvedAt: result.approvedAt, drafts }
      setCadence(updated)
      onCadenceUpdated(updated)
    } finally { setIsApproving(false) }
  }

  async function handleStartCountdown() {
    setIsStarting(true)
    try {
      const result = await startCountdown(cadence.id, candidateId)
      const updated: EmailCadenceSummary = { ...cadence, status: 'active', drafts }
      setCadence(updated)
      onCadenceUpdated(updated)
      // Update Day 3 and Day 7 scheduled times locally
      setDrafts(prev => prev.map(d => {
        if (d.dayNumber === 3) return { ...d, status: 'approved' as const, scheduledSendAt: result.day3Due }
        if (d.dayNumber === 7) return { ...d, status: 'approved' as const, scheduledSendAt: result.day7Due }
        return d
      }))
    } finally { setIsStarting(false) }
  }

  async function handleCancel() {
    setIsCancelling(true)
    try {
      const result = await cancelCadence(cadence.id, candidateId)
      const updated: EmailCadenceSummary = { ...cadence, status: result.status, drafts }
      setCadence(updated)
      onCadenceUpdated(updated)
    } finally { setIsCancelling(false) }
  }

  async function handleOverride() {
    if (!cadence.hiringManagerEmail) return
    setIsOverriding(true)
    try {
      const result = await overrideEmail(cadence.id, candidateId, cadence.hiringManagerEmail)
      const updated: EmailCadenceSummary = { ...cadence, status: result.status }
      setCadence(updated)
      onCadenceUpdated(updated)
    } finally { setIsOverriding(false) }
  }

  const showDraftTabs = (cadence.status === 'pending_approval' || cadence.status === 'approved' || cadence.status === 'active') && drafts.length > 0
  const isManual = mode === 'manual'

  function tabLabel(d: EmailDraftSummary): string {
    if (d.status === 'sent' || d.status === 'manually_sent') return `${DAY_LABELS[d.dayNumber]} ✓`
    if (d.scheduledSendAt && cadence.status === 'active') {
      const due = new Date(d.scheduledSendAt)
      const diffD = Math.ceil((due.getTime() - Date.now()) / 86400000)
      if (diffD < 0) return `${DAY_LABELS[d.dayNumber]} ⚠`
      return `${DAY_LABELS[d.dayNumber]} · ${diffD}d`
    }
    return DAY_LABELS[d.dayNumber]
  }

  return (
    <div data-testid="email-outreach-panel" className="space-y-3">
      <p className="text-[9px] font-semibold text-[#334155] tracking-widest uppercase">Email Outreach</p>

      {/* ── Draft tabs ── */}
      {showDraftTabs && (
        <>
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="w-full">
              {drafts.map(d => (
                <TabsTrigger key={d.id} value={String(d.dayNumber)} className="flex-1 flex-col gap-0 py-2">
                  <span className="text-[11px] font-semibold">{tabLabel(d)}</span>
                  <span className="text-[9px] opacity-60">{DAY_SUBLABELS[d.dayNumber]}</span>
                </TabsTrigger>
              ))}
            </TabsList>

            {drafts.map(d => (
              <TabsContent key={d.id} value={String(d.dayNumber)} forceMount
                className={String(d.dayNumber) !== activeTab ? 'hidden' : ''}>
                {isManual ? (
                  <ManualSendDraftCard
                    draft={d}
                    cadenceId={cadence.id}
                    candidateId={candidateId}
                    hiringManagerEmail={cadence.hiringManagerEmail ?? ''}
                    scheduledAt={d.scheduledSendAt}
                    onDraftSent={handleDraftSent}
                  />
                ) : (
                  <EmailDraftCard
                    draft={d}
                    cadenceId={cadence.id}
                    candidateId={candidateId}
                    onDraftUpdated={handleDraftUpdated}
                  />
                )}
              </TabsContent>
            ))}
          </Tabs>

          {/* Action buttons by mode + status */}
          {cadence.status === 'pending_approval' && !isManual && (
            <Button onClick={handleApprove} isLoading={isApproving}
              data-testid="approve-cadence-btn" className="w-full bg-blue-600 hover:bg-blue-700 text-white">
              Approve & Send Day 1 Now
            </Button>
          )}

          {cadence.status === 'pending_approval' && isManual && (
            <Button onClick={handleManualApprove} isLoading={isApproving}
              data-testid="approve-cadence-btn" className="w-full bg-blue-600 hover:bg-blue-700 text-white">
              Approve Drafts
            </Button>
          )}

          {cadence.status === 'approved' && isManual && (
            <div className="space-y-2">
              <p className="text-[10px] text-[#64748b]">
                Open Day 1 in Gmail, send it, then start the countdown for Day 3 and Day 7.
              </p>
              <Button
                onClick={handleStartCountdown}
                isLoading={isStarting}
                disabled={!day1GmailOpened}
                data-testid="start-countdown-btn"
                className="w-full text-xs"
                variant="outline"
              >
                Start Day 3/7 Countdown
              </Button>
              {!day1GmailOpened && (
                <p className="text-[10px] text-[#475569]">
                  Open Day 1 in Gmail first to enable this button.
                </p>
              )}
            </div>
          )}

          {cadence.status === 'active' && isManual && (
            <Button
              onClick={handleCancel}
              isLoading={isCancelling}
              data-testid="cancel-cadence-btn"
              variant="outline"
              size="sm"
              className="w-full text-xs border-red-800/40 text-red-400 hover:bg-red-950/20"
            >
              Stop cadence
            </Button>
          )}
        </>
      )}

      {/* ── Low confidence ── */}
      {cadence.status === 'low_confidence' && (
        <div data-testid="low-confidence-notice" className="space-y-2 rounded-md border border-orange-700/40 bg-orange-950/20 p-3">
          <p className="text-xs text-orange-300">
            Low confidence email: <span className="font-mono">{cadence.hiringManagerEmail}</span>
            {cadence.emailConfidence != null && (
              <Badge className="ml-2 bg-orange-100 text-orange-800 text-[10px]">{cadence.emailConfidence}% confidence</Badge>
            )}
          </p>
          <Button size="sm" variant="outline" onClick={handleOverride} isLoading={isOverriding} data-testid="override-email-btn">
            Send Anyway
          </Button>
        </div>
      )}

      {/* ── Terminal states ── */}
      {cadence.status === 'email_not_found' && (
        <p className="text-xs text-[#475569]">No email found for this company domain.</p>
      )}
      {cadence.status === 'replied' && (
        <Alert className="border-emerald-700/40 bg-emerald-950/20" data-testid="reply-received-banner">
          <AlertDescription className="text-emerald-300 text-xs">Reply received — cadence paused. Great work!</AlertDescription>
        </Alert>
      )}
      {cadence.status === 'bounced' && (
        <Alert className="border-red-700/40 bg-red-950/20" data-testid="bounce-cancelled-banner">
          <AlertDescription className="text-red-300 text-xs">Day 1 bounced — Day 3 and Day 7 cancelled.</AlertDescription>
        </Alert>
      )}
      {cadence.status === 'cancelled' && (
        <p className="text-xs text-[#475569]">Cadence cancelled.</p>
      )}
      {cadence.status === 'cadence_complete' && (
        <p className="text-xs text-[#475569]">Cadence complete — no reply received after 3 emails.</p>
      )}
      {cadence.status === 'auth_expired' && (
        <Alert className="border-orange-700/40 bg-orange-950/20" data-testid="auth-expired-banner">
          <AlertDescription className="text-orange-300 text-xs">Re-authorise Gmail to resume your email cadence.</AlertDescription>
        </Alert>
      )}
      {cadence.status === 'attachment_missing' && (
        <div data-testid="attachment-missing-notice" className="flex items-center gap-2 text-xs text-[#475569]">
          <Spinner className="size-3" />
          Awaiting resume PDF — Day 1 will send once available.
        </div>
      )}
    </div>
  )
}
```

Note: The `day1GmailOpened` state tracks whether the user clicked "Open in Gmail →" for Day 1. The `ManualSendDraftCard` for Day 1 needs to inform the panel when Gmail is opened. Wire this up by passing an `onGmailOpened` callback to `ManualSendDraftCard`:

- [ ] Update `ManualSendDraftCard` to accept and call `onGmailOpened?: () => void`:

In `src/components/pipeline/ManualSendDraftCard.tsx`, add to the Props interface:
```typescript
onGmailOpened?: () => void
```

In `handleOpenGmail`:
```typescript
function handleOpenGmail() {
  const url = buildGmailUrl(...)
  window.open(url, '_blank', 'noopener,noreferrer')
  setGmailOpened(true)
  onGmailOpened?.()   // ← add this line
}
```

- [ ] In `EmailOutreachPanel`, pass `onGmailOpened` to the Day 1 `ManualSendDraftCard`:

```typescript
{isManual ? (
  <ManualSendDraftCard
    draft={d}
    cadenceId={cadence.id}
    candidateId={candidateId}
    hiringManagerEmail={cadence.hiringManagerEmail ?? ''}
    scheduledAt={d.scheduledSendAt}
    onDraftSent={handleDraftSent}
    onGmailOpened={d.dayNumber === 1 ? () => setDay1GmailOpened(true) : undefined}
  />
) : (
```

- [ ] Run TypeScript check and tests:
```bash
npx tsc --noEmit && npm run test:run
```
Expected: 0 TypeScript errors, all tests pass.

- [ ] Commit:
```bash
git add src/components/pipeline/EmailOutreachPanel.tsx src/components/pipeline/ManualSendDraftCard.tsx
git commit -m "feat: dual-mode EmailOutreachPanel — manual Open-in-Gmail vs agentic auto-send"
```

---

## Task 8: Applications page — pass mode to JobCard

**Files:**
- Modify: `src/app/candidates/[id]/applications/page.tsx`
- Modify: `src/components/applications/JobCard.tsx`

- [ ] In `src/app/api/jobs/route.ts` and `src/app/api/candidates/[id]/jobs/route.ts`, add `bodyText` to the `EmailDraftSummary` objects built in the `draftsByC` loop. Find the section that maps `allDrafts` and add:

```typescript
list.push({
  id: d.id,
  dayNumber: d.dayNumber as 1 | 3 | 7,
  subject: d.subject,
  bodyHtml: d.bodyHtml,
  bodyText: d.bodyText,          // ← add this line to both route files
  originalBodyHtml: d.originalBodyHtml,
  ...
})
```

- [ ] In `src/app/candidates/[id]/applications/page.tsx`, add preferences fetch. Find the `loadJobs` function and add a parallel preferences fetch. First add the import:

```typescript
import { getJobs, markSubmitted, rejectJob, getResumeVersions, triggerResumeGeneration, getPreferences } from '@/lib/api'
import type { ScoredJob, ResumeVersion, EmailOutreachMode } from '@/lib/api'
```

Wait — `EmailOutreachMode` should be exported from `@/types/candidate`, not `@/lib/api`. Add the import:

```typescript
import type { EmailOutreachMode } from '@/types/candidate'
```

- [ ] Add state for mode in the Applications page component:
```typescript
const [emailOutreachMode, setEmailOutreachMode] = useState<EmailOutreachMode>('manual')
```

- [ ] Load it alongside jobs in the `useEffect` (or wherever `getJobs` is called). Find the call to `getJobs` and add a parallel preferences fetch:

```typescript
const [jobsResult, prefsResult] = await Promise.all([
  getJobs(candidateId, grades.length > 0 ? grades : [...ALL_GRADES]),
  getPreferences(candidateId),
])
setJobs(jobsResult.jobs)
setEmailOutreachMode(prefsResult.preferences.email_outreach_mode ?? 'manual')
```

- [ ] Pass `mode` to each `JobCard` in the render. Find the `<JobCard ...` rendering and add:
```typescript
<JobCard
  key={job.id}
  job={job}
  candidateId={candidateId}
  emailOutreachMode={emailOutreachMode}
  ...
/>
```

- [ ] In `src/components/applications/JobCard.tsx`, add the `emailOutreachMode` prop:

Add to the `Props` interface:
```typescript
emailOutreachMode?: EmailOutreachMode
```

Add to the destructuring:
```typescript
emailOutreachMode = 'manual',
```

Add the import:
```typescript
import type { EmailOutreachMode } from '@/types/candidate'
```

Pass it to `EmailOutreachPanel`:
```typescript
<EmailOutreachPanel
  cadence={emailCadence}
  candidateId={candidateId}
  mode={emailOutreachMode}
  onCadenceUpdated={setEmailCadence}
/>
```

- [ ] Run TypeScript check and full tests:
```bash
npx tsc --noEmit && npm run test:run
```
Expected: 0 errors, all tests pass.

- [ ] Commit:
```bash
git add src/app/candidates/[id]/applications/page.tsx src/components/applications/JobCard.tsx
git commit -m "feat: pass email_outreach_mode from preferences to EmailOutreachPanel"
```

---

## Task 9: Daemon — mode guard in `_outreach_send_once`

**Files:**
- Modify: `agent/agent/daemon.py`

- [ ] In `agent/agent/daemon.py`, find `_outreach_send_once`. After the line that loads `prefs` (around line 556):

```python
prefs = await _db.get_candidate_preferences(pool, candidate_id)
access_token = prefs.get("gmail_access_token", "") if prefs else ""
refresh_token = prefs.get("gmail_refresh_token", "") if prefs else ""
```

Add the mode guard immediately after loading `prefs`:

```python
prefs = await _db.get_candidate_preferences(pool, candidate_id)

# Skip auto-send if candidate is using manual mode
email_mode = (prefs or {}).get("email_outreach_mode", "manual")
if email_mode == "manual":
    logger.debug("outreach.manual_mode_skip", draft_id=draft_id, candidate_id=candidate_id)
    continue

access_token = prefs.get("gmail_access_token", "") if prefs else ""
refresh_token = prefs.get("gmail_refresh_token", "") if prefs else ""
```

- [ ] Write a quick daemon test to confirm the guard works. Add to `agent/tests/unit/test_daemon_outreach.py`:

```python
@pytest.mark.asyncio
async def test_send_loop_skips_draft_when_mode_is_manual():
    """Daemon must not auto-send when candidate has email_outreach_mode=manual."""
    pool = MagicMock()
    draft = _make_draft(day_number=1)

    with patch("agent.db.get_scheduled_drafts", new=AsyncMock(return_value=[draft])), \
         patch("agent.db.get_daily_email_send_count", new=AsyncMock(return_value=0)), \
         patch("agent.db.get_candidate_preferences",
               new=AsyncMock(return_value={"email_outreach_mode": "manual"})), \
         patch("agent.gmail_client.send_email") as mock_send:

        from agent.daemon import _outreach_send_once
        await _outreach_send_once(pool)

    mock_send.assert_not_called()


@pytest.mark.asyncio
async def test_send_loop_sends_when_mode_is_agentic():
    """Daemon must auto-send when candidate has email_outreach_mode=agentic."""
    pool = MagicMock()
    draft = _make_draft(day_number=1)

    with patch("agent.db.get_scheduled_drafts", new=AsyncMock(return_value=[draft])), \
         patch("agent.db.get_daily_email_send_count", new=AsyncMock(return_value=0)), \
         patch("agent.db.get_resume_version_for_send", new=AsyncMock(return_value=_make_resume_version())), \
         patch("agent.db.get_candidate_preferences",
               new=AsyncMock(return_value={"gmail_access_token": "tok", "gmail_refresh_token": "ref",
                                           "email_outreach_mode": "agentic"})), \
         patch("agent.gmail_client.send_email", return_value={"id": "gm-001", "threadId": "th-001"}), \
         patch("agent.db.update_email_draft", new=AsyncMock()) as mock_update_draft, \
         patch("agent.db.update_email_cadence", new=AsyncMock()), \
         patch("agent.db.get_cadence_drafts", new=AsyncMock(return_value=[])):

        from agent.daemon import _outreach_send_once
        await _outreach_send_once(pool)

    mock_update_draft.assert_called()
```

- [ ] Run daemon tests — confirm both new tests PASS:
```bash
cd agent && poetry run pytest tests/unit/test_daemon_outreach.py -v -k "manual_mode or agentic"
```
Expected: 2 passed.

- [ ] Run full daemon test suite:
```bash
cd agent && poetry run pytest tests/unit/test_daemon_outreach.py -v
```
Expected: all pass.

- [ ] Commit:
```bash
git add agent/agent/daemon.py agent/tests/unit/test_daemon_outreach.py
git commit -m "feat: daemon skips auto-send when email_outreach_mode=manual"
```

---

## Task 10: Final verification

- [ ] Run full Next.js test suite:
```bash
npm run test:run
```
Expected: all tests pass, 0 failures.

- [ ] Run TypeScript check:
```bash
npx tsc --noEmit
```
Expected: no output (0 errors).

- [ ] Run production build:
```bash
npm run build
```
Expected: exits 0, no prerender errors.

- [ ] Run Python test suite:
```bash
cd agent && poetry run pytest tests/unit/ -v
```
Expected: all F6 tests pass (pre-existing scraper failures unrelated to this feature are acceptable).

- [ ] Commit test results and final cleanup:
```bash
git add -A
git commit -m "feat: email outreach manual/agentic mode — complete"
```
