# UI Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the plain grey `/settings` page with a full enterprise shell — deep navy dark theme, 220 px named sidebar, Dashboard landing page, reskinned Settings, and Pipeline/Applications placeholder screens.

**Architecture:** Next.js 15 App Router. A server-component `RootLayout` renders a `Sidebar` (client component, uses `usePathname`) + scrollable main column. Each page renders its own `Topbar` as the first element. Dashboard fetches `GET /api/cv` and `GET /api/candidate/readiness` in parallel on mount. No new API routes or DB changes.

**Tech Stack:** Next.js 15 / React 19 / Tailwind CSS 4.1 / shadcn/ui (new-york, neutral) / Lucide React / TypeScript 5

---

## Spec Reference

`docs/superpowers/specs/2026-04-28-ui-redesign-design.md`

---

## File Map

```
src/
  app/
    globals.css                         ← Task 1: add dark CSS variable overrides
    layout.tsx                          ← Task 3: shell flex wrapper
    page.tsx                            ← Task 4: redirect to /dashboard
    dashboard/
      page.tsx                          ← Task 7: Dashboard page (full)
    pipeline/
      page.tsx                          ← Task 9: Pipeline placeholder
    applications/
      page.tsx                          ← Task 9: Applications placeholder
    settings/
      page.tsx                          ← Task 8: reskin only, logic unchanged
  components/
    layout/
      Sidebar.tsx                       ← Task 2: named sidebar, usePathname
      Topbar.tsx                        ← Task 2: page title + actions slot
    dashboard/
      StatCard.tsx                      ← Task 5: single stat card
      ReadinessRing.tsx                 ← Task 5: SVG ring + checklist
      ActivityFeed.tsx                  ← Task 6: derived activity list
      ProfileCard.tsx                   ← Task 6: parsed profile summary
    shared/
      PlaceholderPage.tsx               ← Task 9: reusable Phase-2 placeholder
      PipelineReadinessIndicator.tsx    ← existing, untouched
```

---

## Task 1: Dark theme — globals.css + shadcn/ui Skeleton & Separator

**Files:**
- Modify: `src/app/globals.css`
- Run: `npx shadcn@latest add skeleton separator`

- [ ] **Step 1: Read the current globals.css**

```bash
cat src/app/globals.css
```

Note the existing CSS variable block format (oklch, hsl, or bare numbers). You will insert the dark-theme overrides **inside the same `:root` block**, replacing the existing light-mode values.

- [ ] **Step 2: Replace the `:root` block in `src/app/globals.css` with the dark palette**

Find the `:root { … }` block (added by `shadcn init`) and replace it so it reads:

```css
@import "tailwindcss";

@layer base {
  :root {
    --background: 220 68% 8%;
    --foreground: 213 31% 91%;
    --card: 220 65% 15%;
    --card-foreground: 213 31% 91%;
    --popover: 220 65% 12%;
    --popover-foreground: 213 31% 91%;
    --primary: 217 91% 60%;
    --primary-foreground: 0 0% 100%;
    --secondary: 217 45% 20%;
    --secondary-foreground: 213 31% 91%;
    --muted: 220 47% 13%;
    --muted-foreground: 215 20% 45%;
    --accent: 220 47% 17%;
    --accent-foreground: 213 31% 91%;
    --destructive: 0 84% 60%;
    --destructive-foreground: 0 0% 100%;
    --border: 217 51% 24%;
    --input: 217 51% 20%;
    --ring: 217 91% 60%;
    --radius: 0.5rem;
  }
}
```

> **Note:** shadcn/ui with Tailwind v4 may already use `@layer base`. If the file has no existing `:root` block (only `@import "tailwindcss"`), add the full `@layer base { :root { … } }` block directly after the import line.

- [ ] **Step 3: Install Skeleton and Separator shadcn components**

```bash
npx shadcn@latest add skeleton separator
```

Expected: `src/components/ui/skeleton.tsx` and `src/components/ui/separator.tsx` created.

- [ ] **Step 4: Verify dev server starts cleanly**

```bash
npm run dev
```

Expected: `▲ Next.js 15.x` ready with no CSS errors. Ctrl+C to stop.

- [ ] **Step 5: Commit**

```bash
git add src/app/globals.css src/components/ui/skeleton.tsx src/components/ui/separator.tsx
git commit -m "feat: apply deep navy dark theme via CSS variables + add Skeleton/Separator"
```

---

## Task 2: Sidebar + Topbar layout components

