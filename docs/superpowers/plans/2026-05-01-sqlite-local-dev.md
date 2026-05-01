# SQLite Local Dev Database Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add a local SQLite database option so both Next.js and the Python daemon can run fully offline without Neon PostgreSQL.

**Architecture:** A single `DATABASE_URL` env var drives everything — if the value starts with `postgresql://` or `postgres://` both services use their existing Neon/asyncpg drivers; any other value is treated as a SQLite file path. Next.js swaps its Drizzle driver via a webpack alias in `next.config.ts`; the Python daemon dispatches to a new `db_sqlite.py` via a rewritten `db.py`. Both share `./proxim-dev.db` at the repo root.

**Tech Stack:** `better-sqlite3`, `drizzle-orm/better-sqlite3`, `drizzle-orm/sqlite-core`, `drizzle-kit` (sqlite dialect), `aiosqlite`

---

### Task 1: Install Next.js SQLite dependency and gitignore the DB file

**Files:**
- Modify: `package.json`
- Modify: `.gitignore`

- [x] **Step 1: Install better-sqlite3**

```bash
npm install better-sqlite3
npm install --save-dev @types/better-sqlite3
```

Expected: both appear in `package.json` dependencies/devDependencies.

- [x] **Step 2: Add proxim-dev.db to .gitignore**

Open `.gitignore` and add at the end:

```
# local SQLite dev database
proxim-dev.db
```

- [x] **Step 3: Commit**

```bash
git add package.json package-lock.json .gitignore
git commit -m "chore: add better-sqlite3 and gitignore dev db"
```

---

### Task 2: Create the SQLite Drizzle schema

**Files:**
- Create: `src/db/schema.sqlite.ts`

All table names and column names (snake_case) are identical to the PG schema so both schemas produce the same DB structure. Types are mapped as: `uuid` → `text` with `$defaultFn(() => crypto.randomUUID())`, `jsonb` → `text({ mode: 'json' })`, `timestamp` → `text` with ISO-8601 strings, `pgEnum` → `text`.

- [x] **Step 1: Create `src/db/schema.sqlite.ts`**

```typescript
import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'

// ── inline types (mirrors schema.ts) ──────────────────────────────────────
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
  geographic_preference?: string[]
  company_stages?: string[]
  compensation_band?: { min: number; max: number; currency: string }
  target_companies?: string[]
  preferred_domains?: string[]
  enabled_sources?: string[]
  custom_job_sites?: string[]
}

// ── helpers ────────────────────────────────────────────────────────────────
const now = () => new Date().toISOString()
const newId = () => crypto.randomUUID()

// ── tables ─────────────────────────────────────────────────────────────────
export const candidates = sqliteTable('candidates', {
  id:             text().primaryKey().$defaultFn(newId),
  candidateId:    text(),
  baseCvMd:       text(),
  baseCvHash:     text(),
  parsedProfile:  text({ mode: 'json' }).$type<ParsedProfile | null>(),
  parseStatus:    text().default('pending').notNull(),
  preferences:    text({ mode: 'json' }).$type<Preferences>().default({} as Preferences).notNull(),
  createdAt:      text().$defaultFn(now).notNull(),
  updatedAt:      text().$defaultFn(now).$onUpdateFn(now).notNull(),
})

export type Candidate = typeof candidates.$inferSelect
export type NewCandidate = typeof candidates.$inferInsert

export const pipelineJobs = sqliteTable('pipeline_jobs', {
  id:          text().primaryKey().$defaultFn(newId),
  status:      text().default('queued').notNull(),
  jobType:     text().notNull(),
  candidateId: text().notNull().references(() => candidates.id),
  payload:     text({ mode: 'json' }).$type<Record<string, unknown>>().default({} as Record<string, unknown>).notNull(),
  createdAt:   text().$defaultFn(now).notNull(),
  startedAt:   text(),
  completedAt: text(),
  error:       text(),
})

export const pipelineRuns = sqliteTable('pipeline_runs', {
  id:                  text().primaryKey().$defaultFn(newId),
  pipelineJobId:       text().notNull().references(() => pipelineJobs.id),
  candidateId:         text().notNull().references(() => candidates.id),
  status:              text().default('running').notNull(),
  sourcesAttempted:    integer().default(0).notNull(),
  sourcesSuccessful:   integer().default(0).notNull(),
  jobsDiscovered:      integer().default(0).notNull(),
  jobsDeduplicated:    integer().default(0).notNull(),
  startedAt:           text().$defaultFn(now).notNull(),
  completedAt:         text(),
  summary:             text({ mode: 'json' }).$type<Record<string, unknown>>(),
  error:               text(),
})

export const jobs = sqliteTable('jobs', {
  id:             text().primaryKey().$defaultFn(newId),
  candidateId:    text().notNull().references(() => candidates.id),
  pipelineRunId:  text().notNull().references(() => pipelineRuns.id),
  title:          text().notNull(),
  company:        text().notNull(),
  location:       text(),
  jdRaw:          text().notNull(),
  jdText:         text(),
  source:         text().notNull(),
  sourceUrl:      text().notNull(),
  applicationUrl: text(),
  postedAt:       text(),
  status:         text().default('discovered').notNull(),
  createdAt:      text().$defaultFn(now).notNull(),
  updatedAt:      text().$defaultFn(now).$onUpdateFn(now).notNull(),
}, (table) => [
  index('jobs_candidate_status_idx').on(table.candidateId, table.status),
  index('jobs_candidate_source_url_idx').on(table.candidateId, table.sourceUrl),
])

export const scanHistory = sqliteTable('scan_history', {
  id:          text().primaryKey().$defaultFn(newId),
  candidateId: text().notNull().references(() => candidates.id),
  url:         text().notNull(),
  jobId:       text().references(() => jobs.id),
  firstSeenAt: text().$defaultFn(now).notNull(),
  lastSeenAt:  text().$defaultFn(now).notNull(),
}, (table) => [
  uniqueIndex('scan_history_candidate_url_idx').on(table.candidateId, table.url),
])

export const pipelineLogs = sqliteTable('pipeline_logs', {
  id:            text().primaryKey().$defaultFn(newId),
  pipelineJobId: text().notNull().references(() => pipelineJobs.id),
  level:         text().notNull(),
  step:          text().notNull(),
  message:       text().notNull(),
  data:          text({ mode: 'json' }).$type<Record<string, unknown>>(),
  createdAt:     text().$defaultFn(now).notNull(),
}, (table) => [
  index('pipeline_logs_job_created_idx').on(table.pipelineJobId, table.createdAt),
])

export type PipelineLog = typeof pipelineLogs.$inferSelect
```

