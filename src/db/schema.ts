import {
  pgTable,
  uuid,
  text,
  varchar,
  jsonb,
  pgEnum,
  timestamp,
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
