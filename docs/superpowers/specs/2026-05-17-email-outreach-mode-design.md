# Email Outreach Mode — Design Spec
**Date**: 2026-05-17  
**Branch**: proxim-mvp  
**Status**: Approved

---

## Problem

The agentic email outreach module (F6) sends emails on behalf of the candidate using Gmail OAuth2. In a multi-tenant hosted environment, many users will be unwilling to grant an app access to read their Gmail inbox and send emails automatically. Manual mode removes that barrier entirely — no OAuth needed — while preserving the AI-generated draft quality.

---

## Decision

Add a `email_outreach_mode` preference (`'manual'` | `'agentic'`) defaulting to `'manual'`. The preference controls:
1. Whether the Settings page shows Gmail OAuth setup as required
2. How the EmailOutreachPanel renders (send buttons vs. Open-in-Gmail buttons)
3. Whether the Python daemon auto-sends scheduled drafts

Approach: **preference in `candidates.preferences` JSONB**, read at runtime by both the daemon and the UI. No new DB columns needed.

---

## Data Model

### `candidates.preferences` (no migration required)

```typescript
interface Preferences {
  // ... existing fields ...
  email_outreach_mode?: 'agentic' | 'manual'  // undefined treated as 'manual'
}
```

### `email_drafts.status` — one new value

| Value | Meaning |
|---|---|
| `manually_sent` | Candidate confirmed they sent this draft from their own Gmail |

All existing values (`draft`, `approved`, `scheduled`, `sent`, `cancelled`, etc.) unchanged. The UI treats `sent` and `manually_sent` identically.

### No changes to `email_cadences` table or status machine

Existing statuses cover all states:
- `pending_approval` → drafts generated, awaiting candidate review
- `approved` → candidate approved drafts; Day 1 ready to send
- `active` → Day 1 sent (or manually_sent); Day 3/7 countdown running
- `replied` / `bounced` / `cancelled` / `cadence_complete` → terminal

---

## Settings UI

### New card: Email Outreach (Settings page, right column, below LinkedIn)

```
┌─────────────────────────────────────────────────┐
│  ✉  EMAIL OUTREACH                              │
│                                                 │
│  How should Proxim send outreach emails?        │
│                                                 │
│  ● Manual         (Recommended)                 │
│    Proxim generates drafts. You review          │
│    and send from your own Gmail.                │
│    No Gmail authorisation required.             │
│                                                 │
│  ○ Agentic                                      │
│    Proxim sends automatically via Gmail API.    │
│    Requires Gmail authorisation in settings.    │
│                                                 │
│  [Save]                                         │
└─────────────────────────────────────────────────┘
```

**Validation**: Selecting Agentic while Gmail is not connected shows an inline warning:  
*"Connect Gmail above before enabling agentic mode."*

**Mode switch behaviour (Option B — immediate effect)**:
- `Agentic → Manual`: saves immediately, no confirmation. Daemon stops auto-sending active cadences on next poll.
- `Manual → Agentic`: shows note *"Proxim will resume auto-sending any pending Day 3/7 emails."*

---

## EmailOutreachPanel — Manual Mode

The panel receives `mode: 'manual' | 'agentic'` as a prop (passed from Applications page, which reads it from `candidate.preferences`).

### `pending_approval` state

```
EMAIL OUTREACH  ● Review & Approve

[ Day 1 (Intro) ] [ Day 3 ] [ Day 7 ]
┌──────────────────────────────────────┐
│  Draft body (read + edit)            │
│  [Edit]  [Show Original]             │
└──────────────────────────────────────┘

[Open Day 1 in Gmail →]       ← opens Gmail compose, no side effect in app
[Approve Drafts]              ← marks cadence approved, advances to 'approved' state
```

"Open in Gmail →" constructs a Gmail compose URL:
```
https://mail.google.com/mail/?view=cm
  &to={encodeURIComponent(hiringManagerEmail)}
  &su={encodeURIComponent(subject)}
  &body={encodeURIComponent(bodyText)}
```
`bodyText` (plain text) is used — not `bodyHtml` — since Gmail compose doesn't render HTML in the body param.

### `approved` state — Day 1 ready to send

Note: Due dates for Day 3/7 are only known after countdown starts. In `approved` state, tabs show plain labels. Due-date labels appear in `active` state.

```
[ Day 1 (Intro) ] [ Day 3 ] [ Day 7 ]

Day 1 tab:
  <draft body>
  [Open in Gmail →]
  [Start Day 3/7 Countdown]   ← enabled after "Open in Gmail →" clicked once
                               ← clicking starts countdown from now
```

State: `gmailOpened` (local boolean) — set to true on first "Open in Gmail →" click. Enables "Start countdown".

### `active` state — countdown running

```
[ Day 1 ✓ Sent ] [ Day 3 · Due in 2d 14h ] [ Day 7 · Due in 5d 14h ]
```

**Day 1 tab**: Shows sent confirmation. No further action needed.

