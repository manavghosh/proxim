# Email Discovery Failure UX — Design Spec
**Date:** 2026-05-20
**Status:** Approved for implementation

---

## 1. Problem

When the outreach mailer agent cannot find an email address for a hiring manager, the
Pipeline page shows a small "Email not found" badge with no forward path. The user has
to figure out what to do next on their own. Retrying queues unlimited duplicate jobs,
and the cadence sits blocked indefinitely.

---

## 2. Goals

1. Show a clear, actionable failure panel when email discovery fails — no backend tool
   names, no jargon.
2. Give the user three explicit next steps: enter email manually, use LinkedIn outreach
   instead, or skip.
3. Cap retries at 2 with a visible counter.
4. Generate Day 1/3/7 email draft bodies **optimistically** (regardless of whether an
   email address was found) so that when a user supplies a manual email the cadence
   proceeds immediately without a second generation wait.

---

## 3. Scope

| Layer | Change |
|---|---|
| Agent (`outreach_mailer` flow) | Always run generation after discovery; don't bail early on `email_not_found` or `low_confidence` |
| DB schema | Add `retry_count INTEGER NOT NULL DEFAULT 0` to `email_cadences` |
| Drizzle migration | New migration file |
| API — `start-email-outreach` | Increment `retry_count`; return 429 when count ≥ 2 |
| API — new `override-email` | Accept manual email, update cadence, transition to `pending_approval` |
| Type — `EmailCadenceSummary` | Add `retryCount: number` field |
| UI — `JobReviewCard` | Replace badge with `EmailNotFoundPanel` when status is `email_not_found` or `low_confidence` |
| UI — new `EmailNotFoundPanel` | Inline action strip with 3 paths + retry counter |

Out of scope: changing the email discovery logic itself, LinkedIn direct-message sending,
the Applications page detail view.

---

## 4. Agent Changes — Optimistic Generation

### Current flow
```
discover_email → if not found: mark email_not_found, return early
              → if found: generate_emails → write_cadence_checkpoint
```

### New flow
```
discover_email → generate_emails (always)
              → if email found:     status = pending_approval
              → if email not found: status = email_not_found  (drafts saved)
              → if low confidence:  status = low_confidence   (drafts saved)
```

In `daemon.py`, the `outreach_mailer` handler removes the early-return guard and always
calls `generate_emails_node`. The `write_cadence_checkpoint_node` saves drafts in all
cases but only sets `status = pending_approval` when an email was discovered. When email
is absent it sets `status = email_not_found` (or `low_confidence`) so the UI panel
triggers.

The `outreach_mailer_generate` job type (used for regeneration) is unchanged.

---

## 5. Schema Change

```sql
ALTER TABLE email_cadences ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0;
```

Added via a new Drizzle migration. The Drizzle schema file gets:
```ts
retryCount: integer('retry_count').notNull().default(0),
```

---

## 6. API Changes

### 6a. `POST /api/jobs/[jobId]/start-email-outreach` — add retry cap

Before queuing a new `outreach_mailer` job:
1. Read `retry_count` from the existing cadence (if any).
2. If `retry_count >= 2`, return `{ error: 'Max retries reached', retryCount: 2 }` with
   status 429.
3. Otherwise increment `retry_count` by 1 on the cadence row, then queue the job.

No change to the `RESTARTABLE` status list — `email_not_found` and `low_confidence`
remain restartable (subject to the counter).

### 6b. `POST /api/jobs/[jobId]/override-email` — new endpoint

**Request body:**
```json
{ "email": "ivy.wong@kuokgroup.com.sg" }
```

**Logic:**
1. Validate that a cadence exists for this job in status `email_not_found`,
   `low_confidence`, or `failed`.
2. Update `email_cadences` set `hiring_manager_email = :email`, `status =
   pending_approval`, `email_source = 'manual'`.
3. Return `{ cadenceId, status: 'pending_approval' }`.

No new pipeline job is queued — drafts were already generated optimistically. The cadence
moves directly to `pending_approval` for the user to review.

If no cadence exists (edge case), return 404.

---

## 7. Type Changes

`EmailCadenceSummary` in `src/types/candidate.ts`:
```ts
retryCount: number          // add this field
```

`src/lib/api.ts` — wherever `EmailCadenceSummary` is assembled from API responses,
include `retryCount` from the cadence row.

The `EmailCadenceStatus` union type does not change — `email_not_found` and
`low_confidence` already exist.

---

## 8. UI — `EmailNotFoundPanel` Component

**File:** `src/components/pipeline/EmailNotFoundPanel.tsx`

Replaces the `EmailCadenceStatusBadge` in `JobReviewCard` when
`emailCadence.status === 'email_not_found' || emailCadence.status === 'low_confidence'`.

### Layout (inline, no modal)

```
No email found for Kuok Group Singapore

[✉ Enter email]   [💼 Use LinkedIn]   [✕ Skip]
                                  Retry (1/2) ›
```

For `low_confidence`, the message changes to:
```
Email found but could not be verified for Kuok Group Singapore
```

### Behaviour per action

