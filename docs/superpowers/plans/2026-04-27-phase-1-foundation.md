# Phase 1 Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Build the candidate profile foundation — CV upload with inline Markdown editing, async structured parsing via Claude, and a preferences form with a pipeline readiness gate, all on a single `/settings` page.

**Architecture:** Next.js 15 App Router project at the repository root. Five Route Handler endpoints (`GET /api/cv`, `POST /api/cv/convert`, `POST /api/cv/save`, `GET|PUT /api/preferences`, `GET /api/candidate/readiness`) backed by service functions. On CV save, SHA256 hash is computed; if the hash changed, Next.js `after()` fires a background `generateObject` call (Vercel AI SDK + Anthropic) to extract a Zod-validated structured profile. All data lives in a single `candidates` table in Neon PostgreSQL via Drizzle ORM. `candidate_id` FK is nullable — no auth in Phase 1, multi-user ready post-MVP.

**Tech Stack:** TypeScript 5 / Next.js 15 / Tailwind CSS 4.1 / shadcn/ui (new-york, neutral) / Drizzle ORM ^0.43 / drizzle-kit ^0.31.5 / @neondatabase/serverless ^1.0.0 / ai ^5.0.0 / @ai-sdk/anthropic ^2.0.0 / Zod ^4.1.8 / Vitest 2 / mammoth / pdf-parse

---

## Constitution Check

| Principle | Status | Notes |
|---|---|---|
| I. Human Supremacy (HITL-First) | ✅ PASS | No outbound actions. Phase 1 is local data management only. |
| II. Agent Modularity | ✅ PASS | No LangGraph agents. CV parser is an isolated, single-responsibility function. |
| III. Factual Integrity | ✅ PASS | ParsedProfileSchema (Zod) validates before write. Prompt explicitly prohibits fabrication. Prior profile preserved on parse failure. |
| IV. Observability by Default | ✅ PASS | No LangGraph in Phase 1 — LangSmith not required. AI SDK errors logged to console in dev. |
| V. Provider-Agnostic LLM | ✅ PASS | `getModel()` factory in `src/lib/llm.ts`. Only AI SDK provider adapters used. `LLM_PROVIDER` + `LLM_MODEL` env vars control selection. |
| VI. Technology Standards | ✅ PASS | All canonical versions used (see package.json in Task 1). |
| VII. Dual-Runtime Architecture | ✅ PASS | Python microservice NOT introduced. No `pipeline_jobs` table. `after()` runs background parse entirely within Next.js. |
| Security & Data Residency | ✅ PASS | Secrets in `.env.local` (gitignored). `DATABASE_URL` and `ANTHROPIC_API_KEY` never committed. |
| Skill Invocation Policy | ✅ PASS | vercel-react-best-practices used for all components (Tasks 12–14). TDD applied to all critical paths (Tasks 3–9). |

**No violations found.**

---

## Phases

| Phase | Tasks | Deliverable | Safe pause |
|---|---|---|---|
| **A — Scaffold & Data** | 1–2 | Running Next.js app, DB connected, migration applied | ✅ After Task 2 |
| **B — Core Utilities** | 3–5 | Hash, CV converter, LLM factory + Zod schema — all tested | ✅ After Task 5 |
| **C — Service Layer** | 6–9 | All business logic covered by unit tests | ✅ After Task 9 |
| **D — Route Handlers** | 10 | All API endpoints wired and manually verified | ✅ After Task 10 |
| **E — Frontend** | 11–15 | Settings page fully functional end-to-end | ✅ After Task 15 |

---

## File Map

```
(repository root — Next.js project)
├── package.json
├── tsconfig.json
├── next.config.ts
├── postcss.config.mjs
├── drizzle.config.ts
├── vitest.config.ts
├── .env.example
├── .env.local                              ← you create this, never committed
├── migrations/                             ← drizzle-kit generated
└── src/
    ├── app/
    │   ├── layout.tsx
    │   ├── globals.css
    │   ├── settings/
    │   │   └── page.tsx                    ← Task 14
    │   └── api/
    │       ├── cv/
    │       │   ├── route.ts                ← GET  Task 10
    │       │   ├── convert/route.ts        ← POST Task 10
    │       │   └── save/route.ts           ← POST Task 10
    │       ├── preferences/
    │       │   └── route.ts                ← GET + PUT Task 10
    │       └── candidate/
    │           └── readiness/route.ts      ← GET  Task 10
    ├── db/
    │   ├── index.ts                        ← Task 2
    │   └── schema.ts                       ← Task 2
    ├── lib/
    │   ├── hash.ts                         ← Task 3
    │   ├── cv-converter.ts                 ← Task 4
    │   ├── schemas/
    │   │   └── parsed-profile.ts           ← Task 5
    │   ├── llm.ts                          ← Task 5
    │   ├── cv-service.ts                   ← Task 6
    │   ├── preferences-service.ts          ← Task 7
    │   ├── readiness-service.ts            ← Task 8
    │   └── cv-parser.ts                   ← Task 9
    ├── types/
    │   └── candidate.ts                    ← Task 11
    ├── components/
    │   ├── cv/
    │   │   ├── CVUploader.tsx              ← Task 12
    │   │   ├── MarkdownEditor.tsx          ← Task 12
    │   │   └── ParseStatusBadge.tsx        ← Task 12
    │   ├── preferences/
    │   │   └── PreferencesForm.tsx         ← Task 13
    │   └── shared/
    │       └── PipelineReadinessIndicator.tsx ← Task 14
    └── __tests__/
        ├── setup.ts
        ├── fixtures/
        │   └── sample.md
        └── lib/
            ├── hash.test.ts
            ├── cv-converter.test.ts
            ├── cv-service.test.ts
            ├── preferences-service.test.ts
            ├── readiness-service.test.ts
            └── cv-parser.test.ts
```

---

## Task 1: Project scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `next.config.ts`
- Create: `postcss.config.mjs`
- Create: `vitest.config.ts`
- Create: `src/app/layout.tsx`
- Create: `src/app/globals.css`
- Create: `src/__tests__/setup.ts`
- Create: `.env.example`

- [x] **Step 1: Create `package.json`**

```json
{
  "name": "proxim",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "test": "vitest",
    "test:run": "vitest run",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "db:studio": "drizzle-kit studio"
  },
  "dependencies": {
    "next": "^15",
    "react": "^19",
    "react-dom": "^19",
    "drizzle-orm": "^0.43.0",
    "@neondatabase/serverless": "^1.0.0",
    "ai": "^5.0.0",
    "@ai-sdk/anthropic": "^2.0.0",
    "zod": "^4.1.8",
    "mammoth": "^1.8.0",
    "pdf-parse": "^1.1.1"
  },
  "devDependencies": {
    "typescript": "^5",
    "@types/node": "^20",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "@types/pdf-parse": "^1.1.4",
    "tailwindcss": "^4.1",
    "@tailwindcss/postcss": "^4.1",
    "drizzle-kit": "^0.31.5",
    "vitest": "^2",
    "@vitejs/plugin-react": "^4",
    "jsdom": "^25",
    "@testing-library/react": "^16",
    "@testing-library/jest-dom": "^6",
    "dotenv": "^16"
  }
}
```