**Day 3/Day 7 tab (before due date)**:
```
  Scheduled for May 20 at 10:01 AM
  <draft body>
  [Open in Gmail →]           ← enabled always
  [Send early]                ← same as "Open in Gmail →", just different label
  ─────────────────
  [Stop cadence]              ← cancels remaining drafts
```

**Day 3/Day 7 tab (overdue)**:
```
  ⚠ Overdue — was due May 20
  <draft body>
  [Open in Gmail →]
  [Stop cadence]
```

After clicking "Open in Gmail →" on Day 3 or 7, a **"Mark as Sent"** button appears. Clicking it calls `POST /api/email-cadence/[cadenceId]/mark-sent` with the draft ID.

---

## EmailOutreachPanel — Agentic Mode

**No change** to current behaviour. The existing "Approve & Send Day 1 Now" button, daemon auto-send, and bounce/reply detection all work exactly as today.

---

## New API Routes

### `POST /api/email-cadence/[cadenceId]/start-countdown`

```
Body:   { candidateId: string }
Effect: Sets Day 3 scheduled_send_at = now() + 72h
        Sets Day 7 scheduled_send_at = now() + 168h
        Sets both drafts status = 'approved'
        Sets cadence status = 'active'
        Sets cadence day1_message_id = null (manual send, no Gmail message ID)
Returns: { cadenceId, status: 'active', day3Due, day7Due }
Errors: 404 cadence not found | 422 cadence not in approved state
```

### `POST /api/email-cadence/[cadenceId]/mark-sent`

```
Body:   { candidateId: string, draftId: string }
Effect: Sets email_drafts.status = 'manually_sent', sent_at = now()
        If day_number == 1: no scheduling (countdown started separately)
        If day_number == 3 or 7: sets cadence status = 'cadence_complete'
          if both Day 3 and Day 7 are now sent/manually_sent
Returns: { draftId, status: 'manually_sent', sentAt }
Errors: 404 draft not found | 409 already sent
```

### `POST /api/email-cadence/[cadenceId]/cancel`

```
Body:   { candidateId: string }
Effect: Sets cadence status = 'cancelled'
        Sets pending drafts (approved/scheduled) status = 'cancelled'
Returns: { cadenceId, status: 'cancelled' }
Errors: 404 not found | 409 already terminal
```

---

## Python Daemon Change

One guard added to `_outreach_send_once` in `daemon.py`:

```python
# Before sending each draft:
prefs = await _db.get_candidate_preferences(pool, candidate_id)
mode = (prefs or {}).get('email_outreach_mode', 'manual')
if mode == 'manual':
    continue  # skip auto-send — candidate sends manually
```

This is the **only daemon change**. No new coroutines, no new DB queries beyond what already happens.

---

## API Client (`src/lib/api.ts`) — New Functions

```typescript
startCountdown(cadenceId: string, candidateId: string)
  → Promise<{ cadenceId, status, day3Due, day7Due }>

markDraftSent(cadenceId: string, draftId: string, candidateId: string)
  → Promise<{ draftId, status, sentAt }>

cancelCadence(cadenceId: string, candidateId: string)
  → Promise<{ cadenceId, status }>
```

---

## Applications Page Changes

The Applications page (`page.tsx`) fetches `candidate.preferences` alongside jobs (using existing `getPreferences` API) and passes `mode` to each `JobCard`, which passes it to `EmailOutreachPanel`.

```typescript
const { preferences } = await getPreferences(candidateId)
const mode = preferences.email_outreach_mode ?? 'manual'
```

---

## Files Changed

| File | Change |
|---|---|
| `src/types/candidate.ts` | Add `email_outreach_mode` to `Preferences` |
| `src/components/settings/EmailOutreachModeCard.tsx` | New component |
| `src/app/candidates/[id]/settings/page.tsx` | Add EmailOutreachModeCard |
| `src/app/candidates/[id]/applications/page.tsx` | Fetch preferences, pass mode |
| `src/components/applications/JobCard.tsx` | Accept + pass mode prop |
| `src/components/pipeline/EmailOutreachPanel.tsx` | Dual rendering based on mode |
| `src/lib/api.ts` | Add 3 new API functions |
| `src/app/api/email-cadence/[cadenceId]/start-countdown/route.ts` | New route |
| `src/app/api/email-cadence/[cadenceId]/mark-sent/route.ts` | New route |
| `src/app/api/email-cadence/[cadenceId]/cancel/route.ts` | New route |
| `agent/agent/daemon.py` | Add mode guard in `_outreach_send_once` |

---

## Out of Scope

- Email notifications / reminders sent to candidate (Option B rejected)
- Switching mode per-cadence (mode is per-candidate)
- Reply/bounce detection in manual mode (no Gmail access)
- `email_cadences.day1_message_id` used for threading in manual mode (no message ID available)
- Day 3/7 threading headers in manual mode (`In-Reply-To` not set — each is a standalone email)
