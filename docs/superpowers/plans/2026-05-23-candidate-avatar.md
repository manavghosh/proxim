# Candidate Avatar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-candidate avatar photo that is uploaded in the settings page and rendered next to the candidate's name in the sidebar, topbar switcher, and dashboard profile card.

**Architecture:** A base64 data URL is stored in a new `avatar_data` column on the `candidates` table (works for both SQLite dev and Neon prod). A new shared `CandidateAvatar` component wraps the shadcn Avatar primitive and is dropped into the three existing display locations. The settings page gains an `AvatarUploadSection` component that handles client-side canvas resizing, PATCH to the API, and an optimistic update.

**Tech Stack:** Next.js 15, Drizzle ORM (Postgres + SQLite), shadcn/ui (radix-ui), Tailwind CSS v4, Vitest + Testing Library

---

## File Map

| File | Action |
|---|---|
| `src/components/ui/avatar.tsx` | **Create** — shadcn Avatar primitive (Root / Image / Fallback) |
| `src/components/shared/CandidateAvatar.tsx` | **Create** — reusable avatar with initials fallback |
| `src/components/settings/AvatarUploadSection.tsx` | **Create** — upload + remove UI for settings page |
| `src/__tests__/components/shared/CandidateAvatar.test.tsx` | **Create** — TDD tests |
| `src/__tests__/components/settings/AvatarUploadSection.test.tsx` | **Create** — TDD tests |
| `src/db/schema.ts` | **Modify** — add `avatarData: text('avatar_data')` |
| `src/db/schema.sqlite.ts` | **Modify** — add `avatarData: text('avatar_data')` |
| `migrations/XXXX_*.sql` | **Generate** via db:generate (Postgres) |
| `migrations/sqlite/XXXX_*.sql` | **Generate** via db:generate:sqlite |
| `src/types/candidate.ts` | **Modify** — add `avatarData` to `CandidateState` |
| `src/lib/api.ts` | **Modify** — add `avatarData` to `CandidateSummary`; add `updateCandidateAvatar` fn |
| `src/app/api/candidates/[id]/route.ts` | **Modify** — PATCH accepts `avatarData` |
| `src/app/api/candidates/route.ts` | **Modify** — GET returns `avatarData` per candidate |
| `src/app/candidates/[id]/layout.tsx` | **Modify** — select + pass `avatarData` to sidebar |
| `src/components/layout/CandidateSidebar.tsx` | **Modify** — accept + render `CandidateAvatar` |
| `src/components/layout/CandidateSwitcher.tsx` | **Modify** — render `CandidateAvatar` per candidate row |
| `src/components/dashboard/ProfileCard.tsx` | **Modify** — replace initials div with `CandidateAvatar` |
| `src/app/candidates/[id]/settings/page.tsx` | **Modify** — add `AvatarUploadSection` at top of right column |

---

## Task 1: Add shadcn Avatar UI primitive

**Files:**
- Create: `src/components/ui/avatar.tsx`

This follows the same pattern as the other `src/components/ui/` components — imports from `radix-ui`, uses `cn()`.

- [ ] **Step 1: Create `src/components/ui/avatar.tsx`**

```tsx
'use client'

import * as React from 'react'
import { Avatar } from 'radix-ui'
import { cn } from '@/lib/utils'

function AvatarRoot({
  className,
  ...props
}: React.ComponentProps<typeof Avatar.Root>) {
  return (
    <Avatar.Root
      data-slot="avatar"
      className={cn(
        'relative flex shrink-0 overflow-hidden rounded-full',
        className
      )}
      {...props}
    />
  )
}

function AvatarImage({
  className,
  ...props
}: React.ComponentProps<typeof Avatar.Image>) {
  return (
    <Avatar.Image
      data-slot="avatar-image"
      className={cn('aspect-square h-full w-full object-cover', className)}
      {...props}
    />
  )
}

function AvatarFallback({
  className,
  ...props
}: React.ComponentProps<typeof Avatar.Fallback>) {
  return (
    <Avatar.Fallback
      data-slot="avatar-fallback"
      className={cn(
        'flex h-full w-full items-center justify-center rounded-full bg-gradient-to-br from-blue-700 to-indigo-700 text-white font-bold',
        className
      )}
      {...props}
    />
  )
}

export { AvatarRoot as Avatar, AvatarImage, AvatarFallback }
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ui/avatar.tsx
git commit -m "feat: add shadcn Avatar UI primitive"
```

---

