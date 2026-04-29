# Async Button Spinner — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `isLoading` prop to the shared `Button` component that renders an animated Loader2 spinner beside the label, then wire it up to the 4 async action buttons in the app.

**Architecture:** Extend `button.tsx` with an `isLoading?: boolean` prop. When true, render a `<Loader2 className="animate-spin" />` as the first child and force `disabled`. Update the 4 call sites to pass `isLoading` and remove the text-swap loading pattern.

**Tech Stack:** Next.js 15 / React 19 / Tailwind CSS 4.1 / Lucide React / Vitest + @testing-library/react

---

## Spec Reference

`docs/superpowers/specs/2026-04-29-async-spinner-design.md`

---

## File Map

```
src/
  components/
    ui/
      button.tsx                  ← Task 1: add isLoading prop + Loader2
    cv/
      CVUploader.tsx              ← Task 2: isLoading={loading}, static label
      MarkdownEditor.tsx          ← Task 3: isLoading={saving}, static label
    preferences/
      PreferencesForm.tsx         ← Task 4: isLoading={saving}, static label
  app/
    settings/
      page.tsx                    ← Task 5: isLoading={reparsing}, static label
  __tests__/
    components/
      ui/
        button.test.tsx           ← Task 1: component tests for isLoading
```

---

## Task 1: Extend Button with `isLoading` prop

**Files:**
- Modify: `src/components/ui/button.tsx`
- Create: `src/components/ui/__tests__/button.test.tsx`

> **Note:** The test file goes in a sibling `__tests__` folder next to the component so it co-locates with UI tests. Vitest picks up all `*.test.tsx` files automatically via the config.

- [ ] **Step 1: Create the failing test**

Create `src/__tests__/components/ui/button.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { Button } from '@/components/ui/button'

describe('Button isLoading', () => {
  it('renders a spinner when isLoading is true', () => {
    render(<Button isLoading>Save</Button>)
    // Loader2 renders as an svg; lucide icons have a data-testid equal to their name in kebab-case
    // We check by aria role since lucide doesn't set data-testid by default
    const svg = document.querySelector('svg')
    expect(svg).toBeInTheDocument()
    expect(svg?.classList.toString()).toContain('animate-spin')
  })

  it('is disabled when isLoading is true', () => {
    render(<Button isLoading>Save</Button>)
    expect(screen.getByRole('button')).toBeDisabled()
  })

  it('is not disabled and has no spinner when isLoading is false', () => {
    render(<Button isLoading={false}>Save</Button>)
    expect(screen.getByRole('button')).not.toBeDisabled()
    const svg = document.querySelector('svg')
    expect(svg).not.toBeInTheDocument()
  })

  it('still renders the label text beside the spinner', () => {
    render(<Button isLoading>Save CV</Button>)
    expect(screen.getByText('Save CV')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the tests to confirm they fail**

```bash
npx vitest run src/__tests__/components/ui/button.test.tsx
```

Expected: 4 tests fail — `isLoading` prop does not exist yet.

- [ ] **Step 3: Implement `isLoading` in `button.tsx`**

Replace `src/components/ui/button.tsx` with:

```tsx
import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"
import { Loader2 } from "lucide-react"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-all outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive:
          "bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:bg-destructive/60 dark:focus-visible:ring-destructive/40",
        outline:
          "border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost:
          "hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        xs: "h-6 gap-1 rounded-md px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
        icon: "size-9",
        "icon-xs": "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  isLoading = false,
  disabled,
  children,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
    isLoading?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      disabled={isLoading || disabled}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    >
      {isLoading && <Loader2 className="animate-spin" />}
      {children}
    </Comp>
  )
}

export { Button, buttonVariants }
```

- [ ] **Step 4: Run the tests to confirm they pass**

```bash
npx vitest run src/__tests__/components/ui/button.test.tsx
```

Expected: 4 tests pass.

- [ ] **Step 5: Run the full test suite to confirm no regressions**

```bash
npm run test:run
```

Expected: All existing tests pass (service-level tests are unaffected).

- [ ] **Step 6: Commit**

```bash
git add src/components/ui/button.tsx src/__tests__/components/ui/button.test.tsx
git commit -m "feat: add isLoading prop to Button — renders Loader2 spinner and forces disabled"
```

---

## Task 2: Wire up CVUploader

**Files:**
- Modify: `src/components/cv/CVUploader.tsx`

- [ ] **Step 1: Update CVUploader**

Replace `src/components/cv/CVUploader.tsx` with:

```tsx
'use client'

import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { convertCV } from '@/lib/api'

interface CVUploaderProps {
  onConverted: (markdown: string) => void
}

const ACCEPTED = '.md,.docx,.pdf'
const MAX_MB = 10

