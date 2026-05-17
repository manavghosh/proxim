# Data Model: Outreach Mailer Agent (F6)

**Branch**: `006-outreach-mailer-agent` | **Date**: 2026-05-14

---

## 1. New Table: `email_cadences`

One row per approved job. Tracks overall cadence lifecycle and shared state (thread ID, reply/bounce detection, hiring manager email).

### Drizzle Schema (`src/db/schema.ts`)

```typescript
export const emailCadenceStatusEnum = pgEnum('email_cadence_status', [
  'pending_discovery',   // outreach_mailer pipeline job queued, not started
  'discovering',         // Hunter.io email discovery in progress
  'low_confidence',      // best email found but confidence < 70% — awaiting candidate override
  'email_not_found',     // Hunter.io returned no address — terminal
  'generating',          // LiteLLM draft generation in progress
  'pending_approval',    // all 3 drafts ready, awaiting HITL candidate approval
  'approved',            // candidate approved; Day 1 scheduled
  'active',              // Day 1 sent; cadence in progress
  'paused',              // reply detected; cadence paused
  'auth_expired',        // Gmail OAuth2 token expired mid-cadence
  'attachment_missing',  // resume/cover-letter PDF not yet available for Day 1
  'replied',             // reply received; cadence complete (success path)
  'cadence_complete',    // all 3 emails sent, no reply received — terminal
  'bounced',             // Day 1 bounced — Day 3 + Day 7 cancelled — terminal
  'cancelled',           // candidate manually cancelled cadence — terminal
  'failed',              // unrecoverable generation/send error — terminal
])

export const emailCadences = pgTable('email_cadences', {
  id:                   uuid().defaultRandom().primaryKey(),
  jobId:                uuid().references(() => jobs.id).notNull(),
  candidateId:          uuid().references(() => candidates.id).notNull(),
  // Hiring manager email (from Hunter.io)
  hiringManagerEmail:   text(),
  emailConfidence:      integer(),               // Hunter.io score 0–100
  emailSource:          text(),                  // 'finder' | 'domain_search' | 'manual_override'
  // Gmail threading
  gmailThreadId:        text(),                  // set when Day 1 is sent
  day1MessageId:        text(),                  // MIME Message-ID of Day 1 email
  // Cadence lifecycle
  status:               emailCadenceStatusEnum().default('pending_discovery').notNull(),
  approvedAt:           timestamp({ withTimezone: true }),   // when candidate clicked Approve
  replyDetectedAt:      timestamp({ withTimezone: true }),
  bounceDetectedAt:     timestamp({ withTimezone: true }),
  errorMessage:         text(),
  createdAt:            timestamp({ withTimezone: true }).defaultNow().notNull(),
  updatedAt:            timestamp({ withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('email_cadences_job_id_unique').on(table.jobId),
  index('email_cadences_candidate_status_idx').on(table.candidateId, table.status),
])

export type EmailCadence = typeof emailCadences.$inferSelect
```

### SQLite Schema (`src/db/schema.sqlite.ts`)

```typescript
export const emailCadences = sqliteTable('email_cadences', {
  id:                   text().primaryKey().$defaultFn(newId),
  jobId:                text().notNull().references(() => jobs.id),
  candidateId:          text().notNull().references(() => candidates.id),
  hiringManagerEmail:   text(),
  emailConfidence:      integer(),
  emailSource:          text(),
  gmailThreadId:        text(),
  day1MessageId:        text(),
  status:               text().default('pending_discovery').notNull(),
  approvedAt:           text(),
  replyDetectedAt:      text(),
  bounceDetectedAt:     text(),
  errorMessage:         text(),
  createdAt:            text().$defaultFn(now).notNull(),
  updatedAt:            text().$defaultFn(now).notNull(),
}, (table) => [
  uniqueIndex('email_cadences_job_id_unique').on(table.jobId),
  index('email_cadences_candidate_status_idx').on(table.candidateId, table.status),
])
```