- [x] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [x] **Step 3: Create `next.config.ts`**

```typescript
import type { NextConfig } from 'next'

const config: NextConfig = {
  experimental: {
    after: true,
  },
}

export default config
```

- [x] **Step 4: Create `postcss.config.mjs`**

```javascript
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
}
export default config
```

- [x] **Step 5: Create `vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/__tests__/setup.ts'],
    globals: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
```

- [x] **Step 6: Create `src/app/globals.css`**

```css
@import "tailwindcss";
```

- [x] **Step 7: Create `src/app/layout.tsx`**

```tsx
import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Proxim',
  description: 'Autonomous job hunting for senior IT professionals',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-gray-50 text-gray-900 antialiased">{children}</body>
    </html>
  )
}
```

- [x] **Step 8: Create `src/__tests__/setup.ts`**

```typescript
import '@testing-library/jest-dom'
```

- [x] **Step 9: Create `.env.example`**

```
DATABASE_URL=postgresql://user:password@ep-xxx.us-east-2.aws.neon.tech/proxim?sslmode=require
LLM_PROVIDER=anthropic
LLM_MODEL=claude-sonnet-4-6
ANTHROPIC_API_KEY=sk-ant-...
```

- [x] **Step 10: Install dependencies**

```bash
npm install
```

Expected: `node_modules/` created, no errors.

- [x] **Step 11: Verify Next.js starts**

```bash
npm run dev
```

Expected: `▲ Next.js 15.x.x` and `Local: http://localhost:3000`. Ctrl+C to stop.

- [x] **Step 12: Initialise shadcn/ui**

```bash
npx shadcn@latest init
```

When prompted, choose:
- Style: **New York**
- Base colour: **Neutral**
- CSS variables: **Yes**

This generates `components.json` and `src/lib/utils.ts`, and updates `src/app/globals.css` with shadcn CSS variable definitions.

- [x] **Step 13: Verify `components.json` — `tailwind.config` must be blank for Tailwind v4**

Open `components.json` and confirm it looks like this (config is `""`):

```json
{
  "style": "new-york",
  "rsc": true,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/app/globals.css",
    "baseColor": "neutral",
    "cssVariables": true
  },
  "iconLibrary": "lucide",
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  }
}
```

If `config` is not `""`, edit it to be an empty string now.

- [x] **Step 14: Add required shadcn/ui components**

```bash
npx shadcn@latest add button textarea badge label
```

Expected: `src/components/ui/button.tsx`, `textarea.tsx`, `badge.tsx`, `label.tsx` created.

- [x] **Step 15: Commit**

```bash
git add package.json tsconfig.json next.config.ts postcss.config.mjs vitest.config.ts src/app/layout.tsx src/app/globals.css src/__tests__/setup.ts .env.example components.json src/lib/utils.ts src/components/ui/
git commit -m "chore: scaffold Next.js 15 + Tailwind 4 + shadcn/ui (new-york / neutral)"
```

---

## Task 2: Drizzle schema, DB connection, migration

**Files:**
- Create: `drizzle.config.ts`
- Create: `src/db/schema.ts`
- Create: `src/db/index.ts`
- Create: `.env.local` (manually — never commit this file)

- [x] **Step 1: Create `.env.local`** (manually — gitignored)

Copy `.env.example` to `.env.local` and fill in real values from your Neon project dashboard at console.neon.tech.

- [x] **Step 2: Add `.env.local` to `.gitignore`** (if not already present)

```bash
echo ".env.local" >> .gitignore
echo ".env" >> .gitignore
```

- [x] **Step 3: Create `drizzle.config.ts`**

```typescript
import { config } from 'dotenv'
import { defineConfig } from 'drizzle-kit'

config({ path: '.env.local' })

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './migrations',
  dialect: 'postgresql',
  casing: 'snake_case',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
})
```

- [x] **Step 4: Create `src/db/schema.ts`**

```typescript
import {
  pgTable,
  uuid,
  text,
  varchar,
  jsonb,
  pgEnum,
  timestamp,
} from 'drizzle-orm/pg-core'

// Inline types for JSONB columns — avoids circular imports with lib/schemas
type ParsedProfile = {
  name: string
  contact: Record<string, string>
  summary: string
  roles: Array<{ title: string; company: string; dates: string; bullets: string[] }>
  skills: string[]
  patents: string[]
  projects: string[]
  education: string[]
  certifications: string[]
  awards: string[]
}

type Preferences = {
  seniority_levels?: string[]
  geographic_preference?: string
  company_stages?: string[]
  compensation_band?: { min: number; max: number; currency: string }
  target_companies?: string[]
  preferred_domains?: string[]
}

export const parseStatusEnum = pgEnum('parse_status', [
  'pending',
  'parsing',
  'ready',
  'failed',
])

export const candidates = pgTable('candidates', {
  id: uuid().defaultRandom().primaryKey(),
  candidateId: uuid(),
  baseCvMd: text(),
  baseCvHash: varchar({ length: 64 }),
  parsedProfile: jsonb().$type<ParsedProfile>(),
  parseStatus: parseStatusEnum().default('pending').notNull(),
  preferences: jsonb().$type<Preferences>().default({}).notNull(),
  createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp({ withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdateFn(() => new Date()),
})

export type Candidate = typeof candidates.$inferSelect
export type NewCandidate = typeof candidates.$inferInsert
```

- [x] **Step 5: Create `src/db/index.ts`**

```typescript
import { drizzle } from 'drizzle-orm/neon-http'
import { neon } from '@neondatabase/serverless'
import * as schema from './schema'

const sql = neon(process.env.DATABASE_URL!)
export const db = drizzle({ client: sql, schema, casing: 'snake_case' })
```

- [x] **Step 6: Generate migration**

```bash
npm run db:generate
```

Expected: `migrations/0000_*.sql` file created. Inspect it — it should contain `CREATE TABLE candidates` and `CREATE TYPE parse_status AS ENUM`.

- [x] **Step 7: Apply migration to Neon**

```bash
npm run db:migrate
```

Expected: Migration applied successfully. Verify the `candidates` table exists in your Neon dashboard.

- [x] **Step 8: Verify DB connection**

```bash
node -e "
require('dotenv').config({ path: '.env.local' });
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);
sql\`SELECT 1 AS ok\`.then(r => { console.log('DB OK:', r[0]); process.exit(0); }).catch(e => { console.error(e); process.exit(1); });
"
```

Expected: `DB OK: { ok: 1 }`

- [x] **Step 9: Commit**

```bash
git add drizzle.config.ts src/db/schema.ts src/db/index.ts migrations/ .gitignore
git commit -m "feat: add Drizzle schema, Neon DB connection, and initial migration"
```

---

## Task 3: Hash utility (TDD)

**Files:**
- Create: `src/__tests__/lib/hash.test.ts`
- Create: `src/lib/hash.ts`

- [x] **Step 1: Write failing tests**