- [x] **Step 2: Type-check the new file**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [x] **Step 3: Commit**

```bash
git add src/db/schema.sqlite.ts
git commit -m "feat: add SQLite Drizzle schema"
```

---

### Task 3: Create the SQLite Drizzle database instance

**Files:**
- Create: `src/db/index.sqlite.ts`

- [x] **Step 1: Create `src/db/index.sqlite.ts`**

```typescript
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema.sqlite'

const url = process.env.DATABASE_URL ?? './proxim-dev.db'
const client = new Database(url)

// Enable WAL mode for better concurrent read performance
client.pragma('journal_mode = WAL')
client.pragma('foreign_keys = ON')

export const db = drizzle(client, { schema, casing: 'snake_case' })
```

- [x] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [x] **Step 3: Commit**

```bash
git add src/db/index.sqlite.ts
git commit -m "feat: add SQLite Drizzle instance"
```

---

### Task 4: Add Drizzle Kit SQLite config and npm scripts

**Files:**
- Create: `drizzle.sqlite.config.ts`
- Modify: `package.json`

- [x] **Step 1: Create `drizzle.sqlite.config.ts`**

```typescript
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/db/schema.sqlite.ts',
  out: './migrations/sqlite',
  dialect: 'sqlite',
  casing: 'snake_case',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? './proxim-dev.db',
  },
})
```

- [x] **Step 2: Add scripts to `package.json`**

In the `"scripts"` section, add these three entries alongside the existing `db:*` scripts:

```json
"db:generate:sqlite": "drizzle-kit generate --config=drizzle.sqlite.config.ts",
"db:migrate:sqlite":  "drizzle-kit migrate  --config=drizzle.sqlite.config.ts",
"db:studio:sqlite":   "drizzle-kit studio   --config=drizzle.sqlite.config.ts"
```

- [x] **Step 3: Generate and apply SQLite migrations**

```bash
DATABASE_URL=./proxim-dev.db npm run db:generate:sqlite
DATABASE_URL=./proxim-dev.db npm run db:migrate:sqlite
```

Expected: `migrations/sqlite/` folder created with SQL files; `proxim-dev.db` file created at repo root.

- [x] **Step 4: Verify DB was created**

```bash
npx better-sqlite3 ./proxim-dev.db ".tables"
```

Expected output lists: `candidates  jobs  pipeline_jobs  pipeline_logs  pipeline_runs  scan_history`

- [x] **Step 5: Commit**

```bash
git add drizzle.sqlite.config.ts package.json migrations/sqlite/
git commit -m "feat: add SQLite drizzle-kit config and migration scripts"
```

---

### Task 5: Wire up Next.js webpack alias to swap drivers at build time

**Files:**
- Modify: `next.config.ts`

When `DATABASE_URL` does not start with `postgresql` or `postgres`, webpack resolves `@/db` and `@/db/schema` to the SQLite files instead of the default PG files. TypeScript continues to type-check against the PG schema (tsconfig paths stay unchanged) — this is intentional: the query API is identical and PG types are the production contract.

- [x] **Step 1: Replace `next.config.ts` with**

```typescript
import type { NextConfig } from 'next'
import path from 'path'

const dbUrl = process.env.DATABASE_URL ?? ''
const isSqlite = dbUrl !== '' && !dbUrl.startsWith('postgresql') && !dbUrl.startsWith('postgres')

const config: NextConfig = {
  webpack(webpackConfig) {
    if (isSqlite) {
      webpackConfig.resolve.alias = {
        ...webpackConfig.resolve.alias,
        '@/db':        path.resolve(__dirname, 'src/db/index.sqlite.ts'),
        '@/db/schema': path.resolve(__dirname, 'src/db/schema.sqlite.ts'),
      }
    }
    return webpackConfig
  },
}

export default config
```

- [x] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [x] **Step 3: Commit**

```bash
git add next.config.ts
git commit -m "feat: swap @/db webpack alias to SQLite when DATABASE_URL is a file path"
```

