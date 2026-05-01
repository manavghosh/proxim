# SQLite Local Dev Database — Design Spec

**Date:** 2026-05-01
**Status:** Approved

---

## Goal

Replace the Neon PostgreSQL dependency for local development with a local SQLite file shared by both the Next.js API layer and the Python agent daemon. Production continues to use Neon unchanged.

---

## Detection Strategy

Single env var controls everything. Both services read `DATABASE_URL`:

- Starts with `postgresql://` or `postgres://` → use Neon / asyncpg (production)
- Anything else → treat as SQLite file path (local dev)

No extra `DB_DRIVER` flag. Switching modes = swapping the `DATABASE_URL` value.

---

## Architecture

```
.env.local (Next.js, SQLite)            agent/.env (Python, SQLite)
DATABASE_URL=./proxim-dev.db            DATABASE_URL=../proxim-dev.db
        ↓                                           ↓
next.config.ts                          agent/agent/db.py
(detects non-pg URL at build time)      (detects non-pg URL at import time)
swaps @/db webpack aliases              dispatches to db_sqlite.py
        ↓                                           ↓
src/db/index.sqlite.ts                  agent/agent/db_sqlite.py
better-sqlite3 + Drizzle               aiosqlite, ? placeholders
sqlite-core schema                      asyncio.Lock for job claiming
        ↓                                           ↓
        └──────────── ./proxim-dev.db ──────────────┘
                    (single shared file, repo root)
```

Production: both files point to `postgresql://...` — zero code-path changes.

---

## Next.js Changes

### New: `src/db/schema.sqlite.ts`

Mirrors `schema.ts` using `drizzle-orm/sqlite-core`. Type mapping:

| PG type | SQLite type | Notes |
|---|---|---|
| `uuid().defaultRandom()` | `text().$defaultFn(() => crypto.randomUUID())` | App-generated UUIDs |
| `jsonb().$type<T>()` | `text({ mode: 'json' }).$type<T>()` | Drizzle serialises/deserialises automatically |
| `timestamp({ withTimezone: true })` | `text()` | ISO 8601; lexicographic sort is date-correct |
| `pgEnum(name, vals)` | `text()` | No DB constraint; app enforces valid values |
| `integer()` | `integer()` | Identical |

All table names and column names (snake_case) are identical to the PG schema.

### New: `src/db/index.sqlite.ts`

```typescript
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema.sqlite'

const client = new Database(process.env.DATABASE_URL ?? './proxim-dev.db')
export const db = drizzle(client, { schema, casing: 'snake_case' })
```

### Modified: `next.config.ts`

At build time, if `DATABASE_URL` does not start with `postgresql`/`postgres`, inject webpack aliases:

```
@/db        → src/db/index.sqlite.ts
@/db/schema → src/db/schema.sqlite.ts
```

Service files (`cv-service.ts`, route handlers, etc.) import `db` and schema tables unchanged — webpack routes them to the right implementation transparently.

### New: `drizzle.sqlite.config.ts`

```typescript
defineConfig({
  schema: './src/db/schema.sqlite.ts',
  out: './migrations/sqlite',
  dialect: 'sqlite',
  casing: 'snake_case',
  dbCredentials: { url: process.env.DATABASE_URL ?? './proxim-dev.db' },
})
```

### Modified: `package.json`

Add scripts:
```json
"db:generate:sqlite": "drizzle-kit generate --config=drizzle.sqlite.config.ts",
"db:migrate:sqlite":  "drizzle-kit migrate  --config=drizzle.sqlite.config.ts",
"db:studio:sqlite":   "drizzle-kit studio   --config=drizzle.sqlite.config.ts"
```

### Modified: `src/app/api/pipeline/trigger/route.ts`

Replace the raw-SQL auto-expire (uses PG-only `INTERVAL`) with Drizzle query builder:

```typescript
const expiry = new Date(Date.now() - 30 * 60 * 1000)
await db.update(pipelineJobs)
  .set({ status: 'failed', error: 'Expired — daemon did not complete this job' })
  .where(
    and(
      or(eq(pipelineJobs.status, 'queued'), eq(pipelineJobs.status, 'running')),
      or(isNull(pipelineJobs.startedAt), lt(pipelineJobs.startedAt, expiry))
    )
  )
```

### Modified: `.env.local`

```
# Neon PostgreSQL (production) — commented out for local dev
# DATABASE_URL=postgresql://...

# SQLite (local dev)
DATABASE_URL=./proxim-dev.db
```

### New dependency

```
better-sqlite3
@types/better-sqlite3
```

---

## Python Agent Changes

### New: `agent/agent/db_pg.py`

Current `db.py` content moved here verbatim — no changes.

### New: `agent/agent/db_sqlite.py`

SQLite-adapted implementations of every function in `db_pg.py`:

- `create_pool(url)` → `create_connection(path)` returning an `aiosqlite.Connection`
- All `$1, $2, ...` placeholders → `?, ?, ...`
- `FOR UPDATE SKIP LOCKED` removed; an `asyncio.Lock` at module level prevents concurrent claims (safe for single-process local dev)
- `gen_random_uuid()` → `str(uuid.uuid4())` (Python-generated)
- `NOW()` → `datetime.now(timezone.utc).isoformat()` (Python-generated)
- `::jsonb` casts → removed (SQLite stores TEXT natively)
- `ON CONFLICT ... DO UPDATE` → SQLite 3.24+ supports this syntax unchanged
- `RETURNING id` → SQLite 3.35+ supports this syntax unchanged

### Modified: `agent/agent/db.py`

Becomes a 5-line dispatcher:

```python
from agent.config import settings

def _is_sqlite(url: str) -> bool:
    return not url.startswith(('postgresql://', 'postgres://'))

if _is_sqlite(settings.database_url):
    from agent.db_sqlite import *
else:
    from agent.db_pg import *
```

### Modified: `agent/pyproject.toml`

Add dependency: `aiosqlite = "^0.20"`

### Modified: `agent/.env`

```
# Neon PostgreSQL (production) — commented out for local dev
# DATABASE_URL=postgresql://...

# SQLite (local dev) — path relative to agent/ directory
DATABASE_URL=../proxim-dev.db
```

---

## Migration Workflow

### First-time SQLite setup

```bash
# From repo root
npm run db:migrate:sqlite   # creates proxim-dev.db and applies all migrations

# Start Next.js
npm run dev

# Start daemon (separate terminal)
cd agent
poetry install
poetry add aiosqlite
poetry run python -m agent.daemon
```

### Switching back to Neon

Restore `.env.local` and `agent/.env` to the PostgreSQL URL — no code changes needed.

---

## Constraints & Non-Goals

- SQLite has no concurrent write support — single daemon process only (acceptable for dev)
- No SQLite-specific triggers or views — all logic stays in the application layer
- The `proxim-dev.db` file is gitignored (add `proxim-dev.db` to `.gitignore`)
- Python tests that mock `db.py` continue to work — the dispatcher re-exports the same function names

---

## Files Changed / Created

| File | Action |
|---|---|
| `src/db/schema.sqlite.ts` | Create |
| `src/db/index.sqlite.ts` | Create |
| `drizzle.sqlite.config.ts` | Create |
| `next.config.ts` | Modify (add webpack alias logic) |
| `src/app/api/pipeline/trigger/route.ts` | Modify (dialect-agnostic auto-expire) |
| `package.json` | Modify (add sqlite scripts + deps) |
| `.env.local` | Modify (comment Neon, add SQLite URL) |
| `agent/agent/db_pg.py` | Create (rename from db.py) |
| `agent/agent/db_sqlite.py` | Create |
| `agent/agent/db.py` | Modify (becomes dispatcher) |
| `agent/pyproject.toml` | Modify (add aiosqlite) |
| `agent/.env` | Modify (comment Neon, add SQLite URL) |
| `migrations/sqlite/` | Created by drizzle-kit |
| `proxim-dev.db` | Created at runtime (gitignored) |
