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
  hitl_grade_filter?: 'A' | 'A+B' | 'all'
  hitl_sort?: 'score' | 'date' | 'company'
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
