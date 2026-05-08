import type { CandidateState, Preferences, PipelineReadiness } from '@/types/candidate'
import type { PositionGroup } from '@/lib/position-normalizer'

export type { PositionGroup }

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

function qs(candidateId: string) {
  return `?candidateId=${encodeURIComponent(candidateId)}`
}

// ── Candidates (roster) ──────────────────────────────────────────────────────

export interface CandidateSummary {
  id: string
  name: string
  parseStatus: string
  jobsMatched: number
  applications: number
  createdAt: string
}

export async function getCandidates(): Promise<{ candidates: CandidateSummary[] }> {
  return request('/api/candidates')
}

export async function createCandidate(name: string): Promise<{ id: string; name: string }> {
  return request('/api/candidates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
}

export async function updateCandidateName(id: string, name: string): Promise<void> {
  return request(`/api/candidates/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
}

// ── CV ───────────────────────────────────────────────────────────────────────

export async function getCV(candidateId: string): Promise<CandidateState> {
  return request(`/api/cv${qs(candidateId)}`)
}

export async function reparseCV(candidateId: string): Promise<CandidateState> {
  return request(`/api/cv/reparse${qs(candidateId)}`, { method: 'POST' })
}

export async function convertCV(file: File): Promise<{ markdown: string }> {
  const form = new FormData()
  form.append('file', file)
  return request('/api/cv/convert', { method: 'POST', body: form })
}

export async function saveCV(markdown: string, candidateId: string): Promise<CandidateState> {
  return request(`/api/cv/save${qs(candidateId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ markdown }),
  })
}

// ── Preferences ──────────────────────────────────────────────────────────────

export async function getPreferences(candidateId: string): Promise<{ preferences: Preferences }> {
  return request(`/api/preferences${qs(candidateId)}`)
}

export async function updatePreferences(
  updates: Partial<Preferences>,
  candidateId: string
): Promise<{ preferences: Preferences }> {
  return request(`/api/preferences${qs(candidateId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  })
}

// ── Readiness ────────────────────────────────────────────────────────────────

export async function getReadiness(candidateId: string): Promise<PipelineReadiness> {
  return request(`/api/candidate/readiness${qs(candidateId)}`)
}

// ── Pipeline ─────────────────────────────────────────────────────────────────

export type PipelineJobType = 'full_pipeline' | 'discovery_only' | 'fetch_jds' | 'score_jobs'

export async function triggerPipeline(
  jobType: PipelineJobType,
  candidateId: string
): Promise<{ jobId: string; status: string }> {
  return request(`/api/pipeline/trigger${qs(candidateId)}`, {
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

// ── Jobs ─────────────────────────────────────────────────────────────────────

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
  candidateId: string,
  grades: string[] = ['A', 'B', 'C', 'D', 'F']
): Promise<{ jobs: ScoredJob[] }> {
  return request(`/api/jobs${qs(candidateId)}&grades=${encodeURIComponent(grades.join(','))}`)
}

export async function submitDecision(
  jobId: string,
  decision: 'approved' | 'rejected' | 'snoozed' | 'scored'
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

export async function getJobStats(candidateId: string): Promise<{ scoreFailed: number; jobsMatched: number; applications: number }> {
  try {
    return await request(`/api/jobs/stats${qs(candidateId)}`)
  } catch {
    return { scoreFailed: 0, jobsMatched: 0, applications: 0 }
  }
}

export async function resetFailedJobs(candidateId: string): Promise<{ reset: number }> {
  return request(`/api/jobs/reset-failed${qs(candidateId)}`, { method: 'POST' })
}

// ── Scoring Batch ────────────────────────────────────────────────────────────

export interface ReadyToScoreResponse {
  totalJobs: number
  groups: PositionGroup[]
}

export async function getReadyToScoreGroups(candidateId: string): Promise<ReadyToScoreResponse> {
  return request(`/api/jobs/ready-to-score${qs(candidateId)}`)
}

export async function scoreBatch(
  candidateId: string,
  jobIds: string[]
): Promise<{ jobId: string; status: string; createdAt?: string }> {
  return request(`/api/pipeline/score-batch${qs(candidateId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobIds }),
  })
}

// ── Resume Builder (F10) ──────────────────────────────────────────────────────