---

### Task 6: Fix pipeline trigger route — replace PG-only raw SQL with dialect-agnostic Drizzle query

**Files:**
- Modify: `src/app/api/pipeline/trigger/route.ts`

The current auto-expire uses `INTERVAL '30 minutes'` which is PostgreSQL-only. Replace it with Drizzle query builder that works on both PG and SQLite.

- [x] **Step 1: Update imports in `src/app/api/pipeline/trigger/route.ts`**

Replace the existing import block at the top of the file with:

```typescript
import { NextResponse } from 'next/server'
import { and, eq, isNull, lt, or } from 'drizzle-orm'
import { db } from '@/db'
import { pipelineJobs } from '@/db/schema'
import { getOrCreateCandidate } from '@/lib/cv-service'
```

- [x] **Step 2: Replace the raw `db.execute(sql\`...\`)` auto-expire block**

Find this block (lines 29–35):

```typescript
    // Auto-expire jobs stuck in running/queued for > 30 minutes (daemon was killed)
    await db.execute(sql`
      UPDATE pipeline_jobs
      SET status = 'failed', error = 'Expired — daemon did not complete this job'
      WHERE (status = 'queued' OR status = 'running')
        AND (started_at IS NULL OR started_at < NOW() - INTERVAL '30 minutes')
    `)
```

Replace it with:

```typescript
    // Auto-expire jobs stuck in running/queued for > 30 minutes (daemon was killed)
    const expiry = new Date(Date.now() - 30 * 60 * 1000)
    await db
      .update(pipelineJobs)
      .set({ status: 'failed', error: 'Expired — daemon did not complete this job' })
      .where(
        and(
          or(eq(pipelineJobs.status, 'queued'), eq(pipelineJobs.status, 'running')),
          or(isNull(pipelineJobs.startedAt), lt(pipelineJobs.startedAt, expiry)),
        ),
      )
```

Also remove the unused `sql` import from `drizzle-orm` if it's only used here (check the top of the file).

- [x] **Step 3: Run the existing test suite**

```bash
npm run test:run
```

Expected: 0 failures.

- [x] **Step 4: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [x] **Step 5: Commit**

```bash
git add src/app/api/pipeline/trigger/route.ts
git commit -m "fix: replace PG-only INTERVAL raw SQL with dialect-agnostic Drizzle query"
```

---

### Task 7: Update .env.local to use SQLite, verify Next.js works

**Files:**
- Modify: `.env.local`

- [x] **Step 1: Edit `.env.local`** — comment out the Neon URL and add the SQLite path:

```
# Neon PostgreSQL (production) — uncomment to switch back
# DATABASE_URL=postgresql://neondb_owner:npg_STfzaEB8lcP2@ep-wispy-boat-amakq0i7-pooler.c-5.us-east-1.aws.neon.tech/neondb?sslmode=require

# SQLite (local dev)
DATABASE_URL=./proxim-dev.db

LLM_PROVIDER=anthropic
LLM_MODEL=claude-sonnet-4-6
ANTHROPIC_API_KEY=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
```

- [x] **Step 2: Start the dev server**

```bash
npm run dev
```

Expected: server starts without errors, no DB connection errors in console.

- [x] **Step 3: Smoke-test the CV endpoint**

```bash
curl -s http://localhost:3000/api/cv
```

Expected: `{"id":"...","parseStatus":"pending",...}` — a new candidate row auto-created in SQLite.

- [x] **Step 4: Smoke-test the pipeline trigger**

```bash
curl -s -X POST http://localhost:3000/api/pipeline/trigger \
  -H "Content-Type: application/json" \
  -d '{"jobType":"discovery_only"}'
```

Expected: `{"jobId":"...","status":"queued","createdAt":"..."}` with HTTP 201.

- [x] **Step 5: Verify DB row was written**

```bash
npx better-sqlite3 ./proxim-dev.db "SELECT id, status FROM pipeline_jobs;"
```

Expected: one row with `status = queued`.

- [x] **Step 6: Run full test suite**

```bash
npm run test:run
```

Expected: 0 failures.

- [x] **Step 7: Commit**

```bash
git add .env.local
git commit -m "chore: switch local dev to SQLite DATABASE_URL"
```

---

### Task 8: Add aiosqlite to Python agent

**Files:**
- Modify: `agent/pyproject.toml`

- [x] **Step 1: Add aiosqlite dependency**

In `agent/pyproject.toml`, add `aiosqlite` to `[tool.poetry.dependencies]`:

```toml
aiosqlite = "^0.20"
```

- [x] **Step 2: Install**

```bash
cd agent
poetry add aiosqlite
```

Expected: `aiosqlite` appears in `poetry.lock`.

- [x] **Step 3: Commit**

```bash
git add agent/pyproject.toml agent/poetry.lock
git commit -m "chore: add aiosqlite dependency to Python agent"
```

---

### Task 9: Split db.py — move PostgreSQL implementation to db_pg.py

**Files:**
- Create: `agent/agent/db_pg.py`
- Modify: `agent/agent/db.py` (will become dispatcher in Task 11 — leave unchanged for now)

- [x] **Step 1: Create `agent/agent/db_pg.py`** — copy the full current content of `agent/agent/db.py` verbatim:

```python
"""PostgreSQL database query functions for the Proxim agent (production)."""
import asyncpg
from typing import Optional


async def create_pool(database_url: str) -> asyncpg.Pool:
    return await asyncpg.create_pool(database_url, min_size=1, max_size=5)


async def close_pool(pool: asyncpg.Pool) -> None:
    await pool.close()


async def claim_pipeline_job(pool: asyncpg.Pool) -> Optional[dict]:
    async with pool.acquire() as conn:
        row = await conn.fetchrow("""
            UPDATE pipeline_jobs
            SET status = 'running', started_at = NOW()
            WHERE id = (
                SELECT id FROM pipeline_jobs
                WHERE status = 'queued'
                ORDER BY created_at
                LIMIT 1
                FOR UPDATE SKIP LOCKED
            )
            RETURNING id, status, job_type, candidate_id, payload
        """)
        if row is None:
            return None
        result = dict(row)
        result['status'] = 'running'
        return result


async def update_pipeline_job_status(
    pool: asyncpg.Pool,
    job_id: str,
    status: str,
    error: Optional[str] = None,
) -> None:
    async with pool.acquire() as conn:
        if status in ('completed', 'failed'):
            await conn.execute("""
                UPDATE pipeline_jobs
                SET status = $1, completed_at = NOW(), error = $2
                WHERE id = $3
            """, status, error, job_id)
        else:
            await conn.execute("""
                UPDATE pipeline_jobs SET status = $1 WHERE id = $2
            """, status, job_id)


async def insert_pipeline_run(
    pool: asyncpg.Pool,
    pipeline_job_id: str,
    candidate_id: str,
) -> str:
    async with pool.acquire() as conn:
        row = await conn.fetchrow("""
            INSERT INTO pipeline_runs (pipeline_job_id, candidate_id, status)
            VALUES ($1, $2, 'running')
            RETURNING id
        """, pipeline_job_id, candidate_id)
        return str(row['id'])


async def update_pipeline_run(pool: asyncpg.Pool, run_id: str, **kwargs) -> None:
    if not kwargs:
        return
    import json
    set_clauses = []
    values = []
    for i, (key, value) in enumerate(kwargs.items(), start=1):
        col = _to_snake(key)
        if isinstance(value, (dict, list)):
            set_clauses.append(f"{col} = ${i}::jsonb")
            values.append(json.dumps(value))
        else:
            set_clauses.append(f"{col} = ${i}")
            values.append(value)
    values.append(run_id)
    query = f"UPDATE pipeline_runs SET {', '.join(set_clauses)} WHERE id = ${len(values)}"
    async with pool.acquire() as conn:
        await conn.execute(query, *values)


async def get_scan_history_urls(pool: asyncpg.Pool, candidate_id: str) -> set[str]:
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT url FROM scan_history WHERE candidate_id = $1
        """, candidate_id)
        return {row['url'] for row in rows}


async def bulk_insert_jobs(pool: asyncpg.Pool, jobs: list[dict]) -> list[str]:
    if not jobs:
        return []
    async with pool.acquire() as conn:
        ids = []
        for job in jobs:
            row = await conn.fetchrow("""
                INSERT INTO jobs
                  (candidate_id, pipeline_run_id, title, company, location,
                   jd_raw, jd_text, source, source_url, application_url, posted_at)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
                RETURNING id
            """,
                job['candidate_id'], job['pipeline_run_id'], job['title'],
                job['company'], job.get('location'), job['jd_raw'],
                job.get('jd_text'), job['source'], job['source_url'],
                job.get('application_url'), job.get('posted_at'),
            )
            ids.append(str(row['id']))
        return ids


async def bulk_insert_scan_history(pool: asyncpg.Pool, entries: list[dict]) -> None:
    if not entries:
        return
    async with pool.acquire() as conn:
        for entry in entries:
            await conn.execute("""
                INSERT INTO scan_history (candidate_id, url, job_id)
                VALUES ($1, $2, $3)
                ON CONFLICT (candidate_id, url) DO UPDATE SET last_seen_at = NOW()
            """, entry['candidate_id'], entry['url'], entry.get('job_id'))


async def insert_pipeline_log(
    pool: asyncpg.Pool,
    pipeline_job_id: str,
    level: str,
    step: str,
    message: str,
    data: dict | None = None,
) -> None:
    import json
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO pipeline_logs (pipeline_job_id, level, step, message, data)
            VALUES ($1, $2, $3, $4, $5)
            """,
            pipeline_job_id, level, step, message,
            json.dumps(data) if data is not None else None,
        )


async def get_candidate_preferences(pool: asyncpg.Pool, candidate_id: str) -> dict:
    import json
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT preferences FROM candidates WHERE id = $1",
            candidate_id,
        )
        if not row or not row['preferences']:
            return {}
        prefs = row['preferences']
        if isinstance(prefs, str):
            return json.loads(prefs)
        return dict(prefs)


def _to_snake(name: str) -> str:
    import re
    s1 = re.sub('(.)([A-Z][a-z]+)', r'\1_\2', name)
    return re.sub('([a-z0-9])([A-Z])', r'\1_\2', s1).lower()
```

- [x] **Step 2: Run existing Python unit tests to confirm nothing broke**

```bash
cd agent
poetry run pytest tests/unit/ -v
```

Expected: all tests pass (db_pg.py not yet imported — db.py still intact).

- [x] **Step 3: Commit**