## Task 2: Extend DB schemas + generate migrations

**Files:**
- Modify: `src/db/schema.ts:76-91`
- Modify: `src/db/schema.sqlite.ts:69-81`

- [ ] **Step 1: Add column to Postgres schema (`src/db/schema.ts`)**

In the `candidates` table definition, add after `updatedAt`:

```ts
export const candidates = pgTable('candidates', {
  id: uuid().defaultRandom().primaryKey(),
  name: varchar({ length: 255 }).default('New Candidate').notNull(),
  candidateId: uuid(),
  baseCvMd: text(),
  baseCvHash: varchar({ length: 64 }),
  baseResumePdfPath: text(),
  parsedProfile: jsonb().$type<ParsedProfile>(),
  parseStatus: parseStatusEnum().default('pending').notNull(),
  preferences: jsonb().$type<Preferences>().default({}).notNull(),
  avatarData: text('avatar_data'),              // ← new
  createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp({ withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdateFn(() => new Date()),
})
```

- [ ] **Step 2: Add column to SQLite schema (`src/db/schema.sqlite.ts`)**

```ts
export const candidates = sqliteTable('candidates', {
  id:             text().primaryKey().$defaultFn(newId),
  name:           text().default('New Candidate').notNull(),
  candidateId:    text(),
  baseCvMd:       text(),
  baseCvHash:     text(),
  parsedProfile:  text({ mode: 'json' }).$type<ParsedProfile | null>(),
  parseStatus:    text().default('pending').notNull(),
  preferences:    text({ mode: 'json' }).$type<Preferences>().default({} as Preferences).notNull(),
  baseResumePdfPath: text(),
  avatarData:     text('avatar_data'),          // ← new
  createdAt:      text().$defaultFn(now).notNull(),
  updatedAt:      text().$defaultFn(now).$onUpdateFn(now).notNull(),
})
```

- [ ] **Step 3: Generate and apply SQLite migration**

```bash
npm run db:generate:sqlite
npm run db:migrate:sqlite
```

Expected: a new file `migrations/sqlite/XXXX_*.sql` containing `ALTER TABLE candidates ADD avatar_data text;`

- [ ] **Step 4: Generate Postgres migration (for Neon)**

```bash
npm run db:generate
```

Expected: a new file `migrations/XXXX_*.sql` containing `ALTER TABLE "candidates" ADD COLUMN "avatar_data" text;`

