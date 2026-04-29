# Async Button Spinner — Design Spec

**Date:** 2026-04-29
**Status:** Approved
**Scope:** Add `isLoading` prop to the shared `Button` component; wire up 4 async action buttons

---

## 1. Goal

Replace the text-swap loading pattern ("Saving…", "Converting…", "Queuing…") on all async action buttons with an animated spinner that sits beside the static label. No new components required — the change lives entirely in the existing `Button` primitive.

---

## 2. Button Component Changes

**File:** `src/components/ui/button.tsx`

Add `isLoading?: boolean` to the `Button` props. When `true`:
- Render `<Loader2 className="animate-spin" />` as the first child inside the button
- Force `disabled` to `true` (merged with any caller-provided `disabled` prop)
- The button label remains visible as-is beside the spinner

The existing CVA base class already includes `[&_svg:not([class*='size-'])]:size-4` which sizes the Loader2 icon correctly. No additional CSS needed.

Import: `import { Loader2 } from 'lucide-react'`

---

## 3. Call Site Changes

| File | Button | Old pattern | New pattern |
|---|---|---|---|
| `src/components/cv/CVUploader.tsx` | Upload CV | `disabled={loading}` + text swap to "Converting…" | `isLoading={loading}`, static label "Upload CV" |
| `src/components/cv/MarkdownEditor.tsx` | Save CV | `disabled={saving}` + text swap to "Saving…" | `isLoading={saving}`, static label "Save CV" |
| `src/components/preferences/PreferencesForm.tsx` | Save Preferences | `disabled={saving}` + text swap to "Saving…" | `isLoading={saving}`, static label "Save Preferences" |
| `src/app/settings/page.tsx` | ↺ Re-parse | `disabled={reparsing}` + text swap to "Queuing…" | `isLoading={reparsing}`, static label "↺ Re-parse" |

The spinner sits to the left of the label text in all cases. For Re-parse, the ↺ character stays in the label — spinner and ↺ coexist.

---

## 4. Files Changed

```
src/
  components/
    ui/
      button.tsx              ← add isLoading prop + Loader2 render
    cv/
      CVUploader.tsx          ← isLoading={loading}, remove text swap
      MarkdownEditor.tsx      ← isLoading={saving}, remove text swap
    preferences/
      PreferencesForm.tsx     ← isLoading={saving}, remove text swap
  app/
    settings/
      page.tsx                ← isLoading={reparsing}, remove text swap
```

---

## 5. Out of Scope

- Navigation links and CTA links (e.g. "Go to Settings →") — these are not async
- The "▶ Run Pipeline" topbar button on Dashboard — not wired to a backend call yet
- Toggle/selection buttons in PreferencesForm (geographic, stage, domain) — not async
- Any new spinner component — Loader2 from lucide-react is sufficient

---

## 6. Success Criteria

- Clicking an async button shows a spinning icon beside the static label
- Button is disabled (no double-submit) while the request is in flight
- TypeScript compiles with zero errors
- All existing unit tests continue to pass
- No visual regression on buttons not touched by this change
