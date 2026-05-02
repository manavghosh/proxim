import type { CandidateState, Preferences, PipelineReadiness } from '@/types/candidate'

const BASE = process.env.NEXT_PUBLIC_API_URL ?? ''

async function request<T>(path: string, init?: RequestInit, attempt = 1): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init)
  if (!res.ok) {
    if (res.status === 500 && attempt < 5) {
      await new Promise((r) => setTimeout(r, 1500 * attempt))
      return request<T>(path, init, attempt + 1)
    }
    const text = await res.text()
    throw new Error(`${res.status}: ${text}`)
  }
  return res.json() as Promise<T>
}

export async function getCV(): Promise<CandidateState> {
  return request('/api/cv')
}

export async function reparseCV(): Promise<CandidateState> {
  return request('/api/cv/reparse', { method: 'POST' })
}

export async function convertCV(file: File): Promise<{ markdown: string }> {
  const form = new FormData()
  form.append('file', file)
  return request('/api/cv/convert', { method: 'POST', body: form })
}

export async function saveCV(markdown: string): Promise<CandidateState> {
  return request('/api/cv/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ markdown }),
  })
}

export async function getPreferences(): Promise<{ preferences: Preferences }> {
  return request('/api/preferences')
}

export async function updatePreferences(
  updates: Partial<Preferences>
): Promise<{ preferences: Preferences }> {
  return request('/api/preferences', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  })
}

export async function getReadiness(): Promise<PipelineReadiness> {
  return request('/api/candidate/readiness')
}

export type PipelineJobType = 'full_pipeline' | 'discovery_only' | 'fetch_jds' | 'score_jobs'

export async function triggerPipeline(jobType: PipelineJobType): Promise<{ jobId: string; status: string }> {
  return request('/api/pipeline/trigger', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobType }),
  })
}

export async function getPipelineStatus(jobId: string): Promise<{
  jobId: string
  status: string
  jobType: string
  followUpJobId: string | null
  pipelineRun: { jobsDiscovered: number; jobsDeduplicated: number } | null
}> {
  return request(`/api/pipeline/${jobId}/status`)
}

export interface ScoredJob {
  id: string
  title: string
  company: string
  location: string | null
  source: string
  sourceUrl: string
  postedAt: string | null
  status: string
  grade: string | null
  score10d: Record<string, unknown> | null
  archetype: string | null
  archetypeConfidence: string | null
  createdAt: string
}

export async function getJobs(
  gradeFilter: 'A' | 'A+B' | 'all' = 'all'
): Promise<{ jobs: ScoredJob[] }> {
  return request(`/api/jobs?grade=${encodeURIComponent(gradeFilter)}`)
}

export async function submitDecision(
  jobId: string,
  decision: 'approved' | 'rejected' | 'snoozed'
): Promise<{ jobId: string; status: string }> {
  return request(`/api/jobs/${jobId}/decision`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision }),
  })
}

export async function getJobReport(
  jobId: string
): Promise<{ reportMd: string | null; grade: string | null }> {
  return request(`/api/jobs/${jobId}/report`)
}