```bash
git add agent/agent/db_pg.py
git commit -m "feat: add db_pg.py — extract PostgreSQL DB implementation"
```

---

### Task 10: Create the SQLite database implementation

**Files:**
- Create: `agent/agent/db_sqlite.py`
- Create: `agent/tests/unit/test_db_sqlite.py`

Key differences from db_pg.py:
- `asyncpg.Pool` → `aiosqlite.Connection`  
- `$1,$2,...` placeholders → `?,?,...`
- `FOR UPDATE SKIP LOCKED` → `asyncio.Lock` (safe for single daemon process)
- `gen_random_uuid()` → `str(uuid.uuid4())`
- `NOW()` → `datetime.now(timezone.utc).isoformat()`
- `::jsonb` casts removed
- `pool.acquire()` context manager removed (connection used directly)

- [x] **Step 1: Create `agent/agent/db_sqlite.py`**

```python
"""SQLite database query functions for the Proxim agent (local dev)."""
from __future__ import annotations

import asyncio
import json
import re
import uuid
from datetime import datetime, timezone
from typing import Optional

import aiosqlite

# Single asyncio lock prevents concurrent job claims in the one daemon process.
_claim_lock: asyncio.Lock = asyncio.Lock()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_id() -> str:
    return str(uuid.uuid4())


def _to_snake(name: str) -> str:
    s1 = re.sub('(.)([A-Z][a-z]+)', r'\1_\2', name)
    return re.sub('([a-z0-9])([A-Z])', r'\1_\2', s1).lower()


async def create_pool(database_url: str) -> aiosqlite.Connection:
    """Open a SQLite connection. database_url is a file path (not a postgresql:// URL)."""
    path = database_url
    for prefix in ('sqlite:///', 'sqlite://', 'file:'):
        if path.startswith(prefix):
            path = path[len(prefix):]
            break
    conn = await aiosqlite.connect(path)
    await conn.execute('PRAGMA journal_mode=WAL')
    await conn.execute('PRAGMA foreign_keys=ON')
    return conn


async def close_pool(pool: aiosqlite.Connection) -> None:
    await pool.close()


async def claim_pipeline_job(pool: aiosqlite.Connection) -> Optional[dict]:
    """
    Claim one queued pipeline job using an asyncio.Lock instead of
    FOR UPDATE SKIP LOCKED (safe for single-process local dev).
    """
    async with _claim_lock:
        async with pool.execute(
            "SELECT id, status, job_type, candidate_id, payload "
            "FROM pipeline_jobs WHERE status = 'queued' ORDER BY created_at LIMIT 1"
        ) as cursor:
            row = await cursor.fetchone()

        if row is None:
            return None

        job_id = row[0]
        await pool.execute(
            "UPDATE pipeline_jobs SET status = 'running', started_at = ? WHERE id = ?",
            (_now(), job_id),
        )
        await pool.commit()

        return {
            'id': job_id,
            'status': 'running',
            'job_type': row[2],
            'candidate_id': row[3],
            'payload': json.loads(row[4]) if row[4] else {},
        }


async def update_pipeline_job_status(
    pool: aiosqlite.Connection,
    job_id: str,
    status: str,
    error: Optional[str] = None,
) -> None:
    if status in ('completed', 'failed'):
        await pool.execute(
            'UPDATE pipeline_jobs SET status = ?, completed_at = ?, error = ? WHERE id = ?',
            (status, _now(), error, job_id),
        )
    else:
        await pool.execute(
            'UPDATE pipeline_jobs SET status = ? WHERE id = ?',
            (status, job_id),
        )
    await pool.commit()


async def insert_pipeline_run(
    pool: aiosqlite.Connection,
    pipeline_job_id: str,
    candidate_id: str,
) -> str:
    run_id = _new_id()
    await pool.execute(
        "INSERT INTO pipeline_runs (id, pipeline_job_id, candidate_id, status, started_at) "
        "VALUES (?, ?, ?, 'running', ?)",
        (run_id, pipeline_job_id, candidate_id, _now()),
    )
    await pool.commit()
    return run_id


async def update_pipeline_run(
    pool: aiosqlite.Connection,
    run_id: str,
    **kwargs: object,
) -> None:
    if not kwargs:
        return
    cols: list[str] = []
    values: list[object] = []
    for key, val in kwargs.items():
        cols.append(f'{_to_snake(key)} = ?')
        values.append(json.dumps(val) if isinstance(val, (dict, list)) else val)
    values.append(run_id)
    await pool.execute(
        f"UPDATE pipeline_runs SET {', '.join(cols)} WHERE id = ?",
        values,
    )
    await pool.commit()


async def get_scan_history_urls(
    pool: aiosqlite.Connection,
    candidate_id: str,
) -> set[str]:
    async with pool.execute(
        'SELECT url FROM scan_history WHERE candidate_id = ?',
        (candidate_id,),
    ) as cursor:
        rows = await cursor.fetchall()
    return {row[0] for row in rows}


async def bulk_insert_jobs(
    pool: aiosqlite.Connection,
    jobs: list[dict],
) -> list[str]:
    if not jobs:
        return []
    ids: list[str] = []
    for job in jobs:
        job_id = _new_id()
        posted = job.get('posted_at')
        posted_str = posted.isoformat() if hasattr(posted, 'isoformat') else posted
        await pool.execute(
            'INSERT INTO jobs '
            '(id, candidate_id, pipeline_run_id, title, company, location, '
            'jd_raw, jd_text, source, source_url, application_url, posted_at) '
            'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            (
                job_id,
                job['candidate_id'],
                job['pipeline_run_id'],
                job['title'],
                job['company'],
                job.get('location'),
                job['jd_raw'],
                job.get('jd_text'),
                job['source'],
                job['source_url'],
                job.get('application_url'),
                posted_str,
            ),
        )
        ids.append(job_id)
    await pool.commit()
    return ids


async def bulk_insert_scan_history(
    pool: aiosqlite.Connection,
    entries: list[dict],
) -> None:
    if not entries:
        return
    for entry in entries:
        await pool.execute(
            'INSERT INTO scan_history (id, candidate_id, url, job_id) VALUES (?, ?, ?, ?) '
            'ON CONFLICT (candidate_id, url) DO UPDATE SET last_seen_at = ?',
            (_new_id(), entry['candidate_id'], entry['url'], entry.get('job_id'), _now()),
        )
    await pool.commit()


async def insert_pipeline_log(
    pool: aiosqlite.Connection,
    pipeline_job_id: str,
    level: str,
    step: str,
    message: str,
    data: dict | None = None,
) -> None:
    await pool.execute(
        'INSERT INTO pipeline_logs (id, pipeline_job_id, level, step, message, data) '
        'VALUES (?, ?, ?, ?, ?, ?)',
        (_new_id(), pipeline_job_id, level, step, message,
         json.dumps(data) if data is not None else None),
    )
    await pool.commit()


async def get_candidate_preferences(
    pool: aiosqlite.Connection,
    candidate_id: str,
) -> dict:
    async with pool.execute(
        'SELECT preferences FROM candidates WHERE id = ?',
        (candidate_id,),
    ) as cursor:
        row = await cursor.fetchone()
    if row is None or row[0] is None:
        return {}
    prefs = row[0]
    return json.loads(prefs) if isinstance(prefs, str) else dict(prefs)
```