**Files:**
- Create: `src/components/layout/Sidebar.tsx`
- Create: `src/components/layout/Topbar.tsx`

- [ ] **Step 1: Create `src/components/layout/Sidebar.tsx`**

```tsx
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  Workflow,
  Send,
  Settings,
} from 'lucide-react'

const NAV_MAIN = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/pipeline', label: 'Pipeline', icon: Workflow, soon: true },
  { href: '/applications', label: 'Applications', icon: Send, soon: true },
]

const NAV_ACCOUNT = [
  { href: '/settings', label: 'Settings', icon: Settings },
]

function NavItem({
  href,
  label,
  icon: Icon,
  soon,
  active,
}: {
  href: string
  label: string
  icon: React.ElementType
  soon?: boolean
  active: boolean
}) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors ${
        active
          ? 'bg-[#0d1f3c] text-[#93c5fd] border border-[#1d4ed8]'
          : 'text-[#64748b] hover:bg-[#0d1829] hover:text-[#94a3b8]'
      }`}
    >
      <Icon className="w-4 h-4 flex-shrink-0" />
      <span className="flex-1">{label}</span>
      {soon && (
        <span className="text-[10px] text-[#334155] font-medium">soon</span>
      )}
    </Link>
  )
}

export function Sidebar() {
  const pathname = usePathname()

  return (
    <aside className="w-[220px] bg-[#060d1f] border-r border-[#1e2d4a] flex flex-col flex-shrink-0 h-screen">
      {/* Logo */}
      <div className="px-4 py-5 border-b border-[#0d1829]">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center flex-shrink-0">
            <span className="text-white text-xs font-bold">P</span>
          </div>
          <div>
            <div className="text-[13px] font-bold text-[#f1f5f9] tracking-widest">
              PROXIM
            </div>
            <div className="text-[9px] text-[#334155]">v0.1 · MVP</div>
          </div>
        </div>
      </div>

      {/* Main nav */}
      <nav className="flex-1 px-2.5 py-3 space-y-0.5">
        <p className="text-[9px] font-semibold text-[#334155] tracking-widest uppercase px-2 pb-1.5">
          Main
        </p>
        {NAV_MAIN.map((item) => (
          <NavItem
            key={item.href}
            {...item}
            active={pathname === item.href || pathname.startsWith(item.href + '/')}
          />
        ))}

        <div className="pt-3">
          <p className="text-[9px] font-semibold text-[#334155] tracking-widest uppercase px-2 pb-1.5">
            Account
          </p>
          {NAV_ACCOUNT.map((item) => (
            <NavItem
              key={item.href}
              {...item}
              active={pathname === item.href}
            />
          ))}
        </div>
      </nav>

      {/* User footer */}
      <div className="px-2.5 py-3 border-t border-[#0d1829]">
        <div className="flex items-center gap-2.5 px-2.5 py-2 rounded-md hover:bg-[#0d1829] cursor-pointer transition-colors">
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-700 to-indigo-700 flex items-center justify-center flex-shrink-0">
            <span className="text-white text-xs font-bold">M</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-semibold text-[#cbd5e1] truncate">
              Manav Ghosh
            </p>
            <p className="text-[9px] text-[#475569]">CAIO candidate</p>
          </div>
        </div>
      </div>
    </aside>
  )
}
```

- [ ] **Step 2: Create `src/components/layout/Topbar.tsx`**

```tsx
interface TopbarProps {
  title: string
  actions?: React.ReactNode
}

export function Topbar({ title, actions }: TopbarProps) {
  return (
    <header className="h-[52px] bg-[#0a1220] border-b border-[#1e2d4a] flex items-center px-6 gap-4 flex-shrink-0">
      <h1 className="text-sm font-semibold text-[#f1f5f9]">{title}</h1>
      {actions && <div className="ml-auto flex items-center gap-2.5">{actions}</div>}
    </header>
  )
}
```

- [ ] **Step 3: Install lucide-react**

```bash
npm install lucide-react
```

Expected: `lucide-react` added to `node_modules/`.

- [ ] **Step 4: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/
git commit -m "feat: add Sidebar and Topbar layout components"
```

---

## Task 3: Root layout — shell wrapper

**Files:**
- Modify: `src/app/layout.tsx`

- [ ] **Step 1: Replace `src/app/layout.tsx`**

```tsx
import type { Metadata } from 'next'
import { Sidebar } from '@/components/layout/Sidebar'
import './globals.css'

export const metadata: Metadata = {
  title: 'Proxim',
  description: 'Autonomous job hunting for senior IT professionals',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-[#060d1f] text-[#e2e8f0] antialiased">
        <div className="flex h-screen overflow-hidden">
          <Sidebar />
          <div className="flex-1 flex flex-col overflow-hidden">
            {children}
          </div>
        </div>
      </body>
    </html>
  )
}
```

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Verify the settings page still renders (sidebar should now appear)**

```bash
npm run dev
```

Open `http://localhost:3000/settings`. The dark sidebar should appear on the left. Ctrl+C to stop.

- [ ] **Step 4: Commit**

```bash
git add src/app/layout.tsx
git commit -m "feat: wrap root layout in sidebar shell"
```

---

## Task 4: Root page — redirect to /dashboard

**Files:**
- Create: `src/app/page.tsx`

- [ ] **Step 1: Create `src/app/page.tsx`**

```tsx
import { redirect } from 'next/navigation'

export default function RootPage() {
  redirect('/dashboard')
}
```

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat: redirect root to /dashboard"
```

---

## Task 5: Dashboard components — StatCard + ReadinessRing

**Files:**
- Create: `src/components/dashboard/StatCard.tsx`
- Create: `src/components/dashboard/ReadinessRing.tsx`

- [ ] **Step 1: Create `src/components/dashboard/StatCard.tsx`**

```tsx
interface StatCardProps {
  label: string
  value: string
  sub: string
  dotColor?: string
}

export function StatCard({ label, value, sub, dotColor }: StatCardProps) {
  return (
    <div className="bg-[#0d1f3c] border border-[#1e3a5f] rounded-xl p-4">
      <p className="text-[11px] font-medium text-[#60a5fa] tracking-wide mb-2">
        {label}
      </p>
      <p className="text-2xl font-bold text-[#f1f5f9] mb-1">{value}</p>
      <p className="text-[10px] text-[#475569] flex items-center gap-1.5">
        {dotColor && (
          <span
            className="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0"
            style={{ background: dotColor }}
          />
        )}
        {sub}
      </p>
    </div>
  )
}
```

- [ ] **Step 2: Create `src/components/dashboard/ReadinessRing.tsx`**

```tsx
import Link from 'next/link'
import type { PipelineReadiness } from '@/types/candidate'

interface ReadinessRingProps {
  readiness: PipelineReadiness
}

const CRITERIA = [
  'Upload and save your CV',
  'Set your target seniority level',
  'Set your geographic preference',
]

export function ReadinessRing({ readiness }: ReadinessRingProps) {
  const total = CRITERIA.length
  const met = total - readiness.missing.length
  const pct = Math.round((met / total) * 100)

  // SVG circle: r=36, circumference = 2π×36 ≈ 226.2
  const CIRC = 226.2
  const filled = (met / total) * CIRC
  const ringColor = readiness.ready ? '#10b981' : '#f59e0b'

  return (
    <div className="bg-[#0d1f3c] border border-[#1e3a5f] rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-[13px] font-semibold text-[#e2e8f0]">
          Pipeline Readiness
        </h2>
        <Link
          href="/settings"
          className="text-[11px] text-[#3b82f6] hover:text-[#60a5fa] transition-colors"
        >
          Go to Settings →
        </Link>
      </div>

      <div className="flex items-center gap-6">
        {/* SVG ring */}
        <div className="relative flex-shrink-0 w-[90px] h-[90px]">
          <svg width="90" height="90" viewBox="0 0 90 90">
            <circle
              cx="45" cy="45" r="36"
              fill="none" stroke="#1e3a5f" strokeWidth="8"
            />
            <circle
              cx="45" cy="45" r="36"
              fill="none"
              stroke={ringColor}
              strokeWidth="8"
              strokeDasharray={`${filled} ${CIRC}`}
              strokeDashoffset="57"
              strokeLinecap="round"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-lg font-bold text-[#f1f5f9]">{pct}%</span>
            <span className="text-[9px] text-[#60a5fa]">ready</span>
          </div>
        </div>

        {/* Checklist */}
        <div className="flex flex-col gap-2.5 flex-1">
          {CRITERIA.map((criterion) => {
            const done = !readiness.missing.includes(criterion)
            return (
              <div key={criterion} className="flex items-center gap-2.5 text-[12px]">
                <span
                  className={`w-[18px] h-[18px] rounded-full flex items-center justify-center text-[10px] flex-shrink-0 font-bold ${
                    done
                      ? 'bg-[#064e3b] text-[#34d399]'
                      : 'bg-[#1e2d4a] text-[#475569]'
                  }`}
                >
                  {done ? '✓' : '○'}
                </span>
                <span className={done ? 'text-[#6ee7b7]' : 'text-[#94a3b8]'}>
                  {criterion}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/dashboard/
git commit -m "feat: add StatCard and ReadinessRing dashboard components"
```

---

## Task 6: Dashboard components — ActivityFeed + ProfileCard

**Files:**
- Create: `src/components/dashboard/ActivityFeed.tsx`
- Create: `src/components/dashboard/ProfileCard.tsx`

- [ ] **Step 1: Create `src/components/dashboard/ActivityFeed.tsx`**

```tsx
import type { CandidateState } from '@/types/candidate'

interface ActivityFeedProps {
  candidate: CandidateState | null
}

function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

const DOT: Record<string, string> = {
  green: '#10b981',
  blue: '#3b82f6',
  amber: '#f59e0b',
}

interface ActivityItem {
  text: string
  color: keyof typeof DOT
  time?: string
}

export function ActivityFeed({ candidate }: ActivityFeedProps) {
  if (!candidate) {
    return (
      <div className="bg-[#0d1f3c] border border-[#1e3a5f] rounded-xl p-5">
        <h2 className="text-[13px] font-semibold text-[#e2e8f0] mb-3">
          Recent Activity
        </h2>
        <p className="text-[12px] text-[#475569]">
          No activity yet — start by uploading your CV.
        </p>
      </div>
    )
  }

  const items: ActivityItem[] = []

  if (candidate.parseStatus === 'ready') {
    items.push({ text: 'Profile parsed successfully', color: 'green', time: timeAgo(candidate.updatedAt as unknown as Date) })
  } else if (candidate.parseStatus === 'parsing') {
    items.push({ text: 'CV parsing in progress…', color: 'amber' })
  } else if (candidate.parseStatus === 'failed') {
    items.push({ text: 'CV parse failed — try re-uploading', color: 'amber' })
  }

  if (Object.keys(candidate.preferences ?? {}).length > 0) {
    items.push({ text: 'Preferences updated', color: 'blue' })
  }

  if (candidate.baseCvMd) {
    items.push({ text: 'CV saved', color: 'amber', time: timeAgo(candidate.updatedAt as unknown as Date) })
  }

  return (
    <div className="bg-[#0d1f3c] border border-[#1e3a5f] rounded-xl p-5">
      <h2 className="text-[13px] font-semibold text-[#e2e8f0] mb-4">
        Recent Activity
      </h2>

      {items.length === 0 ? (
        <p className="text-[12px] text-[#475569]">
          No activity yet — start by uploading your CV.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((item, i) => (
            <div key={i} className="flex items-start gap-2.5">
              <span
                className="w-2 h-2 rounded-full mt-1 flex-shrink-0"
                style={{ background: DOT[item.color] }}
              />
              <div>
                <p className="text-[12px] text-[#94a3b8]">{item.text}</p>
                {item.time && (
                  <p className="text-[10px] text-[#334155]">{item.time}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Create `src/components/dashboard/ProfileCard.tsx`**

```tsx
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import type { CandidateState } from '@/types/candidate'

interface ProfileCardProps {
  candidate: CandidateState | null
}

function initials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

const STATUS_STYLE: Record<string, string> = {
  ready: 'bg-[#064e3b] text-[#6ee7b7]',
  parsing: 'bg-[#1e3a5f] text-[#60a5fa]',
  pending: 'bg-[#1e2d4a] text-[#475569]',
  failed: 'bg-[#450a0a] text-[#fca5a5]',
}

const STATUS_LABEL: Record<string, string> = {
  ready: 'Parsed',
  parsing: 'Parsing…',
  pending: 'Pending',
  failed: 'Parse failed',
}

export function ProfileCard({ candidate }: ProfileCardProps) {
  if (!candidate?.parsedProfile) {
    return (
      <div className="bg-[#0d1f3c] border border-[#1e3a5f] rounded-xl p-5 flex flex-col items-center justify-center min-h-[240px] gap-3 text-center">
        <div className="w-12 h-12 rounded-xl bg-[#0a1835] border border-[#1e3a5f] flex items-center justify-center text-2xl text-[#334155]">
          ?
        </div>
        <p className="text-[12px] text-[#475569] max-w-[180px]">
          Upload your CV in Settings to populate your profile.
        </p>
        <Link
          href="/settings"
          className="text-[11px] text-[#3b82f6] hover:text-[#60a5fa] transition-colors"
        >
          Go to Settings →
        </Link>
      </div>
    )
  }

  const { parsedProfile, preferences, parseStatus } = candidate
  const name = parsedProfile.name || 'Unknown'
  const topRole = parsedProfile.roles?.[0]
  const topSkills = parsedProfile.skills?.slice(0, 6) ?? []
  const seniorityLevels = (preferences?.seniority_levels ?? []) as string[]
  const geo = (preferences?.geographic_preference as string) ?? null

  return (
    <div className="bg-[#0d1f3c] border border-[#1e3a5f] rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-[13px] font-semibold text-[#e2e8f0]">Profile</h2>
        <span
          className={`text-[10px] font-medium px-2.5 py-0.5 rounded-full ${STATUS_STYLE[parseStatus]}`}
        >
          {STATUS_LABEL[parseStatus]}
        </span>
      </div>

      {/* Avatar + name */}
      <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-700 to-indigo-700 flex items-center justify-center text-white font-bold text-lg mb-3">
        {initials(name)}
      </div>
      <p className="text-[15px] font-bold text-[#f1f5f9] mb-0.5">{name}</p>
      {topRole && (
        <p className="text-[11px] text-[#60a5fa] mb-4">
          {topRole.title} · {topRole.company}
        </p>
      )}

      <div className="h-px bg-[#1e2d4a] my-3" />

      {/* Skills */}
      {topSkills.length > 0 && (
        <>
          <p className="text-[9px] font-semibold text-[#334155] tracking-widest uppercase mb-2">
            Top Skills
          </p>
          <div className="flex flex-wrap gap-1 mb-4">
            {topSkills.map((skill) => (
              <span
                key={skill}
                className="text-[10px] bg-[#0a1835] border border-[#1e3a5f] text-[#93c5fd] px-2 py-0.5 rounded"
              >
                {skill}
              </span>
            ))}
          </div>
          <div className="h-px bg-[#1e2d4a] my-3" />
        </>
      )}

      {/* Target roles */}
      {seniorityLevels.length > 0 && (
        <>
          <p className="text-[9px] font-semibold text-[#334155] tracking-widest uppercase mb-2">
            Target Roles
          </p>
          <div className="flex flex-wrap gap-1 mb-4">
            {seniorityLevels.map((level) => (
              <span
                key={level}
                className="text-[10px] bg-[#0a1835] border border-[#1d4ed8] text-[#93c5fd] px-2 py-0.5 rounded"
              >
                {level}
              </span>
            ))}
          </div>
          <div className="h-px bg-[#1e2d4a] my-3" />
        </>
      )}

      {/* Geo */}
      {geo && (
        <>
          <p className="text-[9px] font-semibold text-[#334155] tracking-widest uppercase mb-1">
            Preference
          </p>
          <p className="text-[12px] text-[#94a3b8]">{geo}</p>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 3: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/dashboard/
git commit -m "feat: add ActivityFeed and ProfileCard dashboard components"
```

---

## Task 7: Dashboard page

**Files:**
- Create: `src/app/dashboard/page.tsx`

- [ ] **Step 1: Create `src/app/dashboard/page.tsx`**

```tsx
'use client'

import { useEffect, useState } from 'react'
import { getCV, getReadiness } from '@/lib/api'
import { Topbar } from '@/components/layout/Topbar'
import { StatCard } from '@/components/dashboard/StatCard'
import { ReadinessRing } from '@/components/dashboard/ReadinessRing'
import { ActivityFeed } from '@/components/dashboard/ActivityFeed'
import { ProfileCard } from '@/components/dashboard/ProfileCard'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import type { CandidateState, PipelineReadiness } from '@/types/candidate'

function parseStatusMeta(candidate: CandidateState | null): {
  value: string
  sub: string
  dot?: string
} {
  if (!candidate) return { value: '—', sub: 'Loading…' }
  const s = candidate.parseStatus
  if (s === 'ready') return { value: 'Ready', sub: 'Profile extracted', dot: '#10b981' }
  if (s === 'parsing') return { value: 'Parsing…', sub: 'In progress', dot: '#f59e0b' }
  if (s === 'failed') return { value: 'Failed', sub: 'Re-upload CV', dot: '#ef4444' }
  return { value: 'Pending', sub: 'No CV yet', dot: '#475569' }
}

function pipelineMeta(readiness: PipelineReadiness | null): {
  value: string
  sub: string
  dot?: string
} {
  if (!readiness) return { value: '—', sub: 'Loading…' }
  if (readiness.ready) return { value: 'Ready', sub: 'All criteria met', dot: '#10b981' }
  const n = readiness.missing.length
  return { value: 'Not ready', sub: `${n} item${n > 1 ? 's' : ''} missing`, dot: '#f59e0b' }
}

export default function DashboardPage() {
  const [candidate, setCandidate] = useState<CandidateState | null>(null)
  const [readiness, setReadiness] = useState<PipelineReadiness | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([getCV(), getReadiness()])
      .then(([cv, r]) => {
        setCandidate(cv)
        setReadiness(r)
      })
      .finally(() => setLoading(false))
  }, [])

  const cvMeta = parseStatusMeta(candidate)
  const pMeta = pipelineMeta(readiness)

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <Topbar
        title="Dashboard"
        actions={
          <Button size="sm" className="text-xs">
            ▶ Run Pipeline
          </Button>
        }
      />

      <main className="flex-1 overflow-y-auto p-6 bg-[#0d1829]">
        {loading ? (
          <div className="space-y-4">
            <div className="grid grid-cols-4 gap-4">
              {[...Array(4)].map((_, i) => (
                <Skeleton key={i} className="h-[88px] rounded-xl bg-[#0d1f3c]" />
              ))}
            </div>
            <Skeleton className="h-[200px] rounded-xl bg-[#0d1f3c]" />
          </div>
        ) : (
          <>
            {/* Stat row */}
            <div className="grid grid-cols-4 gap-4 mb-5">
              <StatCard
                label="Pipeline Status"
                value={pMeta.value}
                sub={pMeta.sub}
                dotColor={pMeta.dot}
              />
              <StatCard
                label="CV Parse"
                value={cvMeta.value}
                sub={cvMeta.sub}
                dotColor={cvMeta.dot}
              />
              <StatCard
                label="Jobs Matched"
                value="—"
                sub="Pipeline not active"
              />
              <StatCard
                label="Applications"
                value="—"
                sub="None sent yet"
              />
            </div>

            {/* Main grid */}
            <div className="grid grid-cols-[1fr_320px] gap-4">
              <div className="flex flex-col gap-4">
                {readiness && <ReadinessRing readiness={readiness} />}
                <ActivityFeed candidate={candidate} />
              </div>
              <ProfileCard candidate={candidate} />
            </div>
          </>
        )}
      </main>
    </div>
  )
}
```

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Verify Dashboard renders in browser**

```bash
npm run dev
```

Open `http://localhost:3000`. You should be redirected to `/dashboard`. Verify:
- Dark sidebar on left with nav items
- 4 stat cards row
- Readiness ring with checklist
- Activity feed and profile card

Ctrl+C to stop.

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboard/
git commit -m "feat: add Dashboard page with stat cards, readiness ring, activity and profile"
```

---

## Task 8: Settings page reskin

**Files:**
- Modify: `src/app/settings/page.tsx`

- [ ] **Step 1: Replace `src/app/settings/page.tsx`**

Keep all existing logic (state, handlers, API calls) — only change the JSX structure and classNames:

```tsx
'use client'

import { useEffect, useState } from 'react'
import { getCV, getReadiness } from '@/lib/api'
import { Topbar } from '@/components/layout/Topbar'
import { CVUploader } from '@/components/cv/CVUploader'
import { MarkdownEditor } from '@/components/cv/MarkdownEditor'
import { ParseStatusBadge } from '@/components/cv/ParseStatusBadge'
import { PreferencesForm } from '@/components/preferences/PreferencesForm'
import type { CandidateState, Preferences, PipelineReadiness } from '@/types/candidate'

export default function SettingsPage() {
  const [candidate, setCandidate] = useState<CandidateState | null>(null)
  const [readiness, setReadiness] = useState<PipelineReadiness | null>(null)
  const [convertedMarkdown, setConvertedMarkdown] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  async function refresh() {
    const [cv, r] = await Promise.all([getCV(), getReadiness()])
    setCandidate(cv)
    setReadiness(r)
  }

  useEffect(() => {
    refresh().finally(() => setLoading(false))
  }, [])

  function handleConverted(markdown: string) {
    setConvertedMarkdown(markdown)
  }

  function handleCVSaved(updated: CandidateState) {
    setCandidate(updated)
    setConvertedMarkdown(null)
    void refresh()
  }

  function handlePreferencesSaved(prefs: Preferences) {
    if (candidate) setCandidate({ ...candidate, preferences: prefs })
    void refresh()
  }

  if (loading) {
    return (
      <div className="flex flex-col flex-1 overflow-hidden">
        <Topbar title="Settings" />
        <div className="flex-1 flex items-center justify-center bg-[#0d1829]">
          <p className="text-[#475569] text-sm">Loading…</p>
        </div>
      </div>
    )
  }

  const markdownToEdit = convertedMarkdown ?? candidate?.baseCvMd

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <Topbar title="Settings" />

      <main className="flex-1 overflow-y-auto p-6 bg-[#0d1829]">
        <div className="grid grid-cols-[2fr_1fr] gap-6 max-w-6xl">

          {/* CV section */}
          <section className="bg-[#0d1f3c] border border-[#1e3a5f] rounded-xl p-5 space-y-4">
            <div className="flex items-center gap-3">
              <p className="text-[9px] font-semibold text-[#334155] tracking-widest uppercase">
                CV
              </p>
              {candidate && (
                <ParseStatusBadge initialStatus={candidate.parseStatus} />
              )}
            </div>

            <CVUploader onConverted={handleConverted} />

            {markdownToEdit ? (
              <MarkdownEditor
                initialMarkdown={markdownToEdit}
                onSaved={handleCVSaved}
              />
            ) : (
              candidate?.baseCvMd && (
                <p className="text-sm text-[#475569]">
                  CV saved. Upload a new file to replace it.
                </p>
              )
            )}
          </section>

          {/* Preferences section */}
          <section className="bg-[#0d1f3c] border border-[#1e3a5f] rounded-xl p-5 space-y-4">
            <p className="text-[9px] font-semibold text-[#334155] tracking-widest uppercase">
              Preferences
            </p>
            <PreferencesForm
              initialPreferences={candidate?.preferences ?? {}}
              onSaved={handlePreferencesSaved}
            />
          </section>

        </div>
      </main>
    </div>
  )
}
```

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Verify settings page in browser**

```bash
npm run dev
```

Open `http://localhost:3000/settings`. Verify:
- Dark card layout (CV left 2/3, Preferences right 1/3)
- CV upload and Markdown editor still work
- ParseStatusBadge visible next to "CV" label

Ctrl+C to stop.

- [ ] **Step 4: Commit**

```bash
git add src/app/settings/page.tsx
git commit -m "feat: reskin Settings page with dark two-column card layout"
```

---

## Task 9: Placeholder pages — PlaceholderPage + /pipeline + /applications

**Files:**
- Create: `src/components/shared/PlaceholderPage.tsx`
- Create: `src/app/pipeline/page.tsx`
- Create: `src/app/applications/page.tsx`

- [ ] **Step 1: Create `src/components/shared/PlaceholderPage.tsx`**

```tsx
import Link from 'next/link'
import { Topbar } from '@/components/layout/Topbar'
import { Button } from '@/components/ui/button'
import type { LucideIcon } from 'lucide-react'

interface PlaceholderPageProps {
  title: string
  icon: LucideIcon
  heading: string
  body: string
  ctaLabel: string
  ctaHref: string
}

export function PlaceholderPage({
  title,
  icon: Icon,
  heading,
  body,
  ctaLabel,
  ctaHref,
}: PlaceholderPageProps) {
  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <Topbar title={title} />
      <main className="flex-1 flex items-center justify-center bg-[#0d1829]">
        <div className="text-center max-w-md space-y-5">
          <div className="w-16 h-16 rounded-2xl bg-[#0d1f3c] border border-[#1e3a5f] flex items-center justify-center mx-auto">
            <Icon className="w-7 h-7 text-[#334155]" />
          </div>
          <div className="space-y-2">
            <h2 className="text-lg font-semibold text-[#e2e8f0]">{heading}</h2>
            <p className="text-sm text-[#64748b] leading-relaxed">{body}</p>
          </div>
          <Button asChild variant="outline" size="sm" className="border-[#1e3a5f] text-[#60a5fa] hover:bg-[#0d1f3c]">
            <Link href={ctaHref}>{ctaLabel}</Link>
          </Button>
        </div>
      </main>
    </div>
  )
}
```

- [ ] **Step 2: Create `src/app/pipeline/page.tsx`**

```tsx
import { Workflow } from 'lucide-react'
import { PlaceholderPage } from '@/components/shared/PlaceholderPage'

export default function PipelinePage() {
  return (
    <PlaceholderPage
      title="Pipeline"
      icon={Workflow}
      heading="Pipeline — Coming in Phase 2"
      body="Once your profile is ready, Proxim will automatically search for matching roles, score them against your preferences, and surface the best opportunities here."
      ctaLabel="Complete your profile"
      ctaHref="/settings"
    />
  )
}
```

- [ ] **Step 3: Create `src/app/applications/page.tsx`**

```tsx
import { Send } from 'lucide-react'
import { PlaceholderPage } from '@/components/shared/PlaceholderPage'

export default function ApplicationsPage() {
  return (
    <PlaceholderPage
      title="Applications"
      icon={Send}
      heading="Applications — Coming in Phase 2"
      body="When Proxim identifies strong matches and you approve them, your applications will be tracked here — status, responses, and next steps."
      ctaLabel="View Pipeline"
      ctaHref="/pipeline"
    />
  )
}
```

- [ ] **Step 4: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 5: Verify all placeholder pages**

```bash
npm run dev
```

- Open `http://localhost:3000/pipeline` — should show Workflow icon, "Coming in Phase 2" message, "Complete your profile" button
- Open `http://localhost:3000/applications` — should show Send icon, "Coming in Phase 2" message, "View Pipeline" button
- Sidebar should highlight the correct nav item on each page

Ctrl+C to stop.

- [ ] **Step 6: Commit**

```bash
git add src/components/shared/PlaceholderPage.tsx src/app/pipeline/ src/app/applications/
git commit -m "feat: add Pipeline and Applications placeholder pages"
```

---

## Task 10: Final verification

**Files:** None created.

- [ ] **Step 1: Run full unit test suite**

```bash
npm run test:run
```

Expected: All 26 tests pass. The reskin touches no service logic so existing tests must be unaffected.

- [ ] **Step 2: TypeScript full check**

```bash
npx tsc --noEmit
```

Expected: Zero errors.

- [ ] **Step 3: Start dev server and run Playwright smoke test**

```bash
npm run dev &
sleep 5
python scripts/smoke_test_settings.py
```

Expected: 6/6 checks pass (the existing smoke test covers `/settings` functionality).

- [ ] **Step 4: Manual navigation check**

Open `http://localhost:3000` and verify:
- [ ] Redirects to `/dashboard`
- [ ] Dashboard renders: stat cards, readiness ring, activity feed, profile card
- [ ] Sidebar `Dashboard` item is highlighted on `/dashboard`
- [ ] Clicking `Pipeline` in sidebar → placeholder page, `Pipeline` highlighted
- [ ] Clicking `Applications` → placeholder page, `Applications` highlighted
- [ ] Clicking `Settings` → settings page, `Settings` highlighted, CV and preferences work
- [ ] Navigating back to `/dashboard` updates the active nav item

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: UI redesign complete — dark navy shell, Dashboard, reskinned Settings, placeholder pages"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| Deep navy dark theme (`#060d1f` base, CSS variables) | Task 1 |
| Named sidebar 220 px, logo, nav sections, user footer | Task 2 |
| Active route highlight via `usePathname` | Task 2 |
| Pipeline/Applications as real links to placeholder screens | Task 9 |
| `soon` labels in sidebar | Task 2 |
| Root layout flex shell, server component | Task 3 |
| Topbar per-page with title + actions | Task 2, each page task |
| Root `/` redirects to `/dashboard` | Task 4 |
| Dashboard: 4 stat cards | Task 5, 7 |
| Dashboard: readiness ring with % and checklist | Task 5, 7 |
| Dashboard: activity feed derived from candidate record | Task 6, 7 |
| Dashboard: profile card from `parsedProfile` | Task 6, 7 |
| Dashboard: skeleton loader while fetching | Task 7 |
| Dashboard: parallel fetch `Promise.all` | Task 7 |
| Settings: two-column card layout (2/3 CV, 1/3 prefs) | Task 8 |
| Settings: all existing components unchanged | Task 8 |
| Pipeline placeholder — correct copy + CTA | Task 9 |
| Applications placeholder — correct copy + CTA | Task 9 |
| Skeleton + Separator shadcn components installed | Task 1 |
| TypeScript zero errors | Task 10 |
| All 26 unit tests pass | Task 10 |

**No gaps found.**

**Placeholder scan:** No TBDs, TODOs, or "implement later" in any task.

**Type consistency:**
- `CandidateState` and `PipelineReadiness` from `@/types/candidate` — used consistently across Tasks 5–8
- `getCV()` returns `CandidateState`, `getReadiness()` returns `PipelineReadiness` — both from `@/lib/api`, used correctly
- `parsedProfile.roles[0]` accessed with optional chaining in `ProfileCard` — safe
- `preferences.seniority_levels` cast to `string[]` with fallback `[]` — safe
