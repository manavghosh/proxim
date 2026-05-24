# Design: Surface LinkedIn-discovered email as suggestion in Email Outreach panel

**Date:** 2026-05-23

## Problem

The LinkedIn Agent (F5) discovers the hiring manager's email via Hunter.io and writes it to `outreachTargets.email` + `outreachTargets.emailConfidence`. This data is never exposed to the browser. When the Email Outreach Agent (F6) fails to find an email (`email_not_found` or `low_confidence`), the user is forced to type an address manually — unaware that F5 already has it.

## Solution

Expose `outreachTargets.email` and `outreachTargets.emailConfidence` through the API and show a one-click suggestion chip in `EmailOutreachPanel` when:
- The cadence `needsEmail` (no `hiringManagerEmail` yet), AND
- The outreach target has a discovered email

## Files changed

### 1. `src/types/candidate.ts`
Add to `OutreachTargetSummary`:
```ts
email:           string | null
emailConfidence: number | null
```

### 2. `src/app/api/candidates/[id]/jobs/route.ts` + `src/app/api/jobs/route.ts`
Select `outreachTargets.email` and `outreachTargets.emailConfidence` in the DB query; include them in the mapped `outreachTarget` object.

### 3. `src/components/pipeline/EmailOutreachPanel.tsx`
Add optional prop `suggestedEmail?: string | null` and `suggestedEmailConfidence?: number | null`.

When `needsEmail` is true and `suggestedEmail` is present, render above the manual input:

> 💡 **From LinkedIn contact** · `jeff@suffolkglobal.com` · 87% confidence → **[Use this]**

Clicking "Use this" calls `overrideEmail(cadence.id, candidateId, suggestedEmail)` directly — same code path as the existing Save button.

### 4. `src/components/applications/JobCard.tsx`
Pass `outreachTarget.email` and `outreachTarget.emailConfidence` as `suggestedEmail` / `suggestedEmailConfidence` to `EmailOutreachPanel`.

## Scenarios

| F6 result | F5 result | Before | After |
|---|---|---|---|
| Verified email found | Any | Auto-populated, user approves | Unchanged |
| `email_not_found` | Email found | User types manually | One-click chip |
| `low_confidence` | Better email found | Only F6 email shown | Both shown, user picks |
| `email_not_found` | No email | Manual entry | Unchanged |

## Out of scope
- No agent-side changes
- No new API endpoints
- No changes to the Hunter.io discovery logic