- [x] **Step 2: Create `agent/tests/unit/test_db_sqlite.py`**

```python
"""Unit tests for db_sqlite.py using an in-memory SQLite database."""
import json
import pytest
import aiosqlite

from agent.db_sqlite import (
    create_pool,
    close_pool,
    claim_pipeline_job,
    update_pipeline_job_status,
    insert_pipeline_run,
    update_pipeline_run,
    get_scan_history_urls,
    bulk_insert_jobs,
    bulk_insert_scan_history,
    insert_pipeline_log,
    get_candidate_preferences,
)

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS candidates (
    id TEXT PRIMARY KEY,
    candidate_id TEXT,
    base_cv_md TEXT,
    base_cv_hash TEXT,
    parsed_profile TEXT,
    parse_status TEXT NOT NULL DEFAULT 'pending',
    preferences TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS pipeline_jobs (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'queued',
    job_type TEXT NOT NULL,
    candidate_id TEXT NOT NULL REFERENCES candidates(id),
    payload TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    started_at TEXT,
    completed_at TEXT,
    error TEXT
);
CREATE TABLE IF NOT EXISTS pipeline_runs (
    id TEXT PRIMARY KEY,
    pipeline_job_id TEXT NOT NULL REFERENCES pipeline_jobs(id),
    candidate_id TEXT NOT NULL REFERENCES candidates(id),
    status TEXT NOT NULL DEFAULT 'running',
    sources_attempted INTEGER NOT NULL DEFAULT 0,
    sources_successful INTEGER NOT NULL DEFAULT 0,
    jobs_discovered INTEGER NOT NULL DEFAULT 0,
    jobs_deduplicated INTEGER NOT NULL DEFAULT 0,
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT,
    summary TEXT,
    error TEXT
);
CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    candidate_id TEXT NOT NULL REFERENCES candidates(id),
    pipeline_run_id TEXT NOT NULL REFERENCES pipeline_runs(id),
    title TEXT NOT NULL,
    company TEXT NOT NULL,
    location TEXT,
    jd_raw TEXT NOT NULL,
    jd_text TEXT,
    source TEXT NOT NULL,
    source_url TEXT NOT NULL,
    application_url TEXT,
    posted_at TEXT,
    status TEXT NOT NULL DEFAULT 'discovered',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS scan_history (
    id TEXT PRIMARY KEY,
    candidate_id TEXT NOT NULL REFERENCES candidates(id),
    url TEXT NOT NULL,
    job_id TEXT REFERENCES jobs(id),
    first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (candidate_id, url)
);
CREATE TABLE IF NOT EXISTS pipeline_logs (
    id TEXT PRIMARY KEY,
    pipeline_job_id TEXT NOT NULL REFERENCES pipeline_jobs(id),
    level TEXT NOT NULL,
    step TEXT NOT NULL,
    message TEXT NOT NULL,
    data TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
"""

CANDIDATE_ID = "00000000-0000-0000-0000-000000000001"
JOB_ID_FIXTURE = "00000000-0000-0000-0000-000000000002"


@pytest.fixture
async def conn():
    """In-memory SQLite connection with full schema applied."""
    db = await aiosqlite.connect(":memory:")
    await db.executescript(SCHEMA_SQL)
    await db.execute(
        "INSERT INTO candidates (id, preferences) VALUES (?, ?)",
        (CANDIDATE_ID, json.dumps({"enabled_sources": ["linkedin"]})),
    )
    await db.commit()
    yield db
    await db.close()


@pytest.fixture
async def job_id(conn):
    """Insert a queued pipeline job and return its id."""
    await conn.execute(
        "INSERT INTO pipeline_jobs (id, job_type, candidate_id) VALUES (?, 'discovery_only', ?)",
        (JOB_ID_FIXTURE, CANDIDATE_ID),
    )
    await conn.commit()
    return JOB_ID_FIXTURE


async def test_claim_pipeline_job_returns_job(conn, job_id):
    result = await claim_pipeline_job(conn)
    assert result is not None
    assert result['id'] == job_id
    assert result['status'] == 'running'
    assert result['job_type'] == 'discovery_only'


async def test_claim_pipeline_job_returns_none_when_empty(conn):
    result = await claim_pipeline_job(conn)
    assert result is None


async def test_claim_sets_status_to_running_in_db(conn, job_id):
    await claim_pipeline_job(conn)
    async with conn.execute("SELECT status FROM pipeline_jobs WHERE id = ?", (job_id,)) as cur:
        row = await cur.fetchone()
    assert row[0] == 'running'


async def test_update_pipeline_job_status_completed(conn, job_id):
    await claim_pipeline_job(conn)
    await update_pipeline_job_status(conn, job_id, 'completed')
    async with conn.execute("SELECT status, completed_at FROM pipeline_jobs WHERE id = ?", (job_id,)) as cur:
        row = await cur.fetchone()
    assert row[0] == 'completed'
    assert row[1] is not None


async def test_update_pipeline_job_status_failed_with_error(conn, job_id):
    await update_pipeline_job_status(conn, job_id, 'failed', error='boom')
    async with conn.execute("SELECT status, error FROM pipeline_jobs WHERE id = ?", (job_id,)) as cur:
        row = await cur.fetchone()
    assert row[0] == 'failed'
    assert row[1] == 'boom'


async def test_insert_pipeline_run_returns_id(conn, job_id):
    run_id = await insert_pipeline_run(conn, job_id, CANDIDATE_ID)
    assert isinstance(run_id, str) and len(run_id) == 36


async def test_update_pipeline_run(conn, job_id):
    run_id = await insert_pipeline_run(conn, job_id, CANDIDATE_ID)
    await update_pipeline_run(conn, run_id, jobsDiscovered=5, status='completed')
    async with conn.execute("SELECT jobs_discovered, status FROM pipeline_runs WHERE id = ?", (run_id,)) as cur:
        row = await cur.fetchone()
    assert row[0] == 5
    assert row[1] == 'completed'


async def test_get_scan_history_urls_empty(conn):
    urls = await get_scan_history_urls(conn, CANDIDATE_ID)
    assert urls == set()


async def test_bulk_insert_scan_history_and_retrieve(conn):
    entries = [
        {'candidate_id': CANDIDATE_ID, 'url': 'https://example.com/job/1', 'job_id': None},
        {'candidate_id': CANDIDATE_ID, 'url': 'https://example.com/job/2', 'job_id': None},
    ]
    await bulk_insert_scan_history(conn, entries)
    urls = await get_scan_history_urls(conn, CANDIDATE_ID)
    assert urls == {'https://example.com/job/1', 'https://example.com/job/2'}


async def test_bulk_insert_scan_history_upsert(conn):
    entry = {'candidate_id': CANDIDATE_ID, 'url': 'https://example.com/job/1', 'job_id': None}
    await bulk_insert_scan_history(conn, [entry])
    await bulk_insert_scan_history(conn, [entry])  # second insert should upsert, not error
    async with conn.execute("SELECT COUNT(*) FROM scan_history") as cur:
        row = await cur.fetchone()
    assert row[0] == 1


async def test_bulk_insert_jobs(conn, job_id):
    run_id = await insert_pipeline_run(conn, job_id, CANDIDATE_ID)
    jobs = [{
        'candidate_id': CANDIDATE_ID,
        'pipeline_run_id': run_id,
        'title': 'Staff Engineer',
        'company': 'Acme',
        'location': 'Remote',
        'jd_raw': '<html>desc</html>',
        'jd_text': 'desc',
        'source': 'linkedin',
        'source_url': 'https://linkedin.com/jobs/1',
        'application_url': None,
        'posted_at': None,
    }]
    ids = await bulk_insert_jobs(conn, jobs)
    assert len(ids) == 1
    assert isinstance(ids[0], str) and len(ids[0]) == 36


async def test_insert_pipeline_log(conn, job_id):
    await insert_pipeline_log(conn, job_id, 'info', 'start', 'Pipeline started', {'x': 1})
    async with conn.execute("SELECT level, step, message, data FROM pipeline_logs") as cur:
        row = await cur.fetchone()
    assert row[0] == 'info'
    assert row[1] == 'start'
    assert row[2] == 'Pipeline started'
    assert json.loads(row[3]) == {'x': 1}


async def test_get_candidate_preferences(conn):
    prefs = await get_candidate_preferences(conn, CANDIDATE_ID)
    assert prefs == {'enabled_sources': ['linkedin']}


async def test_get_candidate_preferences_missing(conn):
    prefs = await get_candidate_preferences(conn, 'nonexistent-id')
    assert prefs == {}
```