**Enter email (primary):**
- Button click expands an inline `<Input>` + "Save" button directly below the action strip.
- On Save: calls `POST /api/jobs/[jobId]/override-email` with the typed email.
- On success: parent re-fetches the cadence; panel replaces with the normal
  `EmailCadenceStatusBadge` showing `pending_approval`.
- Basic validation: must contain `@` and a `.` after it; no empty submit.

**Use LinkedIn (secondary):**
- Only rendered when `outreachTarget` prop is non-null (LinkedIn connector found a
  contact).
- Clicking scrolls the page to — or opens — the LinkedIn outreach section of the card
  (existing `OutreachStatusBadge` row).
- If no outreach target exists, this button is hidden (not greyed out — no point showing
  an unavailable path).

**Skip:**
- Calls `POST /api/email-cadence/[cadenceId]/cancel`.
- On success: cadence status becomes `cancelled`; `EmailCadenceStatusBadge` takes over
  showing the grey "Cancelled" badge.
- No confirmation dialog — the action is reversible (user can start fresh outreach from
  the job detail).

**Retry:**
- Styled as a small ghost link, right-aligned: `Retry (1/2) ›` or `Retry (2/2) ›`.
- When `retryCount >= 2`: button is disabled and label reads `Max retries reached`.
- Clicking calls `POST /api/jobs/[jobId]/start-email-outreach`.
- On 429 from the API: update UI immediately to disabled state.
- On success: cadence transitions to `discovering`; the `EmailCadenceStatusBadge`
  (transient states are already hidden by the badge component) shows nothing while the
  agent runs. When the agent finishes, the cadence status updates and the correct badge
  or panel re-renders.

### Props

```ts
interface EmailNotFoundPanelProps {
  jobId: string
  candidateId: string
  cadence: EmailCadenceSummary          // status, id, retryCount
  company: string                       // for display message only
  outreachTarget: OutreachTargetSummary | null
  onUpdate: () => void                  // parent re-fetches after any action
}
```

---

## 9. `JobReviewCard` Integration

The email section currently is:
```tsx
{emailCadence && job.status === 'approved' && (
  <div ...>
    <span>Email</span>
    <EmailCadenceStatusBadge status={emailCadence.status} />
  </div>
)}
```

Change to:
```tsx
{emailCadence && job.status === 'approved' && (
  <div ...>
    <span>Email</span>
    {(emailCadence.status === 'email_not_found' || emailCadence.status === 'low_confidence')
      ? <EmailNotFoundPanel
          jobId={job.id}
          candidateId={candidateId}
          cadence={emailCadence}
          company={job.company}
          outreachTarget={outreachTarget ?? null}
          onUpdate={onUpdate}           // new prop — parent reloads job data
        />
      : <EmailCadenceStatusBadge status={emailCadence.status} />
    }
  </div>
)}
```

`JobReviewCard` gains an `onUpdate: () => void` prop. The Pipeline page passes
`() => loadJobs(selectedGrades, sort)` so that after any panel action the card reflects
the latest cadence state without a full page reload.

---

## 10. Data Flow — Manual Email Path

```
User types email in panel
  → POST /api/jobs/[jobId]/override-email { email }
  → API: UPDATE email_cadences SET hiring_manager_email, status='pending_approval'
  → 200 { cadenceId, status: 'pending_approval' }
  → onUpdate() → getCandidateJobs() refresh
  → EmailNotFoundPanel unmounts; EmailCadenceStatusBadge shows "Review & Approve" (blue)
```

---

## 11. Edge Cases

| Scenario | Handling |
|---|---|
| User enters email while agent is retrying (race) | `override-email` endpoint checks status is in `[email_not_found, low_confidence, failed]`; if agent has already updated status, returns 409 with `currentStatus` |
| outreach_mailer_generate job fails during optimistic generation | Cadence status becomes `failed`; existing `EmailCadenceStatusBadge` shows red "Failed" badge (no change from today) |
| User cancels (Skip) then changes mind | `start-email-outreach` allows restarting from `cancelled` status (already in RESTARTABLE); retry counter resets since a new cadence is created |
| LinkedIn outreach target not yet found when panel renders | "Use LinkedIn" button hidden; panel shows only Enter Email + Skip + Retry |

---

## 12. Files Touched

```
agent/agent/daemon.py                        — remove early-return guard in outreach_mailer
agent/agent/nodes/outreach_mailer.py         — write_cadence_checkpoint_node saves drafts for email_not_found
src/db/schema.ts                             — add retryCount to emailCadences
src/db/migrations/XXXX_add_retry_count.sql   — migration
src/types/candidate.ts                       — add retryCount to EmailCadenceSummary
src/lib/api.ts                               — include retryCount in cadence responses
src/app/api/jobs/[jobId]/override-email/route.ts   — new endpoint
src/app/api/jobs/[jobId]/start-email-outreach/route.ts — add retry cap
src/components/pipeline/EmailNotFoundPanel.tsx       — new component
src/components/pipeline/JobReviewCard.tsx            — swap badge for panel on failure
src/app/candidates/[id]/pipeline/page.tsx            — pass onUpdate to JobReviewCard
```