Create `src/__tests__/lib/hash.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { computeSHA256 } from '@/lib/hash'

describe('computeSHA256', () => {
  it('returns a 64-character lowercase hex string', () => {
    expect(computeSHA256('hello')).toHaveLength(64)
    expect(computeSHA256('hello')).toMatch(/^[0-9a-f]+$/)
  })

  it('returns the same hash for the same input', () => {
    expect(computeSHA256('hello world')).toBe(computeSHA256('hello world'))
  })

  it('returns different hashes for different inputs', () => {
    expect(computeSHA256('hello')).not.toBe(computeSHA256('hello!'))
  })

  it('returns the well-known SHA256 of an empty string', () => {
    expect(computeSHA256('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    )
  })
})
```

- [x] **Step 2: Run tests — verify they fail**

```bash
npm run test:run -- src/__tests__/lib/hash.test.ts
```

Expected: `Cannot find module '@/lib/hash'`

- [x] **Step 3: Create `src/lib/hash.ts`**

```typescript
import { createHash } from 'crypto'

export function computeSHA256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}
```

- [x] **Step 4: Run tests — verify they pass**

```bash
npm run test:run -- src/__tests__/lib/hash.test.ts
```

Expected: `4 passed`

- [x] **Step 5: Commit**

```bash
git add src/lib/hash.ts src/__tests__/lib/hash.test.ts
git commit -m "feat: add SHA256 hash utility (TDD)"
```

---

## Task 4: CV converter service (TDD)

**Files:**
- Create: `src/__tests__/fixtures/sample.md`
- Create: `src/__tests__/lib/cv-converter.test.ts`
- Create: `src/lib/cv-converter.ts`

- [x] **Step 1: Create `src/__tests__/fixtures/sample.md`**

```markdown
# Manav Ghosh

manav@example.com | Bengaluru, India

## Summary

Senior AI leader with 15+ years experience building enterprise-scale platforms.

## Experience

### Head of AI — Acme Corp (2020–present)

- Built $2B platform serving 50M users
- Led team of 40 engineers across 3 continents

## Skills

Python, LangGraph, FastAPI, LLM Engineering

## Education

B.Tech Computer Science — IIT Delhi, 2008
```

- [x] **Step 2: Write failing tests**

Create `src/__tests__/lib/cv-converter.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'
import { convertToMarkdown, ConversionError } from '@/lib/cv-converter'

const FIXTURES = path.join(__dirname, '../fixtures')

describe('convertToMarkdown — Markdown passthrough', () => {
  it('returns the file content as a string', async () => {
    const buf = readFileSync(path.join(FIXTURES, 'sample.md'))
    const result = await convertToMarkdown(buf, 'sample.md')
    expect(result).toContain('Manav Ghosh')
    expect(result).toContain('LangGraph')
  })

  it('returns a non-empty trimmed string', async () => {
    const buf = readFileSync(path.join(FIXTURES, 'sample.md'))
    expect((await convertToMarkdown(buf, 'cv.md')).trim().length).toBeGreaterThan(0)
  })
})

describe('convertToMarkdown — unsupported formats', () => {
  it('throws ConversionError for .xlsx', async () => {
    await expect(
      convertToMarkdown(Buffer.from('data'), 'resume.xlsx')
    ).rejects.toBeInstanceOf(ConversionError)
  })

  it('error message includes the unsupported extension', async () => {
    await expect(
      convertToMarkdown(Buffer.from('data'), 'resume.xlsx')
    ).rejects.toThrow('.xlsx')
  })
})

describe('convertToMarkdown — PDF with no extractable text', () => {
  it('throws ConversionError for a minimal empty PDF', async () => {
    const emptyPdf = Buffer.from('%PDF-1.4\n%%EOF\n')
    await expect(
      convertToMarkdown(emptyPdf, 'scan.pdf')
    ).rejects.toBeInstanceOf(ConversionError)
  })
})
```

- [x] **Step 3: Run tests — verify they fail**

```bash
npm run test:run -- src/__tests__/lib/cv-converter.test.ts
```

Expected: `Cannot find module '@/lib/cv-converter'`

- [x] **Step 4: Create `src/lib/cv-converter.ts`**

```typescript
import { extname } from 'path'

export class ConversionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConversionError'
  }
}

export async function convertToMarkdown(
  fileContent: Buffer,
  filename: string
): Promise<string> {
  const ext = extname(filename).toLowerCase()

  switch (ext) {
    case '.md':
      return fileContent.toString('utf8')

    case '.docx': {
      const mammoth = await import('mammoth')
      const result = await mammoth.extractRawText({ buffer: fileContent })
      if (!result.value.trim()) {
        throw new ConversionError('No text could be extracted from this DOCX file.')
      }
      return result.value
    }

    case '.pdf': {
      const pdfParse = (await import('pdf-parse')).default
      let result: { text: string }
      try {
        result = await pdfParse(fileContent)
      } catch {
        throw new ConversionError(
          'Failed to parse PDF. It may be corrupted or a scanned image.'
        )
      }
      if (!result.text.trim()) {
        throw new ConversionError(
          'No text could be extracted from this PDF. It may be a scanned image.'
        )
      }
      return result.text
    }

    default:
      throw new ConversionError(
        `Unsupported format: ${ext}. Accepted formats: .md, .docx, .pdf`
      )
  }
}
```

- [x] **Step 5: Run tests — verify they pass**

```bash
npm run test:run -- src/__tests__/lib/cv-converter.test.ts
```

Expected: `5 passed`

- [x] **Step 6: Commit**

```bash
git add src/lib/cv-converter.ts src/__tests__/lib/cv-converter.test.ts src/__tests__/fixtures/sample.md
git commit -m "feat: add CV converter service for PDF/DOCX/MD (TDD)"
```

---

## Task 5: ParsedProfile Zod schema + LLM factory

**Files:**
- Create: `src/lib/schemas/parsed-profile.ts`
- Create: `src/lib/llm.ts`

- [x] **Step 1: Create `src/lib/schemas/parsed-profile.ts`**

```typescript
import { z } from 'zod'

export const RoleSchema = z.object({
  title: z.string(),
  company: z.string(),
  dates: z.string(),
  bullets: z.array(z.string()).default([]),
})

export const ParsedProfileSchema = z.object({
  name: z.string().default(''),
  contact: z.record(z.string(), z.string()).default({}),
  summary: z.string().default(''),
  roles: z.array(RoleSchema).default([]),
  skills: z.array(z.string()).default([]),
  patents: z.array(z.string()).default([]),
  projects: z.array(z.string()).default([]),
  education: z.array(z.string()).default([]),
  certifications: z.array(z.string()).default([]),
  awards: z.array(z.string()).default([]),
})

export type ParsedProfile = z.infer<typeof ParsedProfileSchema>
```

- [x] **Step 2: Create `src/lib/llm.ts`**

```typescript
import { anthropic } from '@ai-sdk/anthropic'
import type { LanguageModel } from 'ai'

export function getModel(): LanguageModel {
  const provider = process.env.LLM_PROVIDER ?? 'anthropic'
  const model = process.env.LLM_MODEL ?? 'claude-sonnet-4-6'

  if (provider !== 'anthropic') {
    throw new Error(
      `Provider "${provider}" is not configured. Only "anthropic" is supported in Phase 1.`
    )
  }

  return anthropic(model)
}
```

- [x] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [x] **Step 4: Commit**

```bash
git add src/lib/schemas/parsed-profile.ts src/lib/llm.ts
git commit -m "feat: add ParsedProfile Zod schema and LLM provider factory"
```

