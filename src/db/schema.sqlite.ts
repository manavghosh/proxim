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
