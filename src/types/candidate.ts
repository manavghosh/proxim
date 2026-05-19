export type ParseStatus = 'pending' | 'parsing' | 'ready' | 'failed'

export interface Role {
  title: string
  company: string
  dates: string
  bullets: string[]
}

export interface ParsedProfile {
  name: string
  contact: Record<string, string>
  summary: string
  roles: Role[]
  skills: string[]
  patents: string[]
  projects: string[]
  education: string[]
  certifications: string[]
  awards: string[]
}

export interface Preferences {
  seniority_levels?: string[]
  geographic_preference?: string[]
  company_stages?: string[]
  compensation_band?: { min: number; max: number; currency: string }
  target_companies?: string[]
  preferred_domains?: string[]
  enabled_sources?: string[]
  custom_job_sites?: string[]
  grade_filter?: 'A' | 'A+B' | 'all'
  /** @deprecated kept for migration; new clients write `hitl_grades` */
  hitl_grade_filter?: 'A' | 'A+B' | 'all'
  hitl_grades?: string[]   // multi-select grade filter — e.g. ['A','B']
  hitl_sort?: 'score' | 'date' | 'company'
  // LinkedIn OAuth — stored here until a dedicated tokens table is added
  linkedin_access_token?: string
  linkedin_refresh_token?: string | null
  linkedin_token_expires_at?: string
  linkedin_connected_at?: string
  linkedin_profile_name?: string
  // LinkedIn connector (F5)
  linkedin_paused?: boolean
  do_not_contact_companies?: string[]
  // Gmail OAuth2 (F6)
  gmail_access_token?: string
  gmail_refresh_token?: string
  gmail_email?: string
  gmail_token_expiry?: string
  // Email outreach mode (F6)
  email_outreach_mode?: 'agentic' | 'manual'
  email_resume_attachment?: 'tailored' | 'original'
}

export type OutreachStatus =
  | 'pending' | 'discovering' | 'enriching' | 'generating'
  | 'notes_ready' | 'sent' | 'queued' | 'accepted' | 'expired'
  | 'paused' | 'no_contact_found' | 'skipped_dnc' | 'failed'

export interface OutreachTargetSummary {
  id:           string
  status:       OutreachStatus
  name:         string | null
  linkedinUrl:  string | null
  title:        string | null
  seniority:    string | null
  noteA:        string | null
  noteB:        string | null
  selectedNote: 'A' | 'B' | null
  editedNote:   string | null
  sentAt:       string | null
  acceptedAt:   string | null
  errorMessage: string | null
}

// ── Outreach Mailer Agent (F6) ────────────────────────────────────────────────

export type EmailCadenceStatus =
  | 'pending_discovery' | 'discovering' | 'low_confidence' | 'email_not_found'
  | 'generating' | 'pending_approval' | 'approved' | 'active'
  | 'paused' | 'auth_expired' | 'attachment_missing'
  | 'replied' | 'cadence_complete' | 'bounced' | 'cancelled' | 'failed'

export type EmailDraftStatus =
  | 'draft' | 'approved' | 'superseded' | 'scheduled'
  | 'sending' | 'sent' | 'manually_sent' | 'bounced' | 'rate_limited' | 'cancelled'

export interface EmailDraftSummary {
  id: string
  dayNumber: 1 | 3 | 7
  subject: string
  bodyHtml: string
  bodyText: string
  originalBodyHtml: string
  isApproved: boolean
  status: EmailDraftStatus
  scheduledSendAt: string | null
  sentAt: string | null
  openDetectedAt: string | null
  clickDetectedAt: string | null
}

export interface EmailCadenceSummary {
  id: string
  status: EmailCadenceStatus
  hiringManagerEmail: string | null
  emailConfidence: number | null
  approvedAt: string | null
  replyDetectedAt: string | null
  bounceDetectedAt: string | null
  drafts: EmailDraftSummary[]
}

export interface CandidateState {
  id: string
  name: string
  baseCvMd: string | null
  baseCvHash: string | null
  parseStatus: ParseStatus
  parsedProfile: ParsedProfile | null
  preferences: Preferences
}

export interface PipelineReadiness {
  ready: boolean
  missing: string[]
  parseStatus: ParseStatus
}

export type EmailOutreachMode = 'agentic' | 'manual'
