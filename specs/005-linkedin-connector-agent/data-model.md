# Data Model: LinkedIn Connector Agent (F5)

**Branch**: `005-linkedin-connector-agent` | **Date**: 2026-05-06

---

## 1. New Table: `outreach_targets`

Stores one row per approved job: the identified hiring manager, enrichment data, generated connection notes, and outreach lifecycle state.

### Drizzle Schema (`src/db/schema.ts`)

```typescript
export const outreachStatusEnum = pgEnum('outreach_status', [
  'pending',          // linkedin_connector job queued, not started yet
  'discovering',      // Proxycurl employee search in progress
  'enriching',        // Proxycurl profile enrichment in progress
  'generating',       // LiteLLM note generation in progress
  'notes_ready',      // Two variants ready, awaiting candidate selection
  'sent',             // Connection request sent successfully
  'queued',           // Daily limit (20/day) reached; will send next day
  'accepted',         // LinkedIn connection accepted
  'expired',          // No acceptance after 30 days
  'paused',           // LinkedIn rate-limit warning received; all sends paused
  'no_contact_found', // No hiring manager or HR contact found at company
  'skipped_dnc',      // Company is on candidate's do-not-contact list
  'failed',           // Unrecoverable error (enrichment failure, etc.)
])

export const outreachTargets = pgTable('outreach_targets', {
  id:                   uuid().defaultRandom().primaryKey(),
  jobId:                uuid().references(() => jobs.id).notNull(),
  candidateId:          uuid().references(() => candidates.id).notNull(),
  // Contact details
  name:                 text(),
  linkedinUrl:          text(),
  title:                text(),             // Contact's job title
  company:              text().notNull(),
  seniority:            text(),             // 'CAIO'|'CTO'|'VP_AI'|'Head_AI'|'Eng_Dir'|'HR'
  // Enrichment
  enrichmentJson:       jsonb().$type<ProxycurlPersonEnrichment>(),
  // Generated notes
  noteA:                text(),
  noteB:                text(),
  selectedNote:         text(),             // 'A' | 'B' | null
  editedNote:           text(),             // candidate-edited text, if modified
  // Outreach lifecycle
  status:               outreachStatusEnum().default('pending').notNull(),
  sentAt:               timestamp({ withTimezone: true }),
  acceptedAt:           timestamp({ withTimezone: true }),
  lastPolledAt:         timestamp({ withTimezone: true }),
  linkedinInvitationId: text(),             // from LinkedIn API response
  errorMessage:         text(),
  createdAt:            timestamp({ withTimezone: true }).defaultNow().notNull(),
  updatedAt:            timestamp({ withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('outreach_targets_job_id_unique').on(table.jobId),
  index('outreach_targets_candidate_status_idx').on(table.candidateId, table.status),
  index('outreach_targets_sent_at_idx').on(table.sentAt),
])

export type OutreachTarget = typeof outreachTargets.$inferSelect

export type ProxycurlPersonEnrichment = {
  full_name: string | null
  headline: string | null
  summary: string | null
  experiences: Array<{
    title: string
    company: string
    starts_at: { day: number; month: number; year: number } | null
    ends_at: { day: number; month: number; year: number } | null
  }>
  education: Array<{
    degree_name: string | null
    school: { name: string } | null
    ends_at: { year: number } | null
  }>
}
```

### SQLite Schema (`src/db/schema.sqlite.ts`)

```typescript
export const outreachTargets = sqliteTable('outreach_targets', {
  id:                   text().primaryKey().$defaultFn(newId),
  jobId:                text().notNull().references(() => jobs.id),
  candidateId:          text().notNull().references(() => candidates.id),
  name:                 text(),
  linkedinUrl:          text(),
  title:                text(),
  company:              text().notNull(),
  seniority:            text(),
  enrichmentJson:       text(),             // JSON string
  noteA:                text(),
  noteB:                text(),
  selectedNote:         text(),
  editedNote:           text(),
  status:               text().default('pending').notNull(),
  sentAt:               text(),             // ISO string
  acceptedAt:           text(),             // ISO string
  lastPolledAt:         text(),             // ISO string
  linkedinInvitationId: text(),
  errorMessage:         text(),
  createdAt:            text().$defaultFn(now).notNull(),
  updatedAt:            text().$defaultFn(now).notNull(),
}, (table) => [
  uniqueIndex('outreach_targets_job_id_unique').on(table.jobId),
  index('outreach_targets_candidate_status_idx').on(table.candidateId, table.status),
])
```

---

## 2. Modifications to Existing Tables

### `candidates.preferences` JSONB Extension

```typescript
interface Preferences {
  // ... existing keys ...
  linkedin_access_token?: string       // OAuth access token (stored here for MVP; move to secrets table in v2)
  linkedin_paused?: boolean            // true when rate-limit warning received
  do_not_contact_companies?: string[]  // case-insensitive DNC list, managed by candidate
}
```