> **Note on Neon migration:** `npm run db:migrate` connects to `DATABASE_URL` from `.env.local`. Only run this when connected to a Neon DB or set `DATABASE_URL` appropriately. The migration SQL file is generated regardless and is committed to the repo for production use.

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.ts src/db/schema.sqlite.ts migrations/
git commit -m "feat: add avatar_data column to candidates table"
```

---

## Task 3: Update TypeScript types

**Files:**
- Modify: `src/types/candidate.ts:118-126`
- Modify: `src/lib/api.ts:27-34`

- [ ] **Step 1: Add `avatarData` to `CandidateState`**

In `src/types/candidate.ts`, update `CandidateState`:

```ts
export interface CandidateState {
  id: string
  name: string
  baseCvMd: string | null
  baseCvHash: string | null
  parseStatus: ParseStatus
  parsedProfile: ParsedProfile | null
  preferences: Preferences
  avatarData: string | null
}
```

- [ ] **Step 2: Add `avatarData` to `CandidateSummary` and add `updateCandidateAvatar` in `src/lib/api.ts`**

Update `CandidateSummary`:

```ts
export interface CandidateSummary {
  id: string
  name: string
  parseStatus: string
  jobsMatched: number
  applications: number
  createdAt: string
  avatarData: string | null
}
```

Add the new API function after `updateCandidateName`:

```ts
export async function updateCandidateAvatar(
  id: string,
  avatarData: string | null
): Promise<void> {
  return request(`/api/candidates/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ avatarData }),
  })
}
```

- [ ] **Step 3: Run TypeScript check**

```bash
npx tsc --noEmit
```

Expected: errors from `CandidateState` consumers that don't yet pass `avatarData` — these will be fixed in subsequent tasks. If errors are only in test files, they are fine to leave until Task 5.

- [ ] **Step 4: Commit**

```bash
git add src/types/candidate.ts src/lib/api.ts
git commit -m "feat: add avatarData to CandidateState and CandidateSummary types"
```

---

## Task 4: Create `CandidateAvatar` shared component (TDD)

**Files:**
- Create: `src/__tests__/components/shared/CandidateAvatar.test.tsx`
- Create: `src/components/shared/CandidateAvatar.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/components/shared/CandidateAvatar.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CandidateAvatar } from '@/components/shared/CandidateAvatar'

describe('CandidateAvatar', () => {
  it('renders initials from a two-word name when no avatarData', () => {
    render(<CandidateAvatar name="Manav Ghosh" />)
    expect(screen.getByText('MG')).toBeInTheDocument()
  })

  it('renders first two chars of a single-word name when no avatarData', () => {
    render(<CandidateAvatar name="Manav" />)
    expect(screen.getByText('MA')).toBeInTheDocument()
  })

  it('renders an img element when avatarData is provided', () => {
    const dataUrl = 'data:image/jpeg;base64,abc123'
    render(<CandidateAvatar name="Manav Ghosh" avatarData={dataUrl} />)
    const img = screen.getByRole('img')
    expect(img).toHaveAttribute('src', dataUrl)
  })

  it('applies sm size class (20px) when size is sm', () => {
    const { container } = render(<CandidateAvatar name="MG" size="sm" />)
    const root = container.firstChild as HTMLElement
    expect(root.className).toContain('h-5')
    expect(root.className).toContain('w-5')
  })

  it('applies md size class (28px) when size is md', () => {
    const { container } = render(<CandidateAvatar name="MG" size="md" />)
    const root = container.firstChild as HTMLElement
    expect(root.className).toContain('h-7')
    expect(root.className).toContain('w-7')
  })

  it('applies lg size class (64px) when size is lg', () => {
    const { container } = render(<CandidateAvatar name="MG" size="lg" />)
    const root = container.firstChild as HTMLElement
    expect(root.className).toContain('h-16')
    expect(root.className).toContain('w-16')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/__tests__/components/shared/CandidateAvatar.test.tsx
```

Expected: all 6 tests FAIL with "Cannot find module '@/components/shared/CandidateAvatar'"

- [ ] **Step 3: Create `src/components/shared/CandidateAvatar.tsx`**

```tsx
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'

const SIZE: Record<string, string> = {
  sm: 'h-5 w-5 text-[8px]',
  md: 'h-7 w-7 text-[10px]',
  lg: 'h-16 w-16 text-xl',
}

function getInitials(name: string): string {
  const words = name.trim().split(/\s+/)
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

interface CandidateAvatarProps {
  name: string
  avatarData?: string | null
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

export function CandidateAvatar({
  name,
  avatarData,
  size = 'md',
  className,
}: CandidateAvatarProps) {
  return (
    <Avatar className={cn(SIZE[size], className)}>
      {avatarData && <AvatarImage src={avatarData} alt={name} />}
      <AvatarFallback>{getInitials(name)}</AvatarFallback>
    </Avatar>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/__tests__/components/shared/CandidateAvatar.test.tsx
```

Expected: all 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/shared/CandidateAvatar.tsx src/__tests__/components/shared/CandidateAvatar.test.tsx
git commit -m "feat: add CandidateAvatar shared component"
```

---

## Task 5: Extend API routes to persist and serve `avatarData`

**Files:**
- Modify: `src/app/api/candidates/[id]/route.ts`
- Modify: `src/app/api/candidates/route.ts`

The `GET /api/cv` route calls `getCandidateById()` which does `db.select().from(candidates)` (all columns), so it will automatically include `avatarData` once the schema is updated — no change needed there.

- [ ] **Step 1: Extend PATCH `/api/candidates/[id]` to accept `avatarData`**

Replace the entire file `src/app/api/candidates/[id]/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { candidates } from '@/db/schema'

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json() as { name?: string; avatarData?: string | null }

    const updates: { name?: string; avatarData?: string | null } = {}

    if (body.name !== undefined) {
      const name = body.name.trim()
      if (!name) return NextResponse.json({ error: 'name cannot be empty' }, { status: 400 })
      updates.name = name
    }

    if (body.avatarData !== undefined) {
      updates.avatarData = body.avatarData
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
    }

    const [updated] = await db
      .update(candidates)
      .set(updates)
      .where(eq(candidates.id, id))
      .returning({ id: candidates.id, name: candidates.name, avatarData: candidates.avatarData })

    if (!updated) return NextResponse.json({ error: 'Candidate not found' }, { status: 404 })
    return NextResponse.json(updated)
  } catch (e) {
    console.error('[/api/candidates/[id]] PATCH error:', e)
    return NextResponse.json({ error: 'Failed to update candidate' }, { status: 500 })
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    await db.delete(candidates).where(eq(candidates.id, id))
    return NextResponse.json({ deleted: true })
  } catch (e) {
    console.error('[/api/candidates/[id]] DELETE error:', e)
    return NextResponse.json({ error: 'Failed to delete candidate' }, { status: 500 })
  }
}
```

- [ ] **Step 2: Return `avatarData` from `GET /api/candidates`**

In `src/app/api/candidates/route.ts`, add `avatarData` to the select:

```ts
const allCandidates = await db
  .select({
    id:          candidates.id,
    name:        candidates.name,
    parseStatus: candidates.parseStatus,
    createdAt:   candidates.createdAt,
    avatarData:  candidates.avatarData,
  })
  .from(candidates)
  .orderBy(desc(candidates.createdAt))
