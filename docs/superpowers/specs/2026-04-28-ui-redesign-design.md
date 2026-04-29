# Proxim UI Redesign — Design Spec

**Date:** 2026-04-28  
**Status:** Approved  
**Scope:** Full-app shell redesign + Dashboard page + Settings reskin + two placeholder pages

---

## 1. Goal

Replace the plain gray `/settings` page with a full enterprise-grade shell: deep navy dark theme, named sidebar navigation, a real Dashboard landing page, and honest placeholder screens for Phase 2 features. No backend changes required — all data is already available via existing route handlers.

---

## 2. Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Navigation | Named sidebar (220 px) | Labels always visible; appropriate for CXO-level users who don't want to hover for tooltips |
| Visual tone | Deep Navy Dark | `#060d1f` base, `#0d1f3c` cards, `#3b82f6`/`#6366f1` accent. Premium and focused |
| Primary accent | Blue `#3b82f6` → Indigo `#6366f1` gradient | Trustworthy, professional; matches shadcn neutral base |
| Status colours | Green `#10b981`, Amber `#f59e0b`, Red `#ef4444` | Standard semantic traffic-light system |
| Typography | System stack (`-apple-system, Inter, Segoe UI`) | Fast, familiar; no web-font load penalty |

---

## 3. Screens

### 3.1 App Shell (all pages)

**Sidebar (220 px, fixed)**  
- Logo mark (blue→indigo gradient square) + "PROXIM" wordmark + version tag  
- Nav sections: **Main** (Dashboard, Pipeline, Applications) · **Account** (Settings)  
- Pipeline and Applications are real `<Link>` elements that navigate to their placeholder screens — they are not disabled, just route to Phase 2 placeholder content. A muted `soon` label sets expectation.  
- Active item: `#0d1f3c` background + `#1d4ed8` border + `#93c5fd` text  
- Footer: user avatar pill (initials, name, role label)

**Topbar (52 px)**  
- Page title (left)  
- Contextual action buttons (right) — vary per page  
- `#0a1220` background, `1px solid #1e2d4a` bottom border

**Root layout** (`src/app/layout.tsx`) is a server component that wraps all pages in a `flex h-screen` shell: `<Sidebar/>` + a `<div class="flex-1 flex flex-col overflow-hidden">` that receives `{children}`. `Sidebar` is a `'use client'` component and uses `usePathname()` internally — the layout itself stays a server component.

Each page is responsible for rendering its own `<Topbar>` as the first element inside its content area. This avoids the Next.js App Router constraint that prevents passing per-page props (title, actions) from a page up to its layout.

---

### 3.2 Dashboard (`/`)

**Purpose:** Landing page. Shows readiness status at a glance and surfaces the parsed profile.

**Stat row (4 cards):**
| Card | Value source | Colour when positive |
|---|---|---|
| Pipeline Status | `GET /api/candidate/readiness` → `ready` | Green |
| CV Parse | `GET /api/cv` → `parseStatus` | Green when `ready` |
| Jobs Matched | Hardcoded `—` (Phase 2) | — |
| Applications | Hardcoded `—` (Phase 2) | — |

**Readiness ring:**  
SVG circle ring showing % complete (0/3, 1/3, 2/3, or 3/3 criteria met). Criteria checklist below with ✓ / ○ icons. "Go to Settings →" link. Ring colour: amber when incomplete, green when all 3 met.

**Activity feed (left column, below ring):**  
Derived from the candidate record (no separate events table exists in Phase 1). Three possible entries, shown only when the relevant data is present:
- "CV saved" · relative time from `candidate.updatedAt` — shown when `baseCvMd` is non-null
- "Profile parsed" · relative time from `candidate.updatedAt` — shown when `parseStatus === 'ready'`
- "Preferences saved" — shown when `preferences` object has at least one key

If no data exists yet, shows an empty state: "No activity yet — start by uploading your CV."

**Profile card (right column):**  
Pulled from `GET /api/cv` → `parsedProfile`. Shows:
- Initials avatar (generated from `parsedProfile.name`)
- Name + top role title from `parsedProfile.roles[0]`
- Parse status badge (`Parsed` / `Parsing…` / `Pending` / `Failed`)
- Top 6 skills from `parsedProfile.skills`
- Target role chips from `preferences.seniority_levels`
- Geographic preference

If `parsedProfile` is null (not yet parsed), profile card shows an empty state with a "Upload your CV in Settings" call-to-action.

**Data fetching:**  
Dashboard is a `'use client'` component. Fetches `GET /api/cv` and `GET /api/candidate/readiness` in parallel via `Promise.all` on mount (same pattern as current settings page). Shows a skeleton loader while fetching.

---

### 3.3 Settings (`/settings`) — reskin only