- [x] **Step 3: Run the new tests**

```bash
cd agent
poetry run pytest tests/unit/test_db_sqlite.py -v
```

Expected: all tests pass.

- [x] **Step 4: Commit**

```bash
git add agent/agent/db_sqlite.py agent/tests/unit/test_db_sqlite.py
git commit -m "feat: add SQLite DB implementation and tests"
```

---

### Task 11: Rewrite db.py as a dispatcher

**Files:**
- Modify: `agent/agent/db.py`

The daemon imports `create_pool`, `close_pool`, `claim_pipeline_job`, etc. from `agent.db`. After this step, `db.py` detects the DB driver from `DATABASE_URL` and re-exports the right implementation. The daemon (`daemon.py`) is **not changed**.

- [x] **Step 1: Replace the full content of `agent/agent/db.py` with**

```python
"""
Database driver dispatcher.

Imports from db_sqlite or db_pg based on DATABASE_URL:
  - starts with postgresql:// or postgres://  →  asyncpg (production)
  - anything else                              →  aiosqlite (local dev)
"""
from agent.config import settings


def _is_sqlite(url: str) -> bool:
    return not url.startswith(('postgresql://', 'postgres://'))


if _is_sqlite(settings.database_url):
    from agent.db_sqlite import *  # noqa: F401, F403
else:
    from agent.db_pg import *  # noqa: F401, F403
```

