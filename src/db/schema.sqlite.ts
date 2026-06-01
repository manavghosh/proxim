import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'

// ── inline types (mirrors schema.ts) ──────────────────────────────────────
type DimensionScore = {
  score: number
  reasoning: string
}

type Score10D = {
  gate: {
    roleLevelMatch:   DimensionScore
    aiStackAlignment: DimensionScore
  }
  weighted: {
    compensation:         DimensionScore
    companyStage:         DimensionScore
    interviewProbability: DimensionScore
    thoughtLeadership:    DimensionScore
    geography:            DimensionScore
    growthTrajectory:     DimensionScore
    domainResonance:      DimensionScore
    hiringUrgency:        DimensionScore
  }
}

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
  linkedin_access_token?: string
  linkedin_refresh_token?: string | null
  linkedin_token_expires_at?: string
  linkedin_connected_at?: string
  linkedin_profile_name?: string
  linkedin_paused?: boolean
  do_not_contact_companies?: string[]
  email_outreach_mode?: 'agentic' | 'manual'
  email_resume_attachment?: 'tailored' | 'original'
  base_resume_pdf_name?: string
}

// ── helpers ────────────────────────────────────────────────────────────────
const now = () => new Date().toISOString()
const newId = () => crypto.randomUUID()

// ── tables ─────────────────────────────────────────────────────────────────
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
  avatarData:     text('avatar_data'),          // base64 data URL for uploaded avatar
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
  abGradeCount:        integer().default(0).notNull(),
  resumesGenerated:    integer().default(0).notNull(),
  emailsSent:          integer().default(0).notNull(),
  repliesReceived:     integer().default(0).notNull(),
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
  status:              text().default('discovered').notNull(),
  score10d:            text({ mode: 'json' }).$type<Score10D>(),
  grade:               text(),
  reportMd:            text(),
  errorMessage:   text(),
  archetype:           text(),
  archetypeConfidence: real(),
  createdAt:      text().$defaultFn(now).notNull(),
  updatedAt:      text().$defaultFn(now).$onUpdateFn(now).notNull(),
  interviewCallbackAt: text(),
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

// ── Resume Builder (F10) ──────────────────────────────────────────────────────

export const resumeVersions = sqliteTable('resume_versions', {
  id:                  text().primaryKey().$defaultFn(newId),
  jobId:               text().notNull().references(() => jobs.id),
  candidateId:         text().references(() => candidates.id),
  archetype:           text().notNull(),
  archetypeConfidence: real(),
  keywords:            text({ mode: 'json' }).$type<string[]>(),
  scoreAtGeneration:   real(),
  resumePdfPath:       text(),
  coverLetterPdfPath:  text(),
  baseCvHash:          text().notNull(),
  isSubmitted:         integer({ mode: 'boolean' }).default(false).notNull(),
  companyResearchUsed: integer({ mode: 'boolean' }).default(false).notNull(),
  generationStatus:    text().default('pending').notNull(),
  errorMessage:        text(),
  versionN:            integer().default(1).notNull(),
  createdAt:           text().$defaultFn(now).notNull(),
}, (table) => [
  index('resume_versions_job_id_idx').on(table.jobId),
  index('resume_versions_base_cv_hash_idx').on(table.baseCvHash),
])

export type ResumeVersion = typeof resumeVersions.$inferSelect

// ── HITL Review Dashboard (F4) ────────────────────────────────────────────────

export const hitlCheckpoints = sqliteTable('hitl_checkpoints', {
  id:           text().primaryKey().$defaultFn(newId),
  jobId:        text().notNull().references(() => jobs.id),
  candidateId:  text().notNull().references(() => candidates.id),
  status:       text().default('awaiting').notNull(),
  decisionType: text(),
  snoozedUntil: text(),
  decidedAt:    text(),
  createdAt:    text().$defaultFn(now).notNull(),
}, (table) => [
  index('hitl_checkpoints_candidate_status_idx').on(table.candidateId, table.status),
  index('hitl_checkpoints_job_id_idx').on(table.jobId),
  uniqueIndex('hitl_checkpoints_job_id_unique').on(table.jobId),
])

