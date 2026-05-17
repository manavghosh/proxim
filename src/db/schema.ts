import {
  pgTable,
  uuid,
  text,
  varchar,
  jsonb,
  pgEnum,
  timestamp,
  integer,
  numeric,
  boolean,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

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
}

export const parseStatusEnum = pgEnum('parse_status', [
  'pending',
  'parsing',
  'ready',
  'failed',
])

export const candidates = pgTable('candidates', {
  id: uuid().defaultRandom().primaryKey(),
  name: varchar({ length: 255 }).default('New Candidate').notNull(),
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
  'resume_ready', 'submitted',
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
  status:              jobStatusEnum().default('discovered').notNull(),
  score10d:            jsonb().$type<Score10D>(),
  grade:               varchar({ length: 1 }),
  reportMd:            text(),
  archetype:           text(),
  archetypeConfidence: numeric({ precision: 3, scale: 2 }),
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

// ── Resume Builder (F10) ──────────────────────────────────────────────────────

export const resumeVersions = pgTable('resume_versions', {
  id:                  uuid().defaultRandom().primaryKey(),
  jobId:               uuid().references(() => jobs.id).notNull(),
  candidateId:         uuid().references(() => candidates.id),
  archetype:           text().notNull(),
  archetypeConfidence: numeric({ precision: 3, scale: 2 }),
  keywords:            jsonb().$type<string[]>(),
  scoreAtGeneration:   numeric({ precision: 4, scale: 2 }),
  resumePdfPath:       text(),
  coverLetterPdfPath:  text(),
  baseCvHash:          text().notNull(),
  isSubmitted:         boolean().default(false).notNull(),
  companyResearchUsed: boolean().default(false).notNull(),
  generationStatus:    text().default('pending').notNull(),
  errorMessage:        text(),
  versionN:            integer().default(1).notNull(),
  createdAt:           timestamp({ withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('resume_versions_job_id_idx').on(table.jobId),
  index('resume_versions_base_cv_hash_idx').on(table.baseCvHash),
])

export type ResumeVersion = typeof resumeVersions.$inferSelect

// ── HITL Review Dashboard (F4) ────────────────────────────────────────────────

export const hitlCheckpointStatusEnum = pgEnum('hitl_checkpoint_status', [
  'awaiting', 'approved', 'rejected', 'snoozed',
])

export const hitlCheckpoints = pgTable('hitl_checkpoints', {
  id:           uuid().defaultRandom().primaryKey(),
  jobId:        uuid().references(() => jobs.id).notNull(),
  candidateId:  uuid().references(() => candidates.id).notNull(),
  status:       hitlCheckpointStatusEnum().default('awaiting').notNull(),
  decisionType: text(),
  snoozedUntil: timestamp({ withTimezone: true }),
  decidedAt:    timestamp({ withTimezone: true }),
  createdAt:    timestamp({ withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('hitl_checkpoints_candidate_status_idx').on(table.candidateId, table.status),
  index('hitl_checkpoints_job_id_idx').on(table.jobId),
  uniqueIndex('hitl_checkpoints_job_id_unique').on(table.jobId),
])

export type HitlCheckpoint = typeof hitlCheckpoints.$inferSelect

// ── LinkedIn Connector Agent (F5) ─────────────────────────────────────────────

export type ProxycurlPersonEnrichment = {
  full_name:   string | null
  headline:    string | null
  summary:     string | null
  experiences: Array<{
    title:     string
    company:   string
    starts_at: { day: number; month: number; year: number } | null
    ends_at:   { day: number; month: number; year: number } | null
  }>
  education: Array<{
    degree_name: string | null
    school:      { name: string } | null
    ends_at:     { year: number } | null
  }>
}

export const outreachStatusEnum = pgEnum('outreach_status', [
  'pending',
  'discovering',
  'enriching',
  'generating',
  'notes_ready',
  'sent',
  'queued',
  'accepted',
  'expired',
  'paused',
  'no_contact_found',
  'skipped_dnc',
  'failed',
])

export const outreachTargets = pgTable('outreach_targets', {
  id:                   uuid().defaultRandom().primaryKey(),
  jobId:                uuid().references(() => jobs.id).notNull(),
  candidateId:          uuid().references(() => candidates.id).notNull(),
  name:                 text(),
  linkedinUrl:          text(),
  title:                text(),
  company:              text().notNull(),
  seniority:            text(),
  enrichmentJson:       jsonb().$type<ProxycurlPersonEnrichment>(),
  noteA:                text(),
  noteB:                text(),
  selectedNote:         text(),
  editedNote:           text(),
  status:               outreachStatusEnum().default('pending').notNull(),
  sentAt:               timestamp({ withTimezone: true }),
  acceptedAt:           timestamp({ withTimezone: true }),
  lastPolledAt:         timestamp({ withTimezone: true }),
  linkedinInvitationId: text(),
  errorMessage:         text(),
  // F6 email discovery fields
  email:                text(),
  emailConfidence:      integer(),
  emailSource:          text(),
  createdAt:            timestamp({ withTimezone: true }).defaultNow().notNull(),
  updatedAt:            timestamp({ withTimezone: true }).defaultNow().notNull().$onUpdateFn(() => new Date()),
}, (table) => [
  uniqueIndex('outreach_targets_job_id_unique').on(table.jobId),
  index('outreach_targets_candidate_status_idx').on(table.candidateId, table.status),
  index('outreach_targets_sent_at_idx').on(table.sentAt),
])

export type OutreachTarget = typeof outreachTargets.$inferSelect

// ── Outreach Mailer Agent (F6) ────────────────────────────────────────────────

export const emailCadenceStatusEnum = pgEnum('email_cadence_status', [
  'pending_discovery',
  'discovering',
  'low_confidence',
  'email_not_found',
  'generating',
  'pending_approval',
  'approved',
  'active',
  'paused',
  'auth_expired',
  'attachment_missing',
  'replied',
  'cadence_complete',
  'bounced',
  'cancelled',
  'failed',
])

export const emailCadences = pgTable('email_cadences', {
  id:                 uuid().defaultRandom().primaryKey(),
  jobId:              uuid().references(() => jobs.id).notNull(),
  candidateId:        uuid().references(() => candidates.id).notNull(),
  hiringManagerEmail: text(),
  emailConfidence:    integer(),
  emailSource:        text(),
  gmailThreadId:      text(),
  day1MessageId:      text(),
  status:             emailCadenceStatusEnum().default('pending_discovery').notNull(),
  approvedAt:         timestamp({ withTimezone: true }),
  replyDetectedAt:    timestamp({ withTimezone: true }),
  bounceDetectedAt:   timestamp({ withTimezone: true }),
  errorMessage:       text(),
  createdAt:          timestamp({ withTimezone: true }).defaultNow().notNull(),
  updatedAt:          timestamp({ withTimezone: true }).defaultNow().notNull().$onUpdateFn(() => new Date()),
}, (table) => [
  uniqueIndex('email_cadences_job_id_unique').on(table.jobId),
  index('email_cadences_candidate_status_idx').on(table.candidateId, table.status),
])

export type EmailCadence = typeof emailCadences.$inferSelect

export const emailDraftStatusEnum = pgEnum('email_draft_status', [
  'draft',
  'approved',
  'superseded',
  'scheduled',
  'sending',
  'sent',
  'bounced',
  'rate_limited',
  'cancelled',
])

export const emailDrafts = pgTable('email_drafts', {
  id:               uuid().defaultRandom().primaryKey(),
  cadenceId:        uuid().references(() => emailCadences.id).notNull(),
  candidateId:      uuid().references(() => candidates.id).notNull(),
  dayNumber:        integer().notNull(),
  subject:          text().notNull(),
  bodyHtml:         text().notNull(),
  bodyText:         text().notNull(),
  originalBodyHtml: text().notNull(),
  isApproved:       boolean().default(false).notNull(),
  scheduledSendAt:  timestamp({ withTimezone: true }),
  status:           emailDraftStatusEnum().default('draft').notNull(),
  sentAt:           timestamp({ withTimezone: true }),
  gmailMessageId:   text(),
  openDetectedAt:   timestamp({ withTimezone: true }),
  clickDetectedAt:  timestamp({ withTimezone: true }),
  bounceDetectedAt: timestamp({ withTimezone: true }),
  createdAt:        timestamp({ withTimezone: true }).defaultNow().notNull(),
  updatedAt:        timestamp({ withTimezone: true }).defaultNow().notNull().$onUpdateFn(() => new Date()),
}, (table) => [
  index('email_drafts_cadence_day_idx').on(table.cadenceId, table.dayNumber),
  index('email_drafts_candidate_status_idx').on(table.candidateId, table.status),
  index('email_drafts_scheduled_idx').on(table.scheduledSendAt),
])

export type EmailDraft = typeof emailDrafts.$inferSelect