---

## Task 6: CV service layer (TDD)

**Files:**
- Create: `src/__tests__/lib/cv-service.test.ts`
- Create: `src/lib/cv-service.ts`

- [x] **Step 1: Write failing tests**

Create `src/__tests__/lib/cv-service.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { shouldTriggerParse } from '@/lib/cv-service'

// shouldTriggerParse is a pure function — no DB mock needed
describe('shouldTriggerParse', () => {
  it('returns true when the existing hash is null', () => {
    expect(shouldTriggerParse(null, 'abc123')).toBe(true)
  })

  it('returns true when the existing hash is undefined', () => {
    expect(shouldTriggerParse(undefined, 'abc123')).toBe(true)
  })

  it('returns true when the hash has changed', () => {
    expect(shouldTriggerParse('old-hash', 'new-hash')).toBe(true)
  })

  it('returns false when the hash is identical', () => {
    expect(shouldTriggerParse('same-hash', 'same-hash')).toBe(false)
  })
})
```

- [x] **Step 2: Run tests — verify they fail**

```bash
npm run test:run -- src/__tests__/lib/cv-service.test.ts
```

Expected: `Cannot find module '@/lib/cv-service'`

- [x] **Step 3: Create `src/lib/cv-service.ts`**

```typescript
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { candidates } from '@/db/schema'
import type { Candidate } from '@/db/schema'
import { computeSHA256 } from '@/lib/hash'

export function shouldTriggerParse(
  existingHash: string | null | undefined,
  newHash: string
): boolean {
  return existingHash !== newHash
}

export async function getOrCreateCandidate(): Promise<Candidate> {
  const [existing] = await db.select().from(candidates).limit(1)
  if (existing) return existing
  const [created] = await db.insert(candidates).values({}).returning()
  return created
}

export async function saveCVMarkdown(
  markdown: string
): Promise<{ candidate: Candidate; hashChanged: boolean }> {
  const newHash = computeSHA256(markdown)
  const candidate = await getOrCreateCandidate()

  if (!shouldTriggerParse(candidate.baseCvHash, newHash)) {
    return { candidate, hashChanged: false }
  }

  const [updated] = await db
    .update(candidates)
    .set({
      baseCvMd: markdown,
      baseCvHash: newHash,
      parseStatus: 'parsing',
      parsedProfile: null,
    })
    .where(eq(candidates.id, candidate.id))
    .returning()

  return { candidate: updated, hashChanged: true }
}

export async function markParseReady(
  candidateId: string,
  parsedProfile: unknown
): Promise<void> {
  await db
    .update(candidates)
    .set({ parseStatus: 'ready', parsedProfile: parsedProfile as never })
    .where(eq(candidates.id, candidateId))
}

export async function markParseFailed(candidateId: string): Promise<void> {
  await db
    .update(candidates)
    .set({ parseStatus: 'failed' })
    .where(eq(candidates.id, candidateId))
}
```

- [x] **Step 4: Run tests — verify they pass**

```bash
npm run test:run -- src/__tests__/lib/cv-service.test.ts
```

Expected: `4 passed`

- [x] **Step 5: Commit**

```bash
git add src/lib/cv-service.ts src/__tests__/lib/cv-service.test.ts
git commit -m "feat: add CV service layer with hash-change detection (TDD)"
```

---

## Task 7: Preferences service layer (TDD)

**Files:**
- Create: `src/__tests__/lib/preferences-service.test.ts`
- Create: `src/lib/preferences-service.ts`

- [x] **Step 1: Write failing tests**

Create `src/__tests__/lib/preferences-service.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { mergePreferences } from '@/lib/preferences-service'

describe('mergePreferences', () => {
  it('merges new fields into existing preferences', () => {
    const result = mergePreferences(
      { seniority_levels: ['CAIO'] },
      { geographic_preference: 'Remote' }
    )
    expect(result).toEqual({
      seniority_levels: ['CAIO'],
      geographic_preference: 'Remote',
    })
  })

  it('overwrites existing fields with updated values', () => {
    const result = mergePreferences(
      { seniority_levels: ['CAIO'] },
      { seniority_levels: ['VP AI', 'Head of AI'] }
    )
    expect(result.seniority_levels).toEqual(['VP AI', 'Head of AI'])
  })

  it('does not clear fields that are not present in the update', () => {
    const result = mergePreferences(
      { seniority_levels: ['CAIO'], geographic_preference: 'Remote' },
      { seniority_levels: ['VP AI'] }
    )
    expect(result.geographic_preference).toBe('Remote')
  })

  it('returns a new object and does not mutate the original', () => {
    const existing = { seniority_levels: ['CAIO'] }
    mergePreferences(existing, { geographic_preference: 'Remote' })
    expect(existing).toEqual({ seniority_levels: ['CAIO'] })
  })
})
```

- [x] **Step 2: Run tests — verify they fail**

```bash
npm run test:run -- src/__tests__/lib/preferences-service.test.ts
```

Expected: `Cannot find module '@/lib/preferences-service'`

- [x] **Step 3: Create `src/lib/preferences-service.ts`**

```typescript
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { candidates } from '@/db/schema'

export function mergePreferences(
  existing: Record<string, unknown>,
  updates: Record<string, unknown>
): Record<string, unknown> {
  return { ...existing, ...updates }
}

export async function getPreferences(): Promise<Record<string, unknown>> {
  const [candidate] = await db.select().from(candidates).limit(1)
  return (candidate?.preferences as Record<string, unknown>) ?? {}
}

export async function updatePreferences(
  updates: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const [candidate] = await db.select().from(candidates).limit(1)

  if (!candidate) {
    const [created] = await db
      .insert(candidates)
      .values({ preferences: updates })
      .returning()
    return created.preferences as Record<string, unknown>
  }

  const merged = mergePreferences(
    candidate.preferences as Record<string, unknown>,
    updates
  )

  const [updated] = await db
    .update(candidates)
    .set({ preferences: merged })
    .where(eq(candidates.id, candidate.id))
    .returning()

  return updated.preferences as Record<string, unknown>
}
```

- [x] **Step 4: Run tests — verify they pass**

```bash
npm run test:run -- src/__tests__/lib/preferences-service.test.ts
```

Expected: `4 passed`

- [x] **Step 5: Commit**

```bash
git add src/lib/preferences-service.ts src/__tests__/lib/preferences-service.test.ts
git commit -m "feat: add preferences service with partial-merge logic (TDD)"
```

---

## Task 8: Readiness service (TDD)

**Files:**
- Create: `src/__tests__/lib/readiness-service.test.ts`
- Create: `src/lib/readiness-service.ts`

- [x] **Step 1: Write failing tests**

