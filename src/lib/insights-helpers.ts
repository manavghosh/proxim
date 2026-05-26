import type { InsightsResponse, InsightsFunnel, InsightsRates, ArchetypeBreakdownRow } from '@/types/candidate'

export interface RawJob {
  id: string
  status: string
  archetype: string | null
  archetypeConfidence: number | null
  interviewCallbackAt: Date | string | null
  grade: string | null
}

export interface RawCadence {
  id: string
  jobId: string
  replyDetectedAt: Date | string | null
  status: string
}

export interface RawDraft {
  id: string
  cadenceId: string
  dayNumber: number
  sentAt: Date | string | null
  openDetectedAt: Date | string | null
}

export interface RawData {
  jobs: RawJob[]
  cadences: RawCadence[]
  drafts: RawDraft[]
}

const APPROVED_STATUSES = new Set([
  'approved', 'resume_ready', 'resume_failed', 'submitted', 'score_failed',
])

export function aggregateInsights(_candidateId: string, data: RawData): InsightsResponse {
  const { jobs: allJobs, cadences: allCadences, drafts: allDrafts } = data

  const approvedJobs = allJobs.filter(j => APPROVED_STATUSES.has(j.status))
  const discovered = allJobs.length
  const approved = approvedJobs.length

  // Day 1 sent: one per cadence (most recent sentAt when retries exist)
  const day1DraftsByCadence = new Map<string, RawDraft>()
  for (const d of allDrafts) {
    if (d.dayNumber !== 1 || !d.sentAt) continue
    const existing = day1DraftsByCadence.get(d.cadenceId)
    if (!existing || new Date(d.sentAt as string) > new Date(existing.sentAt as string)) {
      day1DraftsByCadence.set(d.cadenceId, d)
    }
  }
  const day1Sent = day1DraftsByCadence.size

  // Opened: distinct cadences where at least one draft has both sentAt AND openDetectedAt
  const openedCadenceIds = new Set<string>()
  for (const d of allDrafts) {
    if (d.sentAt && d.openDetectedAt) openedCadenceIds.add(d.cadenceId)
  }
  const opened = openedCadenceIds.size

  // Replied: cadences with replyDetectedAt (regardless of cancellation status)
  const replied = allCadences.filter(c => c.replyDetectedAt).length

  // Callbacks
  const callbacks = allJobs.filter(j => j.interviewCallbackAt).length

  const funnel: InsightsFunnel = { discovered, approved, day1Sent, opened, replied, callbacks }

  // Rates (null when denominator is zero — never show "0%" for undefined rates)
  const abCount = approvedJobs.filter(j => j.grade === 'A' || j.grade === 'B').length
  const rates: InsightsRates = {
    openRate:     day1Sent > 0 ? opened / day1Sent : null,
    replyRate:    day1Sent > 0 ? replied / day1Sent : null,
    abGradeRate:  approved > 0 ? abCount / approved : null,
    callbackRate: approved > 0 ? callbacks / approved : null,
  }

  // Archetype breakdown
  const archetypeJobs = approvedJobs.filter(j => j.archetype)
  const uniqueArchetypes = new Set(archetypeJobs.map(j => j.archetype!))

  if (uniqueArchetypes.size < 2) {
    return { funnel, rates, archetypeBreakdown: [] }
  }

  const cadenceByJobId = new Map<string, RawCadence[]>()
  for (const c of allCadences) {
    const arr = cadenceByJobId.get(c.jobId) ?? []
    arr.push(c)
    cadenceByJobId.set(c.jobId, arr)
  }

  const sentCadenceIds = new Set(day1DraftsByCadence.keys())

  const breakdown: ArchetypeBreakdownRow[] = []
  for (const archetype of uniqueArchetypes) {
    const archetypeJobIds = archetypeJobs
      .filter(j => j.archetype === archetype)
      .map(j => j.id)
    const archetypeCadences = archetypeJobIds.flatMap(id => cadenceByJobId.get(id) ?? [])
    const sent = archetypeCadences.filter(c => sentCadenceIds.has(c.id)).length
    const archetypeReplied = archetypeCadences.filter(c => c.replyDetectedAt).length
    breakdown.push({
      archetype,
      approved: archetypeJobIds.length,
      sent,
      replied: archetypeReplied,
      replyRate: sent > 0 ? archetypeReplied / sent : 0,
    })
  }

  breakdown.sort((a, b) => (b.replyRate ?? 0) - (a.replyRate ?? 0))

  return { funnel, rates, archetypeBreakdown: breakdown.slice(0, 5) }
}