```

And update the `summaries` map to include it:

```ts
return {
  ...c,
  jobsMatched:  Number(matchedRow?.count ?? 0),
  applications: Number(approvedRow?.count ?? 0),
}
```

(The spread of `c` already includes `avatarData` since it's in the select above.)

- [ ] **Step 3: Run TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no new errors

- [ ] **Step 4: Commit**

```bash
git add src/app/api/candidates/[id]/route.ts src/app/api/candidates/route.ts
git commit -m "feat: persist and serve avatarData through candidates API"
```

---

## Task 6: Wire `avatarData` into the sidebar

**Files:**
- Modify: `src/app/candidates/[id]/layout.tsx`
- Modify: `src/components/layout/CandidateSidebar.tsx`

- [ ] **Step 1: Select `avatarData` in the candidate layout and pass it to the sidebar**

Replace `src/app/candidates/[id]/layout.tsx`:

```tsx
import type { ReactNode } from 'react'
import { CandidateSidebar } from '@/components/layout/CandidateSidebar'
import { db } from '@/db'
import { candidates } from '@/db/schema'
import { eq } from 'drizzle-orm'

export default async function CandidateLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const [candidate] = await db
    .select({ id: candidates.id, name: candidates.name, avatarData: candidates.avatarData })
    .from(candidates)
    .where(eq(candidates.id, id))
    .limit(1)

  const name = candidate?.name ?? 'Candidate'
  const avatarData = candidate?.avatarData ?? null

  return (
    <div className="flex h-screen overflow-hidden">
      <CandidateSidebar candidateId={id} candidateName={name} avatarData={avatarData} />
      <div className="flex-1 flex flex-col overflow-hidden">
        {children}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Update `CandidateSidebar` to accept `avatarData` and render `CandidateAvatar`**

Replace `src/components/layout/CandidateSidebar.tsx`:

```tsx
'use client'

import type { LucideIcon } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Workflow, Send, Settings, ChevronLeft } from 'lucide-react'
import { CandidateAvatar } from '@/components/shared/CandidateAvatar'

function NavItem({
  href,
  label,
  icon: Icon,
  soon,
  active,
}: {
  href: string
  label: string
  icon: LucideIcon
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
      {soon && <span className="text-[10px] text-[#334155] font-medium">soon</span>}
    </Link>
  )
}

export function CandidateSidebar({
  candidateId,
  candidateName,
  avatarData,
}: {
  candidateId: string
  candidateName: string
  avatarData: string | null
}) {
  const pathname = usePathname()
  const base = `/candidates/${candidateId}`

  const NAV_MAIN = [
    { href: `${base}/dashboard`,    label: 'Dashboard',    icon: LayoutDashboard },
    { href: `${base}/pipeline`,     label: 'Pipeline',     icon: Workflow },
    { href: `${base}/applications`, label: 'Applications', icon: Send },
  ]
  const NAV_ACCOUNT = [
    { href: `${base}/settings`, label: 'Settings', icon: Settings },
  ]

  return (
    <aside className="w-[220px] bg-[#060d1f] border-r border-[#1e2d4a] flex flex-col flex-shrink-0 h-screen">
      {/* Logo + back */}
      <div className="px-4 py-5 border-b border-[#0d1829]">
        <Link
          href="/"
          aria-label="Proxim — back to all candidates"
          className="flex items-center gap-2.5 rounded-md transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center flex-shrink-0">
            <span className="text-white text-xs font-bold">P</span>
          </div>
          <div className="text-[13px] font-bold text-[#f1f5f9] tracking-widest flex-1">PROXIM</div>
        </Link>
        <Link
          href="/"
          className="mt-3 flex items-center gap-1 text-[10px] text-[#475569] hover:text-[#94a3b8] transition-colors"
        >
          <ChevronLeft className="w-3 h-3" />
          All Candidates
        </Link>
      </div>

      {/* Main nav */}
      <nav className="flex-1 px-2.5 py-3 space-y-0.5">
        <p className="text-[9px] font-semibold text-[#334155] tracking-widest uppercase px-2 pb-1.5">Main</p>
        {NAV_MAIN.map((item) => (
          <NavItem
            key={item.href}
            {...item}
            active={pathname === item.href || pathname.startsWith(item.href + '/')}
          />
        ))}
        <div className="pt-3">
          <p className="text-[9px] font-semibold text-[#334155] tracking-widest uppercase px-2 pb-1.5">Account</p>
          {NAV_ACCOUNT.map((item) => (
            <NavItem key={item.href} {...item} active={pathname === item.href} />
          ))}
        </div>
      </nav>

      {/* Candidate footer */}
      <div className="px-2.5 py-3 border-t border-[#0d1829]">
        <div className="flex items-center gap-2.5 px-2.5 py-2 rounded-md hover:bg-[#0d1829] cursor-pointer transition-colors">
          <CandidateAvatar name={candidateName} avatarData={avatarData} size="md" />
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-semibold text-[#cbd5e1] truncate">{candidateName}</p>
            <p className="text-[9px] text-[#475569]">Candidate</p>
          </div>
        </div>
      </div>
    </aside>
  )
}
```

- [ ] **Step 3: Run TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/app/candidates/[id]/layout.tsx src/components/layout/CandidateSidebar.tsx
git commit -m "feat: show CandidateAvatar in sidebar footer"
```

---

## Task 7: Wire `CandidateAvatar` into `CandidateSwitcher`

**Files:**
- Modify: `src/components/layout/CandidateSwitcher.tsx`

`CandidateSwitcher` already fetches `CandidateSummary[]` which now includes `avatarData`. Replace the `UsersIcon` in the trigger button with a `CandidateAvatar`, and add `CandidateAvatar` to each dropdown row.

- [ ] **Step 1: Update `CandidateSwitcher`**

Replace `src/components/layout/CandidateSwitcher.tsx`:

```tsx
'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { ChevronDownIcon } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { CandidateAvatar } from '@/components/shared/CandidateAvatar'
import { getCandidates, type CandidateSummary } from '@/lib/api'

interface Props {
  candidateId: string
}

export function CandidateSwitcher({ candidateId }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const [candidates, setCandidates] = useState<CandidateSummary[] | null>(null)

  useEffect(() => {
    getCandidates()
      .then(({ candidates: list }) => setCandidates(list))
      .catch(() => setCandidates([]))
  }, [])

  const section = pathname.match(/\/candidates\/[^/]+\/([^/?#]+)/)?.[1] ?? 'dashboard'

  const current = candidates?.find((c) => c.id === candidateId)
  const currentName = current?.name ?? 'Candidate'
  const hasMultiple = (candidates?.length ?? 0) > 1

  const trigger = (
    <button
      type="button"
      className={`flex items-center gap-2 rounded-lg border border-[#1e2d4a] bg-[#0d1f3c] px-3 py-1.5 text-xs font-medium text-[#94a3b8] transition-colors focus:outline-none ${
        hasMultiple
          ? 'hover:border-[#2d4a6e] hover:text-[#e2e8f0] cursor-pointer'
          : 'cursor-default'
      }`}
      aria-label={`Current candidate: ${currentName}`}
    >
      <CandidateAvatar
        name={currentName}
        avatarData={current?.avatarData ?? null}
        size="sm"
      />
      <span className="text-[#e2e8f0] max-w-[160px] truncate">{currentName}</span>
      {hasMultiple && <ChevronDownIcon className="size-3 text-[#475569]" />}
    </button>
  )

  if (!hasMultiple) return trigger

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent className="w-56" align="end">
        <DropdownMenuLabel>Switch Candidate</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {candidates?.map((c) => (
          <DropdownMenuItem
            key={c.id}
            onClick={() => router.push(`/candidates/${c.id}/${section}`)}
            className={c.id === candidateId ? 'text-[#93c5fd]' : ''}
          >
            <CandidateAvatar name={c.name} avatarData={c.avatarData ?? null} size="sm" />
            <span className="flex-1 truncate">{c.name}</span>
            {c.id === candidateId && (
              <span className="text-[10px] text-[#475569] ml-2">current</span>
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
```

- [ ] **Step 2: Run TypeScript check + tests**

```bash
npx tsc --noEmit && npm run test:run
```

Expected: no type errors, no test failures

- [ ] **Step 3: Commit**

```bash
git add src/components/layout/CandidateSwitcher.tsx
git commit -m "feat: show CandidateAvatar in topbar candidate switcher"
```

---

## Task 8: Wire `CandidateAvatar` into `ProfileCard`

**Files:**
- Modify: `src/components/dashboard/ProfileCard.tsx`

`ProfileCard` receives `candidate: CandidateState` which now has `avatarData`. Replace the `w-12 h-12 gradient` div with `CandidateAvatar`.

- [ ] **Step 1: Update `ProfileCard`**

Replace the avatar div (lines 75–78 in the original):

```tsx
import Link from 'next/link'
import type { CandidateState } from '@/types/candidate'
import { CandidateAvatar } from '@/components/shared/CandidateAvatar'

// ... (keep STATUS_STYLE, STATUS_LABEL, ProfileCardProps, early-return identical)

  // Replace this block:
  //   <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-700 to-indigo-700 ...">
  //     {initials(name)}
  //   </div>
  // With:
  <CandidateAvatar
    name={name}
    avatarData={candidate.avatarData}
    size="lg"
    className="rounded-xl mb-3"
  />
```

The full updated `ProfileCard` function body (after the early-return null check):

```tsx
export function ProfileCard({ candidate, candidateId }: ProfileCardProps) {
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
          href={`/candidates/${candidateId}/settings`}
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
  const rawGeo = preferences?.geographic_preference
  const geoPrefs: string[] = Array.isArray(rawGeo)
    ? rawGeo
    : typeof rawGeo === 'string' && rawGeo
      ? [rawGeo]
      : []

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

      <CandidateAvatar
        name={name}
        avatarData={candidate.avatarData}
        size="lg"
        className="rounded-xl mb-3"
      />
      <p className="text-[15px] font-bold text-[#f1f5f9] mb-0.5">{name}</p>
      {topRole && (
        <p className="text-[11px] text-[#60a5fa] mb-4">
          {topRole.title} · {topRole.company}
        </p>
      )}

      <div className="h-px bg-[#1e2d4a] my-3" />

      {topSkills.length > 0 && (
        <>
          <p className="text-[9px] font-semibold text-[#475569] tracking-widest uppercase mb-2">
            Top Skills
          </p>
          <div className="flex flex-wrap gap-1.5 mb-4">
            {topSkills.map((skill) => (
              <span
                key={skill}
                className="text-[10px] bg-teal-950/60 border border-teal-800/30 text-teal-300 px-2 py-0.5 rounded-md"
              >
                {skill}
              </span>
            ))}
          </div>
          <div className="h-px bg-[#1e2d4a] my-3" />
        </>
      )}

      {seniorityLevels.length > 0 && (
        <>
          <p className="text-[9px] font-semibold text-[#475569] tracking-widest uppercase mb-2">
            Target Roles
          </p>
          <div className="flex flex-wrap gap-1.5 mb-4">
            {seniorityLevels.map((level) => (
              <span
                key={level}
                className="text-[10px] bg-violet-950/60 border border-violet-700/30 text-violet-300 px-2 py-0.5 rounded-md"
              >
                {level}
              </span>
            ))}
          </div>
          <div className="h-px bg-[#1e2d4a] my-3" />
        </>
      )}

      {geoPrefs.length > 0 && (
        <>
          <p className="text-[9px] font-semibold text-[#475569] tracking-widest uppercase mb-1">
            Location
          </p>
          <div className="flex flex-wrap gap-1.5">
            {geoPrefs.map((g) => (
              <span key={g} className="text-[10px] bg-sky-950/40 border border-sky-700/20 text-sky-200/80 px-2 py-0.5 rounded-md">
                {g}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
```

Remove the now-unused `initials` helper function from the top of the file (it's no longer referenced).

- [ ] **Step 2: Run TypeScript check + tests**

```bash
npx tsc --noEmit && npm run test:run
```

Expected: no type errors, all tests pass

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/ProfileCard.tsx
git commit -m "feat: show CandidateAvatar in dashboard profile card"
```

---

## Task 9: Create `AvatarUploadSection` component (TDD)

**Files:**
- Create: `src/__tests__/components/settings/AvatarUploadSection.test.tsx`
- Create: `src/components/settings/AvatarUploadSection.tsx`

- [ ] **Step 1: Write failing tests**

Create `src/__tests__/components/settings/AvatarUploadSection.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AvatarUploadSection } from '@/components/settings/AvatarUploadSection'

const mockUpdateCandidateAvatar = vi.fn()
vi.mock('@/lib/api', () => ({
  updateCandidateAvatar: (...args: unknown[]) => mockUpdateCandidateAvatar(...args),
}))

const NAME = 'Manav Ghosh'
const CANDIDATE_ID = 'candidate-123'

beforeEach(() => {
  mockUpdateCandidateAvatar.mockResolvedValue(undefined)
})

describe('AvatarUploadSection', () => {
  it('renders the current avatar and an Upload photo button', () => {
    render(
      <AvatarUploadSection
        candidateId={CANDIDATE_ID}
        name={NAME}
        avatarData={null}
        onAvatarChange={vi.fn()}
      />
    )
    expect(screen.getByText('MG')).toBeInTheDocument()
    expect(screen.getByText('Upload photo')).toBeInTheDocument()
  })

  it('does not show Remove button when no avatarData', () => {
    render(
      <AvatarUploadSection
        candidateId={CANDIDATE_ID}
        name={NAME}
        avatarData={null}
        onAvatarChange={vi.fn()}
      />
    )
    expect(screen.queryByText('Remove')).not.toBeInTheDocument()
  })

  it('shows Remove button when avatarData is present', () => {
    render(
      <AvatarUploadSection
        candidateId={CANDIDATE_ID}
        name={NAME}
        avatarData="data:image/jpeg;base64,abc"
        onAvatarChange={vi.fn()}
      />
    )
    expect(screen.getByText('Remove')).toBeInTheDocument()
  })

  it('calls updateCandidateAvatar(null) and onAvatarChange(null) when Remove is clicked', async () => {
    const onAvatarChange = vi.fn()
    render(
      <AvatarUploadSection
        candidateId={CANDIDATE_ID}
        name={NAME}
        avatarData="data:image/jpeg;base64,abc"
        onAvatarChange={onAvatarChange}
      />
    )
    fireEvent.click(screen.getByText('Remove'))
    await waitFor(() => {
      expect(mockUpdateCandidateAvatar).toHaveBeenCalledWith(CANDIDATE_ID, null)
      expect(onAvatarChange).toHaveBeenCalledWith(null)
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/__tests__/components/settings/AvatarUploadSection.test.tsx
```

Expected: all 4 tests FAIL with "Cannot find module '@/components/settings/AvatarUploadSection'"

- [ ] **Step 3: Create `src/components/settings/AvatarUploadSection.tsx`**

```tsx
'use client'

import { useRef, useState } from 'react'
import { CandidateAvatar } from '@/components/shared/CandidateAvatar'
import { Button } from '@/components/ui/button'
import { updateCandidateAvatar } from '@/lib/api'

interface AvatarUploadSectionProps {
  candidateId: string
  name: string
  avatarData: string | null
  onAvatarChange: (avatarData: string | null) => void
}

function resizeToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      const size = 128
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      const ctx = canvas.getContext('2d')!
      const scale = Math.max(size / img.width, size / img.height)
      const sw = img.width * scale
      const sh = img.height * scale
      ctx.drawImage(img, (size - sw) / 2, (size - sh) / 2, sw, sh)
      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL('image/jpeg', 0.85))
    }
    img.onerror = reject
    img.src = url
  })
}

export function AvatarUploadSection({
  candidateId,
  name,
  avatarData,
  onAvatarChange,
}: AvatarUploadSectionProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [saving, setSaving] = useState(false)

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setSaving(true)
    try {
      const dataUrl = await resizeToDataUrl(file)
      await updateCandidateAvatar(candidateId, dataUrl)
      onAvatarChange(dataUrl)
    } finally {
      setSaving(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  async function handleRemove() {
    setSaving(true)
    try {
      await updateCandidateAvatar(candidateId, null)
      onAvatarChange(null)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex items-center gap-4">
      <CandidateAvatar name={name} avatarData={avatarData} size="lg" className="rounded-xl shrink-0" />
      <div className="flex flex-col gap-2">
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFile}
        />
        <Button
          size="sm"
          variant="outline"
          className="text-xs border-[#1e3a5f] text-[#60a5fa] hover:bg-[#0d1f3c]"
          isLoading={saving}
          onClick={() => inputRef.current?.click()}
        >
          Upload photo
        </Button>
        {avatarData && !saving && (
          <button
            type="button"
            className="text-[10px] text-[#475569] hover:text-[#94a3b8] transition-colors text-left"
            onClick={handleRemove}
          >
            Remove
          </button>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/__tests__/components/settings/AvatarUploadSection.test.tsx
```

Expected: all 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/AvatarUploadSection.tsx src/__tests__/components/settings/AvatarUploadSection.test.tsx
git commit -m "feat: add AvatarUploadSection component"
```

---

## Task 10: Wire `AvatarUploadSection` into the settings page

**Files:**
- Modify: `src/app/candidates/[id]/settings/page.tsx`

The settings page fetches candidate data via `getCV()` which returns `CandidateState` (now including `avatarData`). We add an "Profile Photo" section to the right column at the top, and keep `avatarData` in local state so the upload updates the UI immediately.

- [ ] **Step 1: Update the settings page**

Add the import at the top:

```tsx
import { AvatarUploadSection } from '@/components/settings/AvatarUploadSection'
```

Update the `candidate` state type to reflect the full `CandidateState` (no change needed — it already is `CandidateState | null`).

Add `avatarData` to local state and wire it up. In the settings page `return` block, locate `<div className="flex flex-col gap-6">` (the right-hand column) and insert the `AvatarUploadSection` as the **first** child, before the existing Preferences section. The existing sections (Preferences, LinkedIn, EmailOutreachMode, ResumeAttachment) remain unchanged.

```tsx
<div className="flex flex-col gap-6">
  {/* Profile photo — NEW */}
  <section className="bg-[#0d1f3c] border border-[#1e3a5f] rounded-xl p-5 space-y-3">
    <p className="text-[9px] font-semibold text-[#334155] tracking-widest uppercase">Profile Photo</p>
    <AvatarUploadSection
      candidateId={candidateId}
      name={candidate?.name ?? 'Candidate'}
      avatarData={candidate?.avatarData ?? null}
      onAvatarChange={(data) =>
        setCandidate((prev) => prev ? { ...prev, avatarData: data } : prev)
      }
    />
  </section>

  {/* All existing sections below are unchanged — keep them as-is */}
  <section className="bg-[#0d1f3c] border border-[#1e3a5f] rounded-xl p-5 space-y-4">
    <p className="text-[9px] font-semibold text-[#334155] tracking-widest uppercase">Preferences</p>
    <PreferencesForm
      initialPreferences={candidate?.preferences ?? {}}
      onSaved={handlePreferencesSaved}
      candidateId={candidateId}
    />
  </section>

  <section className="bg-[#0d1f3c] border border-[#1e3a5f] rounded-xl p-5">
    <LinkedInConnectCard candidateId={candidateId} flash={linkedinFlash} />
  </section>

  <section className="bg-[#0d1f3c] border border-[#1e3a5f] rounded-xl p-5">
    <EmailOutreachModeCard candidateId={candidateId} flash={gmailFlash} />
  </section>

  <section className="bg-[#0d1f3c] border border-[#1e3a5f] rounded-xl p-5">
    <ResumeAttachmentCard candidateId={candidateId} />
  </section>
</div>
```

- [ ] **Step 2: Run TypeScript check + tests**

```bash
npx tsc --noEmit && npm run test:run
```

Expected: no type errors, all tests pass

- [ ] **Step 3: Commit**

```bash
git add src/app/candidates/[id]/settings/page.tsx
git commit -m "feat: add Profile Photo section to settings page"
```

---

## Task 11: Pre-push verification

- [ ] **Step 1: Run full test suite**

```bash
npm run test:run
```

Expected: 0 failures

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no output (zero errors)

- [ ] **Step 3: Production build**

```bash
npm run build
```

Expected: exits 0, no prerender errors

- [ ] **Step 4: Smoke-test in browser**

Start dev server (`npm run dev`) and verify:
1. Sidebar footer shows initials avatar
2. Topbar switcher shows avatar next to name
3. Dashboard profile card shows avatar
4. Settings page shows "Profile Photo" section with Upload button
5. Upload a photo → avatar updates immediately on screen
6. Reload → avatar persists on all three surfaces
7. Click Remove → reverts to initials on all three surfaces

- [ ] **Step 5: Final commit if any fixes were needed, then ready to push**