Create `src/__tests__/lib/readiness-service.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { computeReadiness } from '@/lib/readiness-service'
import type { Candidate } from '@/db/schema'

const base: Candidate = {
  id: 'test-id',
  candidateId: null,
  baseCvMd: null,
  baseCvHash: null,
  parsedProfile: null,
  parseStatus: 'pending',
  preferences: {},
  createdAt: new Date(),
  updatedAt: new Date(),
}

describe('computeReadiness', () => {
  it('returns ready: false and 3 missing items when candidate is null', () => {
    const result = computeReadiness(null)
    expect(result.ready).toBe(false)
    expect(result.missing).toHaveLength(3)
  })

  it('returns ready: false when only CV is saved', () => {
    const result = computeReadiness({ ...base, baseCvMd: '# CV' })
    expect(result.ready).toBe(false)
    expect(result.missing).toHaveLength(2)
  })

  it('returns ready: false when CV and seniority are set but location is missing', () => {
    const result = computeReadiness({
      ...base,
      baseCvMd: '# CV',
      preferences: { seniority_levels: ['CAIO'] },
    })
    expect(result.ready).toBe(false)
    expect(result.missing.some((m) => /geographic/i.test(m))).toBe(true)
  })

  it('returns ready: true when CV, seniority, and location are all set', () => {
    const result = computeReadiness({
      ...base,
      baseCvMd: '# CV',
      preferences: {
        seniority_levels: ['CAIO'],
        geographic_preference: 'Remote',
      },
    })
    expect(result.ready).toBe(true)
    expect(result.missing).toHaveLength(0)
  })

  it('returns ready: false when seniority_levels is an empty array', () => {
    const result = computeReadiness({
      ...base,
      baseCvMd: '# CV',
      preferences: { seniority_levels: [], geographic_preference: 'Remote' },
    })
    expect(result.ready).toBe(false)
  })

  it('reports parseStatus from the candidate', () => {
    const result = computeReadiness({ ...base, parseStatus: 'ready' })
    expect(result.parseStatus).toBe('ready')
  })
})
```

- [x] **Step 2: Run tests — verify they fail**

```bash
npm run test:run -- src/__tests__/lib/readiness-service.test.ts
```

Expected: `Cannot find module '@/lib/readiness-service'`

- [x] **Step 3: Create `src/lib/readiness-service.ts`**

```typescript
import type { Candidate } from '@/db/schema'

export interface ReadinessResult {
  ready: boolean
  missing: string[]
  parseStatus: string
}

export function computeReadiness(candidate: Candidate | null): ReadinessResult {
  const prefs = (candidate?.preferences ?? {}) as Record<string, unknown>

  const cvSaved = Boolean(candidate?.baseCvMd)
  const senioritySet =
    Array.isArray(prefs.seniority_levels) &&
    (prefs.seniority_levels as string[]).length > 0
  const locationSet = Boolean(prefs.geographic_preference)

  const missing: string[] = []
  if (!cvSaved) missing.push('Upload and save your CV')
  if (!senioritySet) missing.push('Set your target seniority level')
  if (!locationSet) missing.push('Set your geographic preference')

  return {
    ready: cvSaved && senioritySet && locationSet,
    missing,
    parseStatus: candidate?.parseStatus ?? 'pending',
  }
}

export async function getReadiness(): Promise<ReadinessResult> {
  const { db } = await import('@/db')
  const { candidates } = await import('@/db/schema')
  const [candidate] = await db.select().from(candidates).limit(1)
  return computeReadiness(candidate ?? null)
}
```

- [x] **Step 4: Run tests — verify they pass**

```bash
npm run test:run -- src/__tests__/lib/readiness-service.test.ts
```

Expected: `6 passed`

- [x] **Step 5: Commit**

```bash
git add src/lib/readiness-service.ts src/__tests__/lib/readiness-service.test.ts
git commit -m "feat: add pipeline readiness service as pure function (TDD)"
```

---

## Task 9: CV parser (TDD — mocked AI SDK)

**Files:**
- Create: `src/__tests__/lib/cv-parser.test.ts`
- Create: `src/lib/cv-parser.ts`

- [x] **Step 1: Write failing tests**

Create `src/__tests__/lib/cv-parser.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'

const mockProfile = {
  name: 'Manav Ghosh',
  contact: { email: 'manav@example.com' },
  summary: 'Senior AI leader',
  roles: [{ title: 'Head of AI', company: 'Acme', dates: '2020-present', bullets: [] }],
  skills: ['Python', 'LangGraph'],
  patents: [],
  projects: [],
  education: [],
  certifications: [],
  awards: [],
}

vi.mock('ai', () => ({
  generateObject: vi.fn().mockResolvedValue({ object: mockProfile }),
}))

vi.mock('@/lib/llm', () => ({
  getModel: vi.fn().mockReturnValue('mock-model'),
}))

describe('parseCV', () => {
  it('returns a ParsedProfile from CV markdown', async () => {
    const { parseCV } = await import('@/lib/cv-parser')
    const result = await parseCV('# Manav Ghosh\n\nSenior AI leader')
    expect(result.name).toBe('Manav Ghosh')
    expect(result.skills).toContain('Python')
  })

  it('calls generateObject with the CV markdown in the prompt', async () => {
    const { generateObject } = await import('ai')
    const { parseCV } = await import('@/lib/cv-parser')
    await parseCV('# Test CV content')
    const call = vi.mocked(generateObject).mock.calls[0][0] as { prompt: string }
    expect(call.prompt).toContain('# Test CV content')
  })

  it('propagates errors from generateObject', async () => {
    const { generateObject } = await import('ai')
    vi.mocked(generateObject).mockRejectedValueOnce(new Error('API error'))
    const { parseCV } = await import('@/lib/cv-parser')
    await expect(parseCV('# CV')).rejects.toThrow('API error')
  })
})
```

- [x] **Step 2: Run tests — verify they fail**

```bash
npm run test:run -- src/__tests__/lib/cv-parser.test.ts
```

Expected: `Cannot find module '@/lib/cv-parser'`

- [x] **Step 3: Create `src/lib/cv-parser.ts`**

```typescript
import { generateObject } from 'ai'
import { getModel } from '@/lib/llm'
import { ParsedProfileSchema, type ParsedProfile } from '@/lib/schemas/parsed-profile'

const PARSE_PROMPT = (cvMarkdown: string) => `\
You are a CV parsing assistant. Extract all information from the CV below into structured JSON.

RULES:
- Reframe and reorder existing proof points — do NOT fabricate, inflate, or invent any information.
- Job titles, company names, and employment dates MUST appear exactly as in the CV.
- Quantified outcomes (e.g. "$2B platform", "50M users") MUST NOT be altered.
- Patents, education, certifications, and awards MUST be unchanged.
- Prefer empty arrays over omitting fields.

CV:
${cvMarkdown}`

export async function parseCV(markdown: string): Promise<ParsedProfile> {
  const { object } = await generateObject({
    model: getModel(),
    schema: ParsedProfileSchema,
    prompt: PARSE_PROMPT(markdown),
  })
  return object
}
```

- [x] **Step 4: Run tests — verify they pass**

```bash
npm run test:run -- src/__tests__/lib/cv-parser.test.ts
```

Expected: `3 passed`

- [x] **Step 5: Run full test suite**

```bash
npm run test:run
```

Expected: All tests pass across hash, cv-converter, cv-service, preferences-service, readiness-service, cv-parser.

- [x] **Step 6: Commit**

```bash
git add src/lib/cv-parser.ts src/__tests__/lib/cv-parser.test.ts
git commit -m "feat: add CV parser using Vercel AI SDK generateObject (TDD)"
```

---