- [x] **Step 2: Run all Python unit tests**

```bash
cd agent
poetry run pytest tests/unit/ -v
```

Expected: all tests pass (existing tests mock `agent.db` — the dispatcher re-exports the same names).

- [x] **Step 3: Commit**

```bash
git add agent/agent/db.py
git commit -m "feat: rewrite db.py as SQLite/PG driver dispatcher"
```

---

### Task 12: Update agent .env and verify daemon with SQLite

**Files:**
- Modify: `agent/.env`

- [x] **Step 1: Edit `agent/.env`** — comment out Neon URL, add SQLite path (relative to `agent/` directory, so `../proxim-dev.db` reaches the repo root):

```
# Neon PostgreSQL (production) — uncomment to switch back
# DATABASE_URL=postgresql://neondb_owner:npg_STfzaEB8lcP2@ep-wispy-boat-amakq0i7-pooler.c-5.us-east-1.aws.neon.tech/neondb?sslmode=require

# SQLite (local dev) — path is relative to the agent/ directory
DATABASE_URL=../proxim-dev.db

LLM_PROVIDER=anthropic
LLM_MODEL=claude-sonnet-4-6
LANGCHAIN_TRACING_V2=false
LANGCHAIN_API_KEY=
LANGCHAIN_PROJECT=proxim-dev
ENVIRONMENT=development
POLLING_INTERVAL_SECONDS=3
AGENT_PORT=8001
```

- [x] **Step 2: Start Next.js (if not running)**

```bash
# In repo root
npm run dev
```

- [x] **Step 3: Trigger a pipeline job via the API**

```bash
curl -s -X POST http://localhost:3000/api/pipeline/trigger \
  -H "Content-Type: application/json" \
  -d '{"jobType":"discovery_only"}'
```

Expected: `{"jobId":"...","status":"queued",...}`

- [x] **Step 4: Start the daemon and watch it pick up the job**

```bash
cd agent
poetry run python -m agent.daemon
```

Expected log lines:
```
job_claimed   job_id=... job_type=discovery_only
graph_invoking graph=discovery job_id=...
```

- [x] **Step 5: Verify pipeline_jobs row updated in SQLite**

In a separate terminal:

```bash
npx better-sqlite3 ./proxim-dev.db "SELECT id, status, started_at FROM pipeline_jobs;"
```

Expected: status shows `running` or `completed`.

- [x] **Step 6: Run full Python test suite**

```bash
cd agent
poetry run pytest tests/unit/ -v
```

Expected: all tests pass.

- [x] **Step 7: Run full Next.js test suite and type-check**

```bash
npm run test:run && npx tsc --noEmit
```

Expected: 0 failures, no type errors.

- [x] **Step 8: Commit**

```bash
git add agent/.env
git commit -m "chore: switch Python agent to SQLite for local dev"
```

---

## Self-Review

**Spec coverage check:**
- ✅ Detection by URL format (no extra env var) — Task 5 + Task 11
- ✅ `src/db/schema.sqlite.ts` — Task 2
- ✅ `src/db/index.sqlite.ts` — Task 3
- ✅ `next.config.ts` webpack alias — Task 5
- ✅ `drizzle.sqlite.config.ts` + npm scripts — Task 4
- ✅ Dialect-agnostic trigger route — Task 6
- ✅ `.env.local` updated — Task 7
- ✅ `agent/agent/db_pg.py` — Task 9
- ✅ `agent/agent/db_sqlite.py` — Task 10
- ✅ `agent/agent/db.py` dispatcher — Task 11
- ✅ `aiosqlite` dependency — Task 8
- ✅ `agent/.env` updated — Task 12
- ✅ `proxim-dev.db` gitignored — Task 1
- ✅ `asyncio.Lock` replaces `FOR UPDATE SKIP LOCKED` — Task 10
- ✅ End-to-end daemon verification — Task 12