export interface ResumeVersion {
  id: string
  jobId: string
  candidateId: string | null
  archetype: string
  archetypeConfidence: string | null
  keywords: string[] | null
  resumePdfPath: string | null
  coverLetterPdfPath: string | null
  baseCvHash: string
  isSubmitted: boolean
  generationStatus: string
  errorMessage: string | null
  versionN: number
  createdAt: string
  isStale: boolean
}

export async function triggerResumeGeneration(
  jobId: string,
  candidateId: string
): Promise<{ pipelineJobId: string; status: string }> {
  return request(`/api/jobs/${jobId}/resume${qs(candidateId)}`, { method: 'POST' })
}

export async function getResumeVersions(
  jobId: string,
  candidateId: string
): Promise<{ versions: ResumeVersion[]; currentCvHash: string | null }> {
  return request(`/api/jobs/${jobId}/resume${qs(candidateId)}`)
}

export function downloadResumeUrl(
  jobId: string,
  versionId: string,
  type: 'resume' | 'cover-letter'
): string {
  return `${BASE}/api/jobs/${jobId}/resume/${versionId}/download?type=${type}`
}

export async function submitResumeVersion(
  jobId: string,
  versionId: string
): Promise<{ versionId: string; isSubmitted: boolean }> {
  return request(`/api/jobs/${jobId}/resume/${versionId}/submit`, { method: 'POST' })
}

// ── HITL Review Dashboard (F4) ────────────────────────────────────────────────

export interface HitlCheckpointSummary {
  id: string
  status: string
  snoozedUntil: string | null
  createdAt: string
}

export interface HitlJob {
  id: string
  title: string
  company: string
  location: string | null
  source: string
  sourceUrl: string
  postedAt: string | null
  status: string
  grade: string | null
  numericScore: number | null
  score10d: Record<string, unknown> | null
  reportMd: string | null
  archetype: string | null
  archetypeConfidence: string | null
  hitlCheckpoint: HitlCheckpointSummary | null
}

export async function getCandidateJobs(
  candidateId: string,
  filter?: string,
  sort?: string
): Promise<{ jobs: HitlJob[]; total: number }> {
  const params = new URLSearchParams({ candidateId })
  if (filter) params.set('filter', filter)
  if (sort) params.set('sort', sort)
  return request(`/api/candidates/${candidateId}/jobs?${params.toString()}`)
}

export async function approveJob(
  jobId: string,
  candidateId: string
): Promise<{ jobId: string; status: string; pipelineJobId: string; checkpointId: string }> {
  return request(`/api/jobs/${jobId}/approve?candidateId=${encodeURIComponent(candidateId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
}

export async function rejectJob(
  jobId: string,
  candidateId: string
): Promise<{ jobId: string; status: string; checkpointId: string }> {
  return request(`/api/jobs/${jobId}/reject?candidateId=${encodeURIComponent(candidateId)}`, {
    method: 'POST',
  })
}

export async function snoozeJob(
  jobId: string,
  candidateId: string,
  days = 7
): Promise<{ jobId: string; status: string; snoozedUntil: string; checkpointId: string }> {
  return request(`/api/jobs/${jobId}/snooze?candidateId=${encodeURIComponent(candidateId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ days }),
  })
}

export async function unsnoozeJob(
  jobId: string,
  candidateId: string
): Promise<{ jobId: string; status: string; checkpointId: string }> {
  return request(`/api/jobs/${jobId}/unsnooze?candidateId=${encodeURIComponent(candidateId)}`, {
    method: 'POST',
  })
}

export function startJobStream(
  candidateId: string,
  onJobsArrived: (jobIds: string[]) => void,
  onIdle: () => void
): () => void {
  const eventSource = new EventSource(`/api/candidates/${candidateId}/jobs/stream`)

  eventSource.addEventListener('jobs_arrived', (e: MessageEvent) => {
    try {
      const data = JSON.parse(e.data) as { count: number; jobIds: string[] }
      onJobsArrived(data.jobIds)
    } catch {
      // ignore parse errors
    }
  })

  eventSource.addEventListener('idle', () => {
    eventSource.close()
    onIdle()
  })

  eventSource.onerror = () => {
    eventSource.close()
    onIdle()
  }

  return () => eventSource.close()
}
