import {
  pgTable,
  uuid,
  text,
  varchar,
  jsonb,
  pgEnum,
  timestamp,
  integer,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

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

export const parseStatusEnum = pgEnum('parse_status', [
  'pending',
  'parsing',
  'ready',
  'failed',
])

export const candidates = pgTable('candidates', {
  id: uuid().defaultRandom().primaryKey(),
  candidateId: uuid(), // nullable FK — reserved for future auth integration
  baseCvMd: text(),
  baseCvHash: varchar({ length: 64 }),
  parsedProfile: jsonb().$type<ParsedProfile>(),
  parseStatus: parseStatusEnum().default('pending').notNull(),
  preferences: jsonb().$type<Preferences>().default({}).notNull(),
  createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp({ withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdateFn(() => new Date()), // application-layer only — no DB-level trigger
})

export type Candidate = typeof candidates.$inferSelect
export type NewCandidate = typeof candidates.$inferInsert

export const pipelineJobStatusEnum = pgEnum('pipeline_job_status', [
  'queued', 'running', 'completed', 'failed',
])

export const jobStatusEnum = pgEnum('job_status', [
  'discovered', 'scored', 'awaiting', 'approved',
  'rejected', 'snoozed', 'score_failed', 'resume_failed',
])

export const pipelineJobs = pgTable('pipeline_jobs', {
  id: uuid().defaultRandom().primaryKey(),
  status: pipelineJobStatusEnum().default('queued').notNull(),
  jobType: text().notNull(),
  candidateId: uuid().references(() => candidates.id).notNull(),
  payload: jsonb().$type<Record<string, unknown>>().default({}).notNull(),
  createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  startedAt: timestamp({ withTimezone: true }),
  completedAt: timestamp({ withTimezone: true }),
  error: text(),
})

export const pipelineRuns = pgTable('pipeline_runs', {
  id: uuid().defaultRandom().primaryKey(),
  pipelineJobId: uuid().references(() => pipelineJobs.id).notNull(),
  candidateId: uuid().references(() => candidates.id).notNull(),
  status: text().default('running').notNull(),
  sourcesAttempted: integer().default(0).notNull(),
  sourcesSuccessful: integer().default(0).notNull(),
  jobsDiscovered: integer().default(0).notNull(),
  jobsDeduplicated: integer().default(0).notNull(),
  startedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp({ withTimezone: true }),
  summary: jsonb().$type<Record<string, unknown>>(),
  error: text(),
})

export const jobs = pgTable('jobs', {
  id: uuid().defaultRandom().primaryKey(),
  candidateId: uuid().references(() => candidates.id).notNull(),
  pipelineRunId: uuid().references(() => pipelineRuns.id).notNull(),
  title: text().notNull(),
  company: text().notNull(),
  location: text(),
  jdRaw: text().notNull(),
  jdText: text(),
  source: text().notNull(),
  sourceUrl: text().notNull(),
  applicationUrl: text(),
  postedAt: timestamp({ withTimezone: true }),
  status: jobStatusEnum().default('discovered').notNull(),
  createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp({ withTimezone: true }).defaultNow().notNull().$onUpdateFn(() => new Date()),
}, (table) => [
  index('jobs_candidate_status_idx').on(table.candidateId, table.status),
  index('jobs_candidate_source_url_idx').on(table.candidateId, table.sourceUrl),
])

export const scanHistory = pgTable('scan_history', {
  id: uuid().defaultRandom().primaryKey(),
  candidateId: uuid().references(() => candidates.id).notNull(),
  url: text().notNull(),
  jobId: uuid().references(() => jobs.id),
  firstSeenAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  lastSeenAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('scan_history_candidate_url_idx').on(table.candidateId, table.url),
])

export const pipelineLogs = pgTable('pipeline_logs', {
  id: uuid().defaultRandom().primaryKey(),
  pipelineJobId: uuid().references(() => pipelineJobs.id).notNull(),
  level: text().notNull(),
  step: text().notNull(),
  message: text().notNull(),
  data: jsonb().$type<Record<string, unknown>>(),
  createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('pipeline_logs_job_created_idx').on(table.pipelineJobId, table.createdAt),
])

export type PipelineLog = typeof pipelineLogs.$inferSelect