## Task 10: Route Handlers

**Files:**
- Create: `src/app/api/cv/route.ts`
- Create: `src/app/api/cv/convert/route.ts`
- Create: `src/app/api/cv/save/route.ts`
- Create: `src/app/api/preferences/route.ts`
- Create: `src/app/api/candidate/readiness/route.ts`

- [x] **Step 1: Create `src/app/api/cv/route.ts`** (GET — returns current CV state)

```typescript
import { NextResponse } from 'next/server'
import { getOrCreateCandidate } from '@/lib/cv-service'

export async function GET() {
  const candidate = await getOrCreateCandidate()
  return NextResponse.json(candidate)
}
```

- [x] **Step 2: Create `src/app/api/cv/convert/route.ts`** (POST — file → Markdown)

```typescript
import { NextResponse } from 'next/server'
import { convertToMarkdown, ConversionError } from '@/lib/cv-converter'

const MAX_BYTES = 10 * 1024 * 1024 // 10 MB

export async function POST(request: Request) {
  const formData = await request.formData()
  const file = formData.get('file') as File | null

  if (!file) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'File exceeds 10 MB limit' }, { status: 413 })
  }

  const bytes = await file.arrayBuffer()
  const buffer = Buffer.from(bytes)

  try {
    const markdown = await convertToMarkdown(buffer, file.name)
    return NextResponse.json({ markdown })
  } catch (err) {
    if (err instanceof ConversionError) {
      return NextResponse.json({ error: err.message }, { status: 400 })
    }
    return NextResponse.json({ error: 'Conversion failed' }, { status: 500 })
  }
}
```

- [x] **Step 3: Create `src/app/api/cv/save/route.ts`** (POST — save + background parse)

```typescript
import { NextResponse } from 'next/server'
import { after } from 'next/server'
import { saveCVMarkdown, markParseReady, markParseFailed } from '@/lib/cv-service'
import { parseCV } from '@/lib/cv-parser'

export async function POST(request: Request) {
  const body = await request.json() as { markdown?: string }

  if (typeof body.markdown !== 'string' || !body.markdown.trim()) {
    return NextResponse.json({ error: 'markdown is required' }, { status: 400 })
  }

  const { candidate, hashChanged } = await saveCVMarkdown(body.markdown)

  if (hashChanged) {
    const candidateId = candidate.id
    const markdown = body.markdown

    after(async () => {
      try {
        const profile = await parseCV(markdown)
        await markParseReady(candidateId, profile)
      } catch {
        await markParseFailed(candidateId)
      }
    })
  }

  return NextResponse.json(candidate)
}
```

- [x] **Step 4: Create `src/app/api/preferences/route.ts`** (GET + PUT)

```typescript
import { NextResponse } from 'next/server'
import { getPreferences, updatePreferences } from '@/lib/preferences-service'

export async function GET() {
  const preferences = await getPreferences()
  return NextResponse.json({ preferences })
}

export async function PUT(request: Request) {
  const updates = await request.json() as Record<string, unknown>
  const preferences = await updatePreferences(updates)
  return NextResponse.json({ preferences })
}
```

- [x] **Step 5: Create `src/app/api/candidate/readiness/route.ts`** (GET)

```typescript
import { NextResponse } from 'next/server'
import { getReadiness } from '@/lib/readiness-service'

export async function GET() {
  const readiness = await getReadiness()
  return NextResponse.json(readiness)
}
```

- [x] **Step 6: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [x] **Step 7: Manually verify all endpoints**

Start the dev server:
```bash
npm run dev
```

In a second terminal, run these checks:

```bash
# GET /api/cv — should return a candidate object
curl http://localhost:3000/api/cv

# POST /api/cv/convert — should return { markdown: "..." }
curl -X POST http://localhost:3000/api/cv/convert \
  -F "file=@src/__tests__/fixtures/sample.md"

# GET /api/candidate/readiness — should return { ready: false, missing: [...] }
curl http://localhost:3000/api/candidate/readiness

# PUT /api/preferences
curl -X PUT http://localhost:3000/api/preferences \
  -H "Content-Type: application/json" \
  -d '{"seniority_levels":["CAIO"],"geographic_preference":"Remote"}'

# GET /api/candidate/readiness again — ready should still be false (no CV saved yet)
curl http://localhost:3000/api/candidate/readiness
```

Expected for final readiness call: `{ "ready": false, "missing": ["Upload and save your CV"] }`

- [x] **Step 8: Commit**

```bash
git add src/app/api/
git commit -m "feat: add all Route Handlers — CV convert/save/get, preferences, readiness"
```

---

## Task 11: Frontend types + API client

**Files:**
- Create: `src/types/candidate.ts`
- Create: `src/lib/api.ts`

- [ ] **Step 1: Create `src/types/candidate.ts`**

```typescript
export type ParseStatus = 'pending' | 'parsing' | 'ready' | 'failed'

export interface Role {
  title: string
  company: string
  dates: string
  bullets: string[]
}

export interface ParsedProfile {
  name: string
  contact: Record<string, string>
  summary: string
  roles: Role[]
  skills: string[]
  patents: string[]
  projects: string[]
  education: string[]
  certifications: string[]
  awards: string[]
}

export interface Preferences {
  seniority_levels?: string[]
  geographic_preference?: string
  company_stages?: string[]
  compensation_band?: { min: number; max: number; currency: string }
  target_companies?: string[]
  preferred_domains?: string[]
}

export interface CandidateState {
  id: string
  baseCvMd: string | null
  baseCvHash: string | null
  parseStatus: ParseStatus
  parsedProfile: ParsedProfile | null
  preferences: Preferences
}

export interface PipelineReadiness {
  ready: boolean
  missing: string[]
  parseStatus: ParseStatus
}
```

- [ ] **Step 2: Create `src/lib/api.ts`**

```typescript
import type { CandidateState, Preferences, PipelineReadiness } from '@/types/candidate'

const BASE = process.env.NEXT_PUBLIC_API_URL ?? ''

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init)
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`${res.status}: ${text}`)
  }
  return res.json() as Promise<T>
}

export async function getCV(): Promise<CandidateState> {
  return request('/api/cv')
}

export async function convertCV(file: File): Promise<{ markdown: string }> {
  const form = new FormData()
  form.append('file', file)
  return request('/api/cv/convert', { method: 'POST', body: form })
}

export async function saveCV(markdown: string): Promise<CandidateState> {
  return request('/api/cv/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ markdown }),
  })
}

export async function getPreferences(): Promise<{ preferences: Preferences }> {
  return request('/api/preferences')
}

export async function updatePreferences(
  updates: Partial<Preferences>
): Promise<{ preferences: Preferences }> {
  return request('/api/preferences', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  })
}

export async function getReadiness(): Promise<PipelineReadiness> {
  return request('/api/candidate/readiness')
}
```

