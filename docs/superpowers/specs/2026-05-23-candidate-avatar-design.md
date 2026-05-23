# Candidate Avatar — Design Spec

**Date:** 2026-05-23  
**Status:** Approved

---

## Overview

Add a per-candidate avatar image to Proxim. Users upload a photo in the settings page; the same image appears next to the candidate's name on every screen. When no photo has been uploaded the UI falls back to two-letter initials on a gradient background (identical to today's behaviour).

---

## Screens That Show the Avatar

| Screen | Component | Size |
|---|---|---|
| Sidebar (all pages) | `CandidateSidebar.tsx` — bottom-left footer | 28×28 px |
| Topbar candidate switcher | `CandidateSwitcher.tsx` — button + each row in dropdown | 20×20 px |
| Dashboard profile card | `ProfileCard.tsx` — top of card, above name | 64×64 px |

**Fallback on all screens:** two-letter initials (first letter of first name + first letter of last name) on a gradient background, via `AvatarFallback` from the shadcn Avatar component.

---

## Upload Flow (Settings Page)

A **"Profile Photo"** section is added at the top of `/candidates/[id]/settings`.

1. Renders the current `CandidateAvatar` at 80×80 px.
2. An **"Upload photo"** button opens a native `<input type="file" accept="image/*">` file picker.
3. If a photo exists, a **"Remove"** link is shown alongside.
4. **Client-side image processing on file select:**
   - Draw the selected image onto a 128×128 `<canvas>` (center-crop to square).
   - Export as JPEG at 85% quality → base64 data URL (~15–25 KB).
5. `PATCH /api/candidates/[id]` with `{ avatarData: "data:image/jpeg;base64,…" }`.
6. **Optimistic update:** new avatar renders immediately in the settings section.
7. Clicking **"Remove"** sends `PATCH` with `{ avatarData: null }`, reverting to initials everywhere.

---

## Data Storage

- **Column:** `avatar_data TEXT` (nullable) added to the `candidates` table.
- Stores the full base64 data URL.
- Applies to both the **SQLite** schema (`schema.sqlite.ts`) and the **Neon/PostgreSQL** schema (`schema.ts`).
- A Drizzle migration is generated via `npm run db:generate` and applied via `npm run db:migrate` for both environments.

---

## Data Flow

```
User uploads image in /candidates/[id]/settings
  → canvas resize to 128×128, JPEG 85%, base64 data URL
  → PATCH /api/candidates/[id]  { avatarData }
  → candidates.avatar_data saved to DB (SQLite dev / Neon prod)

Any page load:
  Sidebar/Topbar
    → Candidate layout server component (/candidates/[id]/layout.tsx)
    → SELECT avatar_data FROM candidates WHERE id = ?
    → Passed as prop to CandidateSidebar and available to CandidateSwitcher

  Dashboard
    → GET /api/cv returns avatarData
    → ProfileCard reads and renders it

  Topbar switcher (candidate list)
    → GET /api/candidates returns avatarData per candidate
    → CandidateSwitcher renders each candidate's avatar
```

---

## Component: `CandidateAvatar`

New shared component at `src/components/shared/CandidateAvatar.tsx`.

```tsx
// Props
interface CandidateAvatarProps {
  name: string
  avatarData?: string | null
  size?: 'sm' | 'md' | 'lg'   // sm=20px, md=28px, lg=64px
  className?: string
}
```

Internally uses shadcn `Avatar` / `AvatarImage` / `AvatarFallback`. The fallback computes initials from `name`: first letter of each word up to 2 words (e.g. "Manav Ghosh" → "MG"). If only one word, use the first 2 characters of that word (e.g. "Manav" → "MA").

---

## Files Changed

| File | Change |
|---|---|
| `src/db/schema.ts` | Add `avatarData: text('avatar_data')` to candidates table |
| `src/db/schema.sqlite.ts` | Same column added |
| New Drizzle migration | Generated + applied for SQLite and Neon |
| `src/components/ui/avatar.tsx` | Install via `npx shadcn@latest add avatar` if not present |
| `src/components/shared/CandidateAvatar.tsx` | **New** — reusable avatar component |
| `src/types/candidate.ts` | Add `avatarData?: string \| null` to candidate type |
| `src/app/candidates/[id]/layout.tsx` | Select + pass `avatarData` |
| `src/components/layout/CandidateSidebar.tsx` | Replace initials div with `CandidateAvatar` (size md) |
| `src/components/layout/CandidateSwitcher.tsx` | Add `CandidateAvatar` next to name (size sm) |
| `src/components/dashboard/ProfileCard.tsx` | Replace initials div with `CandidateAvatar` (size lg) |
| `src/app/candidates/[id]/settings/page.tsx` | Add "Profile Photo" section with upload + remove |
| `src/app/api/candidates/[id]/route.ts` | PATCH: accept + save `avatarData` |
| `src/app/api/cv/route.ts` | GET: return `avatarData` |
| `src/app/api/candidates/route.ts` | GET list: return `avatarData` per candidate |

---

## Out of Scope

- Drag-and-drop upload
- Server-side image processing / validation
- Avatar for non-candidate users
- External object storage