export function CVUploader({ onConverted }: CVUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleFile(file: File) {
    setError(null)
    if (file.size > MAX_MB * 1024 * 1024) {
      setError(`File exceeds ${MAX_MB} MB limit.`)
      return
    }
    setLoading(true)
    try {
      const { markdown } = await convertCV(file)
      onConverted(markdown)
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Conversion failed. Try a different file.'
      )
    } finally {
      setLoading(false)
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }

  return (
    <div className="space-y-2">
      <Button
        variant="default"
        onClick={() => inputRef.current?.click()}
        isLoading={loading}
      >
        Upload CV
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED}
        className="hidden"
        onChange={handleChange}
      />
      <p className="text-xs text-muted-foreground">
        Accepted: .md, .docx, .pdf · Max {MAX_MB} MB
      </p>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
```

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/cv/CVUploader.tsx
git commit -m "feat: show spinner on Upload CV button during conversion"
```

---

## Task 3: Wire up MarkdownEditor

**Files:**
- Modify: `src/components/cv/MarkdownEditor.tsx`

- [ ] **Step 1: Update MarkdownEditor**

Replace `src/components/cv/MarkdownEditor.tsx` with:

```tsx
'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { saveCV } from '@/lib/api'
import type { CandidateState } from '@/types/candidate'

interface MarkdownEditorProps {
  initialMarkdown: string
  onSaved: (candidate: CandidateState) => void
}

export function MarkdownEditor({ initialMarkdown, onSaved }: MarkdownEditorProps) {
  const [markdown, setMarkdown] = useState(initialMarkdown)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    setError(null)
    setSaving(true)
    try {
      const candidate = await saveCV(markdown)
      onSaved(candidate)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed. Try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Review and correct the Markdown before saving.
        </p>
        <Button variant="default" size="sm" onClick={handleSave} isLoading={saving}>
          Save CV
        </Button>
      </div>
      <Textarea
        value={markdown}
        onChange={(e) => setMarkdown(e.target.value)}
        rows={24}
        className="font-mono text-sm"
        spellCheck={false}
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
```

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/cv/MarkdownEditor.tsx
git commit -m "feat: show spinner on Save CV button during save"
```

---

## Task 4: Wire up PreferencesForm

**Files:**
- Modify: `src/components/preferences/PreferencesForm.tsx`

- [ ] **Step 1: Update the Save Preferences button in PreferencesForm**

In `src/components/preferences/PreferencesForm.tsx`, find the submit button block at the bottom:

```tsx
      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save Preferences'}
        </Button>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
```

Replace it with:

```tsx
      <div className="flex items-center gap-3">
        <Button onClick={handleSave} isLoading={saving}>
          Save Preferences
        </Button>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
```

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/preferences/PreferencesForm.tsx
git commit -m "feat: show spinner on Save Preferences button during save"
```

---

## Task 5: Wire up Re-parse button

**Files:**
- Modify: `src/app/settings/page.tsx`

- [ ] **Step 1: Update the Re-parse button in settings/page.tsx**

In `src/app/settings/page.tsx`, find the Re-parse button:

```tsx
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-auto text-xs border-[#1e3a5f] text-[#60a5fa] hover:bg-[#0d1f3c]"
                  onClick={handleReparse}
                  disabled={reparsing}
                >
                  {reparsing ? 'Queuing…' : '↺ Re-parse'}
                </Button>
```

Replace it with:

```tsx
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-auto text-xs border-[#1e3a5f] text-[#60a5fa] hover:bg-[#0d1f3c]"
                  onClick={handleReparse}
                  isLoading={reparsing}
                >
                  ↺ Re-parse
                </Button>
```

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/settings/page.tsx
git commit -m "feat: show spinner on Re-parse button during reparse"
```

---

## Task 6: Final verification

- [ ] **Step 1: Run full test suite**

```bash
npm run test:run
```

Expected: All tests pass (including the 4 new Button tests from Task 1).

- [ ] **Step 2: TypeScript full check**

```bash
npx tsc --noEmit
```

Expected: Zero errors.

- [ ] **Step 3: Start dev server and verify visually**

```bash
npm run dev
```

Open `http://localhost:3000/settings` and verify:
- Clicking **Upload CV** shows a spinner beside "Upload CV" while converting
- Clicking **Save CV** (after uploading) shows a spinner beside "Save CV" while saving
- Clicking **↺ Re-parse** shows a spinner beside "↺ Re-parse" while queuing
- Clicking **Save Preferences** shows a spinner beside "Save Preferences" while saving
- All buttons are non-clickable (disabled) while their spinner is showing
- No other buttons in the app are visually affected

Ctrl+C to stop.

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| `isLoading` prop on Button renders Loader2 with `animate-spin` | Task 1 |
| `isLoading` forces button disabled | Task 1 |
| Spinner sits beside the label (not replacing it) | Task 1 (children rendered after spinner) |
| Re-parse ↺ character stays in label | Task 5 |
| CVUploader — `isLoading={loading}`, static "Upload CV" | Task 2 |
| MarkdownEditor — `isLoading={saving}`, static "Save CV" | Task 3 |
| PreferencesForm — `isLoading={saving}`, static "Save Preferences" | Task 4 |
| Settings Re-parse — `isLoading={reparsing}`, static "↺ Re-parse" | Task 5 |
| TypeScript zero errors | Tasks 2–6 |
| All existing tests pass | Task 6 |

**No gaps found.**

**Placeholder scan:** No TBDs, TODOs, or "implement later" present.

**Type consistency:** `isLoading?: boolean` defined in Task 1, used as `isLoading={loading}` / `isLoading={saving}` / `isLoading={reparsing}` in Tasks 2–5 — all boolean state variables, consistent.