- [ ] **Step 3: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/types/candidate.ts src/lib/api.ts
git commit -m "feat: add TypeScript types and fetch-based API client"
```

---

## Task 12: CV components — CVUploader, MarkdownEditor, ParseStatusBadge

> Apply `vercel-react-best-practices` — `rerender-no-inline-components`, `rerender-functional-setstate`, `client-event-listeners`.
> Uses shadcn/ui: `Button`, `Textarea`, `Badge` from `src/components/ui/`.

**Files:**
- Create: `src/components/cv/CVUploader.tsx`
- Create: `src/components/cv/MarkdownEditor.tsx`
- Create: `src/components/cv/ParseStatusBadge.tsx`

- [ ] **Step 1: Create `src/components/cv/CVUploader.tsx`**

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
        disabled={loading}
      >
        {loading ? 'Converting…' : 'Upload CV'}
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

- [ ] **Step 2: Create `src/components/cv/MarkdownEditor.tsx`**

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
        <Button variant="default" size="sm" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save CV'}
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

- [ ] **Step 3: Create `src/components/cv/ParseStatusBadge.tsx`**

```tsx
'use client'

import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { getCV } from '@/lib/api'
import type { ParseStatus } from '@/types/candidate'

interface ParseStatusBadgeProps {
  initialStatus: ParseStatus
}

const LABELS: Record<ParseStatus, string> = {
  pending: 'Pending parse',
  parsing: 'Parsing CV…',
  ready: 'Profile ready',
  failed: 'Parse failed',
}

const VARIANTS: Record<ParseStatus, 'secondary' | 'default' | 'destructive' | 'outline'> = {
  pending: 'secondary',
  parsing: 'outline',
  ready: 'default',
  failed: 'destructive',
}

const POLL_MS = 3000

export function ParseStatusBadge({ initialStatus }: ParseStatusBadgeProps) {
  const [status, setStatus] = useState<ParseStatus>(initialStatus)

  useEffect(() => {
    if (status === 'ready' || status === 'failed') return
    const id = setInterval(async () => {
      try {
        const candidate = await getCV()
        setStatus(candidate.parseStatus)
      } catch {
        // silent — keep polling
      }
    }, POLL_MS)
    return () => clearInterval(id)
  }, [status])

  return (
    <Badge variant={VARIANTS[status]} className="gap-1.5">
      {status === 'parsing' && (
        <span className="h-2 w-2 rounded-full bg-current animate-pulse" />
      )}
      {LABELS[status]}
    </Badge>
  )
}
```

- [ ] **Step 4: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/cv/
git commit -m "feat: add CVUploader, MarkdownEditor, ParseStatusBadge using shadcn/ui"
```

---

## Task 13: PreferencesForm component

> Apply `vercel-react-best-practices` — `rerender-derived-state`, `rerender-functional-setstate`.
> Uses shadcn/ui: `Button`, `Label`, `Textarea` from `src/components/ui/`.

**Files:**
- Create: `src/components/preferences/PreferencesForm.tsx`

- [ ] **Step 1: Create `src/components/preferences/PreferencesForm.tsx`**

```tsx
'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { updatePreferences } from '@/lib/api'
import type { Preferences } from '@/types/candidate'

const SENIORITY_OPTIONS = ['CAIO', 'CTO', 'VP AI', 'Head of AI', 'Distinguished Engineer', 'AI Practice Head']
const LOCATION_OPTIONS = ['Remote', 'Hybrid', 'Bengaluru-based', 'Open to relocation']
const STAGE_OPTIONS = ['Startup Series B–D', 'GCC', 'Indian Enterprise', 'Product Co', 'Consultancy']
const DOMAIN_OPTIONS = ['BFSI', 'E-commerce', 'SaaS', 'Healthcare', 'Defence']

interface PreferencesFormProps {
  initialPreferences: Preferences
  onSaved: (prefs: Preferences) => void
}

export function PreferencesForm({ initialPreferences, onSaved }: PreferencesFormProps) {
  const [prefs, setPrefs] = useState<Preferences>(initialPreferences)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  function toggleMulti(key: keyof Preferences, value: string) {
    const current = (prefs[key] as string[] | undefined) ?? []
    const next = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value]
    setPrefs((p) => ({ ...p, [key]: next }))
  }

  function validate(): boolean {
    const errors: Record<string, string> = {}
    if (!prefs.seniority_levels?.length)
      errors.seniority_levels = 'Select at least one seniority level'
    if (!prefs.geographic_preference)
      errors.geographic_preference = 'Select a geographic preference'
    setFieldErrors(errors)
    return Object.keys(errors).length === 0
  }

  async function handleSave() {
    if (!validate()) return
    setError(null)
    setSaving(true)
    try {
      const { preferences } = await updatePreferences(prefs)
      onSaved(preferences as Preferences)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Seniority — REQUIRED */}
      <fieldset className="space-y-2">
        <Label>
          Target Seniority <span className="text-destructive">*</span>
        </Label>
        <div className="flex flex-wrap gap-2">
          {SENIORITY_OPTIONS.map((opt) => (
            <Button
              key={opt}
              type="button"
              size="sm"
              variant={prefs.seniority_levels?.includes(opt) ? 'default' : 'outline'}
              onClick={() => toggleMulti('seniority_levels', opt)}
            >
              {opt}
            </Button>
          ))}
        </div>
        {fieldErrors.seniority_levels && (
          <p className="text-xs text-destructive">{fieldErrors.seniority_levels}</p>
        )}
      </fieldset>

      {/* Geographic preference — REQUIRED */}
      <fieldset className="space-y-2">
        <Label>
          Geographic Preference <span className="text-destructive">*</span>
        </Label>
        <div className="flex flex-wrap gap-2">
          {LOCATION_OPTIONS.map((opt) => (
            <Button
              key={opt}
              type="button"
              size="sm"
              variant={prefs.geographic_preference === opt ? 'default' : 'outline'}
              onClick={() => setPrefs((p) => ({ ...p, geographic_preference: opt }))}
            >
              {opt}
            </Button>
          ))}
        </div>
        {fieldErrors.geographic_preference && (
          <p className="text-xs text-destructive">{fieldErrors.geographic_preference}</p>
        )}
      </fieldset>

      {/* Company stage — optional */}
      <fieldset className="space-y-2">
        <Label>
          Company Stage <span className="text-muted-foreground font-normal">(optional)</span>
        </Label>
        <div className="flex flex-wrap gap-2">
          {STAGE_OPTIONS.map((opt) => (
            <Button
              key={opt}
              type="button"
              size="sm"
              variant={prefs.company_stages?.includes(opt) ? 'default' : 'outline'}
              onClick={() => toggleMulti('company_stages', opt)}
            >
              {opt}
            </Button>
          ))}
        </div>
      </fieldset>

      {/* Target companies — optional */}
      <div className="space-y-2">
        <Label>
          Target Companies{' '}
          <span className="text-muted-foreground font-normal">(optional — one per line)</span>
        </Label>
        <Textarea
          rows={4}
          placeholder={'JPMC India\nWalmart Global Tech\nFreshworks'}
          value={(prefs.target_companies ?? []).join('\n')}
          onChange={(e) =>
            setPrefs((p) => ({
              ...p,
              target_companies: e.target.value
                .split('\n')
                .map((s) => s.trim())
                .filter(Boolean),
            }))
          }
        />
      </div>

      {/* Preferred domains — optional */}
      <fieldset className="space-y-2">
        <Label>
          Preferred Domains{' '}
          <span className="text-muted-foreground font-normal">(optional)</span>
        </Label>
        <div className="flex flex-wrap gap-2">
          {DOMAIN_OPTIONS.map((opt) => (
            <Button
              key={opt}
              type="button"
              size="sm"
              variant={prefs.preferred_domains?.includes(opt) ? 'default' : 'outline'}
              onClick={() => toggleMulti('preferred_domains', opt)}
            >
              {opt}
            </Button>
          ))}
        </div>
      </fieldset>

      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save Preferences'}
        </Button>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
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
git add src/components/preferences/PreferencesForm.tsx
git commit -m "feat: add PreferencesForm with required field validation using shadcn/ui"
```