### `jobs` table — no status changes required

The `jobs.status` flow for LinkedIn-connected jobs:
```
approved  →  (linkedin_connector runs in background)
```
The `outreach_targets` table tracks LinkedIn lifecycle independently. Job status is not mutated by the LinkedIn connector — it remains `approved`.

### `pipeline_jobs.job_type` — new value

```
job_type: 'linkedin_connector'
```

This value is enqueued automatically when a job is approved (alongside `resume_builder`).

---

## 3. State Transitions

### `outreach_targets.status` Machine

```
pending
  │
  ▼ (Python daemon picks up linkedin_connector pipeline_job)
discovering
  │
  ├──► skipped_dnc   (company on DNC list — terminal)
  │
  ▼
enriching
  │
  ├──► no_contact_found  (no hiring manager or HR found — terminal)
  │
  ▼
generating
  │
  ├──► failed  (3 retry attempts all failed validation — terminal)
  │
  ▼
notes_ready  ◄──────────────────────────────────────────────────┐
  │                                                              │ (snooze expired — resurface)
  │ (candidate selects note, clicks Send)
  ├──► queued   (daily limit reached)
  │      │
  │      ▼ (next UTC day, daemon processes queued)
  │    sent ──────────────────────────────────────────────────────►
  │                                                              │
  └──► sent (direct, under daily limit)                         │
         │                                                       │
         ▼ (polling every 24h)                                  │
       accepted  (terminal)                                      │
       expired   (terminal, 30 days no response)                │
       paused    (LinkedIn rate-limit warning — awaits manual resume)
```

### Approval → LinkedIn Connector Trigger

```
POST /api/jobs/[jobId]/approve
  ├─► UPDATE jobs SET status = 'approved'
  ├─► UPSERT hitl_checkpoints (status = 'approved')
  ├─► INSERT pipeline_jobs (job_type = 'resume_builder')
  └─► INSERT pipeline_jobs (job_type = 'linkedin_connector')
       └─► Python daemon picks up → INSERT outreach_targets (status = 'pending')
```

---

## 4. Python Agent State Schema (LangGraph)

```python
class LinkedInConnectorState(TypedDict):
    # Input
    job_id: str
    candidate_id: str
    company: str
    job_title: str           # the job being applied to
    archetype: str           # e.g. 'Agentic Systems Architect'
    archetype_confidence: float
    # Discovery
    contact: dict | None     # Proxycurl employee result
    enrichment: dict | None  # Proxycurl person enrichment
    # Generation
    note_a: str | None
    note_b: str | None
    generation_attempts: int
    # Output
    outreach_target_id: str | None
    status: str
    error: str | None
```

---

## 5. API Response Types (TypeScript)

```typescript
// Included in GET /api/candidates/[id]/jobs response for approved jobs
export type OutreachTargetSummary = {
  id: string
  status: OutreachStatus
  name: string | null
  linkedinUrl: string | null
  title: string | null
  seniority: string | null
  noteA: string | null
  noteB: string | null
  selectedNote: 'A' | 'B' | null
  editedNote: string | null
  sentAt: string | null
  acceptedAt: string | null
  errorMessage: string | null
}

export type OutreachStatus =
  | 'pending' | 'discovering' | 'enriching' | 'generating'
  | 'notes_ready' | 'sent' | 'queued' | 'accepted' | 'expired'
  | 'paused' | 'no_contact_found' | 'skipped_dnc' | 'failed'
```

---

## 6. Entity Relationships

```
candidates (1)
  └─► jobs (N)
        ├─► hitl_checkpoints (1)     — F4 HITL gate (approve/reject/snooze)
        └─► outreach_targets (1)     — F5 LinkedIn outreach (one per approved job)
              └── status: pending → ... → sent | accepted | no_contact_found | ...
              └── noteA, noteB       — two A/B variants
              └── selectedNote       — candidate's selection ('A' | 'B')
              └── editedNote         — if candidate edited the selected note

candidates (1)
  └── preferences.do_not_contact_companies: string[]
  └── preferences.linkedin_paused: boolean
  └── preferences.linkedin_access_token: string (OAuth token)
```

---

## 7. Daily Rate Limit Query

No separate table. The limit check runs before each send:

```sql
-- Count today's sends for this candidate (UTC date)
SELECT COUNT(*) FROM outreach_targets
WHERE candidate_id = $1
  AND status = 'sent'
  AND sent_at::date = CURRENT_DATE
```

SQLite equivalent:
```sql
SELECT COUNT(*) FROM outreach_targets
WHERE candidate_id = ?
  AND status = 'sent'
  AND date(sent_at) = date('now')
```

If `count >= 20` → set `status = 'queued'`, return `{ status: 'queued' }` to UI.