---

## 2. New Table: `email_drafts`

Three rows per cadence (one per email day). Stores content, approval state, scheduling timestamps, send metadata, and tracking data.

### Drizzle Schema (`src/db/schema.ts`)

```typescript
export const emailDraftStatusEnum = pgEnum('email_draft_status', [
  'draft',           // generated, not yet approved
  'approved',        // candidate approved this draft; ready to send
  'superseded',      // original draft — replaced by candidate's edit (kept for audit)
  'scheduled',       // approved + scheduled_send_at is set; waiting to fire
  'sending',         // in-flight (daemon picked it up)
  'sent',            // successfully sent via Gmail
  'bounced',         // delivery failure for Day 1
  'rate_limited',    // daily 20-email cap reached; scheduled_send_at bumped +1 day
  'cancelled',       // cadence cancelled (bounce/reply/manual) before this draft sent
])

export const emailDrafts = pgTable('email_drafts', {
  id:                 uuid().defaultRandom().primaryKey(),
  cadenceId:          uuid().references(() => emailCadences.id).notNull(),
  candidateId:        uuid().references(() => candidates.id).notNull(),
  dayNumber:          integer().notNull(),             // 1 | 3 | 7
  // Content
  subject:            text().notNull(),
  bodyHtml:           text().notNull(),               // current (possibly edited) body
  bodyText:           text().notNull(),               // plain-text version for multipart/alternative
  originalBodyHtml:   text().notNull(),               // immutable generated version (audit)
  // Approval & scheduling
  isApproved:         boolean().default(false).notNull(),
  scheduledSendAt:    timestamp({ withTimezone: true }),
  // Send metadata
  status:             emailDraftStatusEnum().default('draft').notNull(),
  sentAt:             timestamp({ withTimezone: true }),
  gmailMessageId:     text(),                         // after send; used for threading Day 3/7
  // Tracking
  openDetectedAt:     timestamp({ withTimezone: true }),
  clickDetectedAt:    timestamp({ withTimezone: true }),
  bounceDetectedAt:   timestamp({ withTimezone: true }),
  createdAt:          timestamp({ withTimezone: true }).defaultNow().notNull(),
  updatedAt:          timestamp({ withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('email_drafts_cadence_day_idx').on(table.cadenceId, table.dayNumber),
  index('email_drafts_candidate_status_idx').on(table.candidateId, table.status),
  index('email_drafts_scheduled_idx').on(table.scheduledSendAt),
])

export type EmailDraft = typeof emailDrafts.$inferSelect
```

### SQLite Schema (`src/db/schema.sqlite.ts`)

```typescript
export const emailDrafts = sqliteTable('email_drafts', {
  id:                 text().primaryKey().$defaultFn(newId),
  cadenceId:          text().notNull().references(() => emailCadences.id),
  candidateId:        text().notNull().references(() => candidates.id),
  dayNumber:          integer().notNull(),
  subject:            text().notNull(),
  bodyHtml:           text().notNull(),
  bodyText:           text().notNull(),
  originalBodyHtml:   text().notNull(),
  isApproved:         integer({ mode: 'boolean' }).default(false).notNull(),
  scheduledSendAt:    text(),
  status:             text().default('draft').notNull(),
  sentAt:             text(),
  gmailMessageId:     text(),
  openDetectedAt:     text(),
  clickDetectedAt:    text(),
  bounceDetectedAt:   text(),
  createdAt:          text().$defaultFn(now).notNull(),
  updatedAt:          text().$defaultFn(now).notNull(),
}, (table) => [
  index('email_drafts_cadence_day_idx').on(table.cadenceId, table.dayNumber),
  index('email_drafts_candidate_status_idx').on(table.candidateId, table.status),
])
```

---

## 3. Modifications to Existing Tables

### `outreach_targets` Extension (F5 table, F6 adds email fields)