export type HitlCheckpoint = typeof hitlCheckpoints.$inferSelect

// ── LinkedIn Connector Agent (F5) ─────────────────────────────────────────────

export const outreachTargets = sqliteTable('outreach_targets', {
  id:                   text().primaryKey().$defaultFn(newId),
  jobId:                text().notNull().references(() => jobs.id),
  candidateId:          text().notNull().references(() => candidates.id),
  name:                 text(),
  linkedinUrl:          text(),
  title:                text(),
  company:              text().notNull(),
  seniority:            text(),
  enrichmentJson:       text({ mode: 'json' }),
  noteA:                text(),
  noteB:                text(),
  selectedNote:         text(),
  editedNote:           text(),
  status:               text().default('pending').notNull(),
  sentAt:               text(),
  acceptedAt:           text(),
  lastPolledAt:         text(),
  linkedinInvitationId: text(),
  errorMessage:         text(),
  // F6 email discovery fields
  email:                text(),
  emailConfidence:      integer(),
  emailSource:          text(),
  createdAt:            text().$defaultFn(now).notNull(),
  updatedAt:            text().$defaultFn(now).$onUpdateFn(now).notNull(),
}, (table) => [
  uniqueIndex('outreach_targets_job_id_unique').on(table.jobId),
  index('outreach_targets_candidate_status_idx').on(table.candidateId, table.status),
])

export type OutreachTarget = typeof outreachTargets.$inferSelect

// ── Outreach Mailer Agent (F6) ────────────────────────────────────────────────

export const emailCadences = sqliteTable('email_cadences', {
  id:                 text().primaryKey().$defaultFn(newId),
  jobId:              text().notNull().references(() => jobs.id),
  candidateId:        text().notNull().references(() => candidates.id),
  hiringManagerEmail: text(),
  emailConfidence:    integer(),
  emailSource:        text(),
  gmailThreadId:      text(),
  day1MessageId:      text(),
  status:             text().default('pending_discovery').notNull(),
  approvedAt:         text(),
  replyDetectedAt:    text(),
  bounceDetectedAt:   text(),
  errorMessage:       text(),
  retryCount:         integer().notNull().default(0),
  sendRetryCount:     integer().notNull().default(0),
  createdAt:          text().$defaultFn(now).notNull(),
  updatedAt:          text().$defaultFn(now).$onUpdateFn(now).notNull(),
}, (table) => [
  uniqueIndex('email_cadences_job_id_unique').on(table.jobId),
  index('email_cadences_candidate_status_idx').on(table.candidateId, table.status),
])

export type EmailCadence = typeof emailCadences.$inferSelect

export const emailDrafts = sqliteTable('email_drafts', {
  id:               text().primaryKey().$defaultFn(newId),
  cadenceId:        text().notNull().references(() => emailCadences.id),
  candidateId:      text().notNull().references(() => candidates.id),
  dayNumber:        integer().notNull(),
  subject:          text().notNull(),
  bodyHtml:         text().notNull(),
  bodyText:         text().notNull(),
  originalBodyHtml: text().notNull(),
  isApproved:       integer({ mode: 'boolean' }).default(false).notNull(),
  scheduledSendAt:  text(),
  status:           text().default('draft').notNull(),
  sentAt:           text(),
  gmailMessageId:   text(),
  openDetectedAt:   text(),
  clickDetectedAt:  text(),
  bounceDetectedAt: text(),
  createdAt:        text().$defaultFn(now).notNull(),
  updatedAt:        text().$defaultFn(now).$onUpdateFn(now).notNull(),
}, (table) => [
  index('email_drafts_cadence_day_idx').on(table.cadenceId, table.dayNumber),
  index('email_drafts_candidate_status_idx').on(table.candidateId, table.status),
  index('email_drafts_scheduled_idx').on(table.scheduledSendAt),
])

export type EmailDraft = typeof emailDrafts.$inferSelect
