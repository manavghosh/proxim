# Data Model: HITL Review Dashboard (F4)

**Branch**: `004-hitl-review-dashboard` | **Date**: 2026-05-04

---

## 1. New Table: `hitl_checkpoints`

### Drizzle Schema (`src/db/schema.ts`)

```typescript
export const hitlCheckpointStatusEnum = pgEnum('hitl_checkpoint_status', [
  'awaiting', 'approved', 'rejected', 'snoozed',
])

export const hitlCheckpoints = pgTable('hitl_checkpoints', {
  id:          uuid().defaultRandom().primaryKey(),
  jobId:       uuid().references(() => jobs.id).notNull(),
  candidateId: uuid().references(() => candidates.id).notNull(),
  status:      hitlCheckpointStatusEnum().default('awaiting').notNull(),
  decisionType: text(),               // 'approve' | 'reject' | 'snooze'
  snoozedUntil: timestamp({ withTimezone: true }),  // null unless snoozed
  decidedAt:   timestamp({ withTimezone: true }),
  createdAt:   timestamp({ withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('hitl_checkpoints_candidate_status_idx').on(table.candidateId, table.status),
  index('hitl_checkpoints_job_id_idx').on(table.jobId),
  uniqueIndex('hitl_checkpoints_job_id_unique').on(table.jobId), // one checkpoint per job
])

export type HitlCheckpoint = typeof hitlCheckpoints.$inferSelect
```

### SQLite Schema (`src/db/schema.sqlite.ts`)

```typescript
export const hitlCheckpoints = sqliteTable('hitl_checkpoints', {
  id:           text().primaryKey().$defaultFn(newId),
  jobId:        text().notNull().references(() => jobs.id),
  candidateId:  text().notNull().references(() => candidates.id),
  status:       text().default('awaiting').notNull(),
  decisionType: text(),
  snoozedUntil: text(),   // ISO string
  decidedAt:    text(),
  createdAt:    text().$defaultFn(now).notNull(),
}, (table) => [
  index('hitl_checkpoints_candidate_status_idx').on(table.candidateId, table.status),
  uniqueIndex('hitl_checkpoints_job_id_unique').on(table.jobId),
])
```

---

## 2. Modifications to Existing Tables

### `jobs` table — status enum extension

The `jobStatusEnum` already includes `awaiting`. No new values needed for this feature.

The flow is already defined:
```
discovered → scored → awaiting → approved | rejected | snoozed
```

**Snooze**: When a job is snoozed, `jobs.status = 'snoozed'`. Resurface resets it to `awaiting`.

The `snoozed_until` timestamp lives in `hitl_checkpoints.snoozed_until` (not on `jobs` directly) to keep the job table clean and the decision record auditable.

---

## 3. State Transitions

### Job Status Machine

```
discovered
    │
    ▼ (F9 scoring)
scored
    │
    ▼ (Python daemon writes hitl_checkpoints row with status='awaiting')
awaiting  ◄────────────────────────────────────────────┐
    │                                                    │
    ├──► [Approve] → approved (resume builder triggered) │
    │                                                    │
    ├──► [Reject]  → rejected (permanent, never resurfaces)
    │
    └──► [Snooze]  → snoozed (7-day timer)
                         │
                         ▼ (Python daemon poll at T+7d)
                     awaiting ────────────────────────────┘
```

### `hitl_checkpoints.status` Machine

```
awaiting
    ├── → approved  (decidedAt set)
    ├── → rejected  (decidedAt set)
    └── → snoozed   (snoozedUntil set; decidedAt NOT set yet)
                        └── → awaiting  (Python resurface; snoozedUntil cleared)
```

---

## 4. SSE Event Schema

All SSE events follow: `event: <type>\ndata: <json>\n\n`

### `jobs_arrived`
Sent when new scored/awaiting jobs appear for the candidate.
```json
{
  "event": "jobs_arrived",
  "data": {
    "count": 3,
    "jobIds": ["uuid1", "uuid2", "uuid3"]
  }
}
```

### `snooze_expired`
Sent when a snoozed job resurfaces (Python daemon resets to awaiting, SSE picks it up on next poll).
```json
{
  "event": "jobs_arrived",
  "data": {
    "count": 1,
    "jobIds": ["uuid-of-resurfaced-job"]
  }
}
```

### `idle`
Sent after 60 seconds of no new jobs. Client closes EventSource and reconnects after 3s.
```json
{ "event": "idle", "data": {} }
```

---

## 5. Score Report Rendering (client-side derivation)

The `score10d` JSONB stored on `jobs` has this shape (from F9):

```typescript
type Score10D = {
  gate: {
    roleLevelMatch:   { score: number; reasoning: string }
    aiStackAlignment: { score: number; reasoning: string }
  }
  weighted: {
    compensation:         { score: number; reasoning: string }
    companyStage:         { score: number; reasoning: string }
    interviewProbability: { score: number; reasoning: string }
    thoughtLeadership:    { score: number; reasoning: string }
    geography:            { score: number; reasoning: string }
    growthTrajectory:     { score: number; reasoning: string }
    domainResonance:      { score: number; reasoning: string }
    hiringUrgency:        { score: number; reasoning: string }
  }
}
```

**Strength chips**: Top 3 dimensions by score across all 10 — display dimension name + score.
**Risk chips**: Bottom 2 weighted dimensions by score — display dimension name + score in amber/red.

Derived client-side, zero additional API calls.

---

## 6. Entity Relationships

```
candidates (1)
  └─► jobs (N)
        └─► hitl_checkpoints (1)   — exactly one checkpoint per job at HITL gate
              └── status: awaiting | approved | rejected | snoozed
              └── snoozedUntil: timestamp | null
              └── decidedAt: timestamp | null

jobs (N)
  └── status: scored → awaiting → approved | rejected | snoozed
```

---

## 7. Preferences Extension

`candidates.preferences` JSONB gains one new key:

```typescript
interface Preferences {
  // ... existing keys ...
  hitl_grade_filter?: 'A' | 'A+B' | 'all'  // default: 'A+B'
  hitl_sort?:         'score' | 'date' | 'company'  // default: 'score'
}
```

Persisted via existing `PUT /api/preferences` endpoint.