```typescript
// Add to outreachTargets table in src/db/schema.ts:
email:              text(),                   // Hunter.io discovered email
emailConfidence:    integer(),               // Hunter.io confidence score 0–100
emailSource:        text(),                  // 'finder' | 'domain_search' | null
```

These fields are populated by the `outreach_mailer` pipeline job after Hunter.io discovery. The `email_cadences` table stores the authoritative email used for sending; `outreach_targets.email` is the raw discovery result (may differ if candidate overrides).

### `candidates.preferences` JSONB Extension

```typescript
interface Preferences {
  // ... existing keys (geographic_preference, work_preference, etc.) ...
  // LinkedIn (F5)
  linkedin_access_token?: string
  linkedin_paused?: boolean
  do_not_contact_companies?: string[]
  // Gmail (F6)
  gmail_access_token?: string          // OAuth2 access token; rotate via refresh
  gmail_refresh_token?: string         // long-lived refresh token
  gmail_email?: string                 // candidate's Gmail address (e.g. "alice@gmail.com")
  gmail_token_expiry?: string          // ISO string; checked before each send
}
```

### `pipeline_jobs.job_type` — new value

```
job_type: 'outreach_mailer'
```

Inserted at job approval (alongside `resume_builder` and `linkedin_connector`).

---

## 4. State Transitions

### `email_cadences.status` Machine

```
pending_discovery
  │
  ▼ (Python daemon picks up outreach_mailer pipeline_job)
discovering
  │
  ├──► email_not_found     (no verified address found — terminal)
  ├──► low_confidence      (best address < 70% — awaits candidate override)
  │      │
  │      └─► generating    (candidate clicks "Send Anyway")
  │
  ▼
generating
  │
  ├──► failed              (3 generation + self-review attempts all fail — terminal)
  │
  ▼
pending_approval            (3 drafts ready; HITL gate)
  │
  │ (candidate clicks Approve & Schedule)
  ▼
approved / active
  │ (Day 1 fires)
  │
  ├──► attachment_missing  (PDF not ready; re-check every 5min up to 1h)
  │      │
  │      └─► active        (PDF becomes available; Day 1 sends)
  │
  ├──► auth_expired        (Gmail token refresh failed — awaits re-auth)
  │      │
  │      └─► active        (candidate re-authorises; cadence resumes)
  │
  ▼
active                      (Day 1 sent; Day 3/7 scheduled)
  │
  ├──► bounced             (Day 1 bounce detected — terminal)
  ├──► replied             (reply detected at any point — terminal / success)
  │
  ├──► paused              (reply detected; candidate notified)
  │      │
  │      └──► replied      (cadence finalised)
  │
  ▼ (Day 7 sent, no reply)
cadence_complete            (terminal)
```

### `email_drafts.status` Machine

```
draft ──► (candidate approves) ──► approved ──► scheduled ──► sending ──► sent
  │                                                               │
  │ (candidate edits)                                             └──► bounced (Day 1 only)
  │
  └──► superseded (original draft after edit; replaced draft becomes approved)

approved/scheduled ──► cancelled (when cadence is bounced/replied/cancelled)
```

### Approval → Outreach Mailer Trigger

```
POST /api/jobs/[jobId]/approve
  ├─► UPDATE jobs SET status = 'approved'
  ├─► UPSERT hitl_checkpoints (status = 'approved')
  ├─► INSERT pipeline_jobs (job_type = 'resume_builder')
  ├─► INSERT pipeline_jobs (job_type = 'linkedin_connector')     ← F5
  └─► INSERT pipeline_jobs (job_type = 'outreach_mailer')       ← F6 (new)
       └─► Python daemon picks up → INSERT email_cadences (status = 'pending_discovery')
```

---

## 5. Python Agent State Schema (LangGraph)