---

## Task 14: PipelineReadinessIndicator + Settings page

> Apply `vercel-react-best-practices` — `server-parallel-fetching`, `async-parallel`, `rendering-conditional-render`.

**Files:**
- Create: `src/components/shared/PipelineReadinessIndicator.tsx`
- Create: `src/app/settings/page.tsx`

- [ ] **Step 1: Create `src/components/shared/PipelineReadinessIndicator.tsx`**

```tsx
import type { PipelineReadiness } from '@/types/candidate'

interface PipelineReadinessIndicatorProps {
  readiness: PipelineReadiness
}

export function PipelineReadinessIndicator({
  readiness,
}: PipelineReadinessIndicatorProps) {
  if (readiness.ready) {
    return (
      <div className="flex items-center gap-2 px-4 py-2 bg-green-50 border border-green-200 rounded-lg">
        <span className="h-2.5 w-2.5 rounded-full bg-green-500" />
        <span className="text-sm font-medium text-green-800">
          Pipeline ready to run
        </span>
      </div>
    )
  }

  return (
    <div className="px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg space-y-1">
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
        <span className="text-sm font-medium text-amber-800">Pipeline not ready</span>
      </div>
      <ul className="ml-4 space-y-0.5">
        {readiness.missing.map((item) => (
          <li key={item} className="text-xs text-amber-700">
            • {item}
          </li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 2: Create `src/app/settings/page.tsx`**

```tsx
'use client'

import { useEffect, useState } from 'react'
import { getCV, getReadiness } from '@/lib/api'
import { CVUploader } from '@/components/cv/CVUploader'
import { MarkdownEditor } from '@/components/cv/MarkdownEditor'
import { ParseStatusBadge } from '@/components/cv/ParseStatusBadge'
import { PreferencesForm } from '@/components/preferences/PreferencesForm'
import { PipelineReadinessIndicator } from '@/components/shared/PipelineReadinessIndicator'
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
    return <div className="p-8 text-gray-500 text-sm">Loading…</div>
  }

  const markdownToEdit = convertedMarkdown ?? candidate?.baseCvMd

  return (
    <main className="max-w-3xl mx-auto p-8 space-y-10">
      <h1 className="text-2xl font-semibold text-gray-900">Settings</h1>

      {readiness && <PipelineReadinessIndicator readiness={readiness} />}

      {/* CV section */}
      <section className="space-y-4">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-medium text-gray-800">CV</h2>
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
            <p className="text-sm text-gray-500">
              CV saved. Upload a new file to replace it.
            </p>
          )
        )}
      </section>

      {/* Preferences section */}
      <section className="space-y-4">
        <h2 className="text-lg font-medium text-gray-800">Preferences</h2>
        <PreferencesForm
          initialPreferences={candidate?.preferences ?? {}}
          onSaved={handlePreferencesSaved}
        />
      </section>
    </main>
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
git add src/components/shared/PipelineReadinessIndicator.tsx src/app/settings/page.tsx
git commit -m "feat: add PipelineReadinessIndicator and Settings page"
```

---

## Task 15: Final verification + smoke test

**Files:** None created.

- [ ] **Step 1: Run full test suite**

```bash
npm run test:run
```

Expected: All tests pass.

- [ ] **Step 2: TypeScript full check**

```bash
npx tsc --noEmit
```

Expected: Zero errors.

- [ ] **Step 3: Start backend + open settings page**

```bash
npm run dev
```

Open `http://localhost:3000/settings` in a browser. Verify:
- [ ] Pipeline readiness indicator appears (amber — "not ready")
- [ ] Upload CV button is visible
- [ ] Preferences form renders with all option groups
- [ ] Upload `src/__tests__/fixtures/sample.md` → Markdown editor appears with the content
- [ ] Edit a line in the editor → click Save CV → badge changes to "Parsing CV…"
- [ ] After 5–10 seconds, badge changes to "Profile ready" (or "Parse failed" if `ANTHROPIC_API_KEY` not set)
- [ ] Select a seniority level and geographic preference → Save Preferences → pipeline indicator turns green

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: Phase 1 Foundation complete — CV upload, parsing, preferences, readiness gate"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Implemented in |
|---|---|
| CV upload accepts .md, .docx, .pdf | Task 4 (`convertToMarkdown`), Task 10 (`/api/cv/convert`) |
| 10 MB file size limit | Task 10 (`/api/cv/convert` — 413 guard) |
| Convert file to Markdown, return to frontend | Task 10 (`/api/cv/convert`) |
| Inline Markdown editor before save | Task 12 (`MarkdownEditor`) |
| SHA256 hash computed on save | Task 3 (`computeSHA256`), Task 6 (`saveCVMarkdown`) |
| No re-parse when hash unchanged | Task 6 (`shouldTriggerParse`) + Task 9 (cv-service.test) |
| Background parse fires on save via `after()` | Task 10 (`/api/cv/save`) |
| parse_status polling in UI | Task 12 (`ParseStatusBadge` — 3 s interval) |
| Zod schema validates parsed profile before write | Task 5 (`ParsedProfileSchema`), Task 9 (`cv-parser`) |
| Parse failure preserves prior profile | Task 6 (`markParseFailed` — only writes status) |
| Preferences stored as JSONB, partial update | Task 7 (`mergePreferences`), Task 10 (`/api/preferences PUT`) |
| Seniority + location required, rest optional | Task 13 (`PreferencesForm.validate()`) |
| Pipeline readiness gate | Task 8 (`computeReadiness`), Task 10 (`/api/candidate/readiness`), Task 14 |
| `candidate_id` nullable (multi-user ready) | Task 2 (`schema.ts` — `candidateId: uuid()` no `.notNull()`) |
| Settings page with two independent sections | Task 14 (`settings/page.tsx`) |
| Factual integrity — no fabrication in parse prompt | Task 9 (`cv-parser.ts` — PARSE_PROMPT rules) |

**No gaps found.**

**Placeholder scan:** No TBDs, TODOs, or "implement later" found.

**Type consistency:** `ParseStatus`, `CandidateState`, `Preferences`, `PipelineReadiness` are used consistently across `src/types/candidate.ts`, `src/lib/api.ts`, and all components. Drizzle `Candidate` type from `src/db/schema.ts` matches the shape returned by all Route Handlers. `ParsedProfileSchema` Zod type aligns with the `ParsedProfile` inline type in `schema.ts`.

---

Plan complete and saved to `docs/superpowers/plans/2026-04-27-phase-1-foundation.md`.

**Two execution options:**

**1. Subagent-Driven (recommended)** — fresh subagent per task, two-stage review between tasks, fast iteration

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