Same components (`CVUploader`, `MarkdownEditor`, `ParseStatusBadge`, `PreferencesForm`), same logic. Changes:
- Remove standalone page header — topbar provides title
- Two-column layout on desktop: CV section left (2/3 width), Preferences right (1/3 width)  
- Cards styled with `#0d1f3c` background, `1px solid #1e3a5f` border, `border-radius: 10px`
- Section headings use the new label style (small-caps, muted)
- All shadcn/ui components inherit dark theme via CSS variables overridden in `globals.css`

---

### 3.4 Pipeline (`/pipeline`) — placeholder

Full-shell layout. Content area:
- Large lock/pipeline icon (Lucide `Workflow`)
- Heading: "Pipeline — Coming in Phase 2"
- Body: "Once your profile is ready, Proxim will automatically search for matching roles, score them against your preferences, and surface the best opportunities here."
- CTA button: "Complete your profile" → `/settings`

---

### 3.5 Applications (`/applications`) — placeholder

Same shell. Content area:
- Lucide `Send` icon
- Heading: "Applications — Coming in Phase 2"
- Body: "When Proxim identifies strong matches and you approve them, your applications will be tracked here — status, responses, and next steps."
- CTA button: "View Pipeline" → `/pipeline`

---

## 4. Styling Architecture

### 4.1 CSS variables (dark theme)

Override shadcn's CSS variables in `src/app/globals.css` to set the dark palette globally:

```css
:root {
  --background: 215 50% 8%;        /* #0d1829 */
  --foreground: 213 31% 91%;       /* #e2e8f0 */
  --card: 222 65% 10%;             /* #0d1f3c */
  --card-foreground: 213 31% 91%;
  --border: 217 45% 20%;           /* #1e3a5f */
  --primary: 217 91% 60%;          /* #3b82f6 */
  --primary-foreground: 0 0% 100%;
  --muted: 222 47% 11%;
  --muted-foreground: 215 20% 45%; /* #64748b */
  --accent: 222 47% 15%;
  --accent-foreground: 213 31% 91%;
  --destructive: 0 84% 60%;
  --ring: 217 91% 60%;
}
```

Tailwind CSS v4 picks these up automatically — no `tailwind.config.js` needed.

### 4.2 Sidebar as a shared layout component

`src/components/layout/Sidebar.tsx` — `'use client'`, uses `usePathname()` to derive the active route. Imported once in `src/app/layout.tsx`.

`src/components/layout/Topbar.tsx` — receives `title: string` and optional `actions?: React.ReactNode` props. Rendered at the top of each page's content, not in the root layout.

`src/app/layout.tsx` wraps children in:
```tsx
<div className="flex h-screen overflow-hidden bg-[#060d1f]">
  <Sidebar />
  <div className="flex-1 flex flex-col overflow-hidden">{children}</div>
</div>
```

---

## 5. New Files

```
src/
  app/
    layout.tsx                    ← updated: dark body bg, shell flex wrapper
    globals.css                   ← updated: dark CSS variable overrides
    page.tsx                      ← new: redirect to /dashboard
    dashboard/
      page.tsx                    ← new: Dashboard page
    pipeline/
      page.tsx                    ← new: Pipeline placeholder
    applications/
      page.tsx                    ← new: Applications placeholder
    settings/
      page.tsx                    ← updated: reskin only, no logic changes
  components/
    layout/
      Sidebar.tsx                 ← new
      Topbar.tsx                  ← new
    dashboard/
      StatCard.tsx                ← new
      ReadinessRing.tsx           ← new
      ActivityFeed.tsx            ← new
      ProfileCard.tsx             ← new
    shared/
      PlaceholderPage.tsx         ← new: reusable for pipeline + applications
      PipelineReadinessIndicator.tsx  ← existing, keep
```

---

## 6. Components Not Changing

`CVUploader`, `MarkdownEditor`, `ParseStatusBadge`, `PreferencesForm` — logic unchanged. They will inherit the new dark theme via CSS variables automatically.

---

## 7. Shadcn/ui Components Needed

Already installed: `Button`, `Textarea`, `Badge`, `Label`  
New additions needed: `Separator`, `Skeleton` (for loading states)

---

## 8. Out of Scope

- Authentication / user accounts
- Real activity log (events table in DB)
- Pipeline and Applications actual functionality
- Mobile/responsive layout (desktop-first for MVP)
- Animations beyond what Tailwind provides

---

## 9. Success Criteria

- Navigating to `http://localhost:3000` lands on Dashboard (not 404)
- Sidebar highlights the active route correctly on all 4 pages
- Dashboard loads data from the two existing API endpoints and renders correctly
- Settings page looks visually consistent with the new shell
- Pipeline and Applications render their placeholder screens
- TypeScript compiles with zero errors
- All existing unit tests continue to pass