```python
class OutreachMailerState(TypedDict):
    # Input
    job_id: str
    candidate_id: str
    company: str
    job_title: str
    archetype: str
    archetype_confidence: float
    hiring_manager_name: str | None    # from outreach_targets (F5 result), if available
    # Email discovery
    cadence_id: str | None
    discovered_email: str | None
    email_confidence: int | None       # 0–100
    email_source: str | None           # 'finder' | 'domain_search'
    # Generation
    subject: str | None
    day1_body: str | None
    day3_body: str | None
    day7_body: str | None
    generation_attempts: int
    # Output
    status: str
    error: str | None
```

---

## 6. API Response Types (TypeScript)

```typescript
// Included in GET /api/candidates/[id]/jobs for approved jobs
export type EmailCadenceSummary = {
  id: string
  status: EmailCadenceStatus
  hiringManagerEmail: string | null
  emailConfidence: number | null
  approvedAt: string | null
  replyDetectedAt: string | null
  bounceDetectedAt: string | null
  drafts: EmailDraftSummary[]       // all 3 drafts (or empty until pending_approval)
}

export type EmailDraftSummary = {
  id: string
  dayNumber: 1 | 3 | 7
  subject: string
  bodyHtml: string                  // current (edited) body
  originalBodyHtml: string          // immutable generated version
  isApproved: boolean
  status: EmailDraftStatus
  scheduledSendAt: string | null
  sentAt: string | null
  openDetectedAt: string | null
  clickDetectedAt: string | null
}

export type EmailCadenceStatus =
  | 'pending_discovery' | 'discovering' | 'low_confidence' | 'email_not_found'
  | 'generating' | 'pending_approval' | 'approved' | 'active'
  | 'paused' | 'auth_expired' | 'attachment_missing'
  | 'replied' | 'cadence_complete' | 'bounced' | 'cancelled' | 'failed'

export type EmailDraftStatus =
  | 'draft' | 'approved' | 'superseded' | 'scheduled'
  | 'sending' | 'sent' | 'bounced' | 'rate_limited' | 'cancelled'
```

---

## 7. Entity Relationships

```
candidates (1)
  └─► jobs (N)
        ├─► hitl_checkpoints (1)      — F4 HITL gate
        ├─► outreach_targets (1)      — F5 LinkedIn outreach
        │     └── email, email_confidence  — F6 adds these fields
        └─► email_cadences (1)        — F6 email outreach
              ├── status: pending_discovery → ... → replied | cadence_complete
              ├── gmail_thread_id          — shared thread for all 3 emails
              └─► email_drafts (3)
                    ├── day_number: 1
                    ├── day_number: 3
                    └── day_number: 7

candidates (1)
  └── preferences.gmail_access_token: string
  └── preferences.gmail_refresh_token: string
  └── preferences.gmail_email: string
```

---

## 8. Daily Volume Cap Query

```sql
-- Count today's sent emails for this candidate (UTC date)
SELECT COUNT(*) FROM email_drafts
WHERE candidate_id = $1
  AND status = 'sent'
  AND sent_at::date = CURRENT_DATE
```

SQLite equivalent:
```sql
SELECT COUNT(*) FROM email_drafts
WHERE candidate_id = ?
  AND status = 'sent'
  AND date(sent_at) = date('now')
```

If `count >= 20`: set `email_drafts.status = 'rate_limited'`, bump `scheduled_send_at += interval '1 day'`.

---

## 9. Reply/Bounce Detection Queries

**Reply detection** (Python daemon, hourly poll):
```python
# Check Gmail inbox for messages In-Reply-To the Day 1 Message-ID
query = f'in:inbox in-reply-to:{cadence.day1_message_id}'
messages = gmail_service.users().messages().list(userId='me', q=query).execute()
if messages.get('messages'):
    # Mark cadence replied, cancel pending drafts
```

**Bounce detection** (Python daemon, hourly poll):
```python
query = f'from:mailer-daemon in:inbox {cadence.day1_message_id}'
```
