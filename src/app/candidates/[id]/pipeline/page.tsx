'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { JobReviewCard } from '@/components/pipeline/JobReviewCard'
import { CandidateSwitcher } from '@/components/layout/CandidateSwitcher'
import { GradeFilterDropdown, ALL_GRADES } from '@/components/applications/GradeFilterDropdown'
import type { Grade } from '@/components/applications/GradeFilterDropdown'
import { PipelineSortControl } from '@/components/pipeline/PipelineSortControl'
import { SourceFilterControl } from '@/components/pipeline/SourceFilterControl'
import type { SourceFilter } from '@/components/pipeline/SourceFilterControl'
import { PipelineLogPane } from '@/components/dashboard/PipelineLogPane'
import { ScoreFailedSection } from '@/components/pipeline/ScoreFailedSection'
import {
  getCandidateJobs,
  approveJob,
  rejectJob,
  snoozeJob,
  unsnoozeJob,
  startJobStream,
  updatePreferences,
  getPreferences,
  triggerResumeGeneration,
  getPipelineStatus,
  type HitlJob,
} from '@/lib/api'
import { Workflow, CheckCircle2 } from 'lucide-react'
import type { OutreachStatus, EmailCadenceStatus } from '@/types/candidate'

// The Scorecard shows every grade, including F. F jobs are read-only — shown
// for improvement insight (CV gaps + learnings via the report), not to apply
// to — see JobReviewCard.
const PIPELINE_GRADES: Grade[] = [...ALL_GRADES]
type SortOption = 'score' | 'date' | 'company'

function Toast({ message, type = 'info', onDismiss }: { message: string; type?: 'info' | 'success' | 'error'; onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 4000)
    return () => clearTimeout(t)
  }, [onDismiss])

  const bg = type === 'success' ? 'bg-emerald-900 border-emerald-700' : type === 'error' ? 'bg-red-900 border-red-700' : 'bg-background border-primary'
  return (
    <div
      data-slot="flash-toast"
      className={`fixed bottom-4 right-4 z-50 px-4 py-3 rounded-lg border text-[12px] text-white shadow-lg ${bg}`}
    >
      {message}
    </div>
  )
}

export default function PipelinePage() {
  const { id: candidateId } = useParams<{ id: string }>()
  const router = useRouter()

  const [jobs, setJobs] = useState<HitlJob[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedGrades, setSelectedGrades] = useState<Grade[]>([...PIPELINE_GRADES])
  const [sort, setSort] = useState<SortOption>('score')
  const [pendingJobIds, setPendingJobIds] = useState<Set<string>>(new Set())
  const [toast, setToast] = useState<{ message: string; type: 'info' | 'success' | 'error' } | null>(null)
  const [streamConnected, setStreamConnected] = useState(false)
  const streamCleanupRef = useRef<(() => void) | null>(null)
  // resume_builder pipeline_jobs queued from this page's Approve clicks. Each
  // approve pushes its returned `pipelineJobId` so the log pane streams every
  // build that's currently in flight.
  const [resumeBuilderJobIds, setResumeBuilderJobIds] = useState<string[]>([])
  const [retryJobIds, setRetryJobIds] = useState<string[]>([])
  const [pendingOutreachIds, setPendingOutreachIds] = useState<Set<string>>(new Set())
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all')
  // Batch view: set when the user arrives right after an "Add Jobs" import.
  // Filters the list to just that import + shows a live progress banner.
  const [batchFilterId, setBatchFilterId] = useState<string | null>(null)
  const [batchCount, setBatchCount] = useState(0)
  const [batchComplete, setBatchComplete] = useState(false)
  const logPaneRef = useRef<HTMLDivElement>(null)

  const showToast = (message: string, type: 'info' | 'success' | 'error' = 'info') => {
    setToast({ message, type })
  }

  const loadJobs = useCallback(async (g: Grade[], s: SortOption) => {
    try {
      const data = await getCandidateJobs(candidateId, g, s)
      setJobs(data.jobs)
    } catch {
      showToast('Failed to load jobs', 'error')
    } finally {
      setLoading(false)
    }
  }, [candidateId])

  // Always start the Pipeline page with no grade filter applied — the user
  // sees every A/B/C/D row on landing. Sort preference is still restored
  // because it's a "how to view" choice, not a "what to view" one.
  useEffect(() => {
    const init = async () => {
      const defaultGrades: Grade[] = [...PIPELINE_GRADES]
      try {
        const { preferences } = await getPreferences(candidateId)
        const savedSort = (preferences.hitl_sort as SortOption) ?? 'score'
        setSelectedGrades(defaultGrades)
        setSort(savedSort)
        await loadJobs(defaultGrades, savedSort)
      } catch {
        await loadJobs(defaultGrades, 'score')
      }
    }
    init()
  }, [candidateId, loadJobs])

  // Pick up any pending import job ID stored by ImportJobsSheet when the user
  // navigated here from the Dashboard — show the log pane immediately so they
  // can watch import → scoring progress without refreshing.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const key = `proxim-import-${candidateId}`
    const raw = sessionStorage.getItem(key)
    if (raw) {
      sessionStorage.removeItem(key)
      // New format: JSON {id, count}. Legacy: bare pipelineJobId string.
      let id = raw
      let count = 0
      try {
        const parsed = JSON.parse(raw) as { id?: string; count?: number }
        if (parsed && typeof parsed === 'object') { id = parsed.id ?? raw; count = parsed.count ?? 0 }
      } catch { /* legacy bare string */ }
      setRetryJobIds([id])
      setBatchFilterId(id)
      setBatchCount(count)
      setTimeout(() => {
        if (logPaneRef.current) {
          logPaneRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }
      }, 300)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidateId])

  // While a batch view is active, poll the import run's status so the banner can
  // flip from "scoring…" to "complete" and the freshly-scored cards load in.
  useEffect(() => {
    if (!batchFilterId || batchComplete) return
    let cancelled = false
    // import_jobs chains to a follow-up score_jobs run — "scoring complete" is
    // the terminal job in that chain, not the import job itself.
    let currentId = batchFilterId
    const tick = async () => {
      try {
        const st = await getPipelineStatus(currentId)
        if (cancelled) return
        if (st.status === 'completed') {
          if (st.followUpJobId) {
            currentId = st.followUpJobId            // advance to the scoring job
            loadJobs(selectedGrades, sort)           // cards may already be landing
          } else if (currentId !== batchFilterId) {
            setBatchComplete(true)                   // terminal scoring job finished
            loadJobs(selectedGrades, sort)
          }
          // else: import done but scoring not queued yet — keep polling
        } else if (st.status === 'failed') {
          setBatchComplete(true)
          loadJobs(selectedGrades, sort)
        }
      } catch { /* transient — keep polling */ }
    }
    const interval = setInterval(tick, 3000)
    void tick()
    return () => { cancelled = true; clearInterval(interval) }
  }, [batchFilterId, batchComplete, selectedGrades, sort, loadJobs])

  // SSE stream
  const reconnectStream = useCallback(() => {
    if (streamCleanupRef.current) {
      streamCleanupRef.current()
      streamCleanupRef.current = null
    }

    const cleanup = startJobStream(
      candidateId,
      (jobIds) => {
        showToast(`${jobIds.length} new job${jobIds.length > 1 ? 's' : ''} arrived!`, 'info')
        loadJobs(selectedGrades, sort)
      },
      () => {
        setStreamConnected(false)
        setTimeout(() => reconnectStream(), 3000)
      }
    )
    streamCleanupRef.current = cleanup
    setStreamConnected(true)
  }, [candidateId, selectedGrades, sort, loadJobs])

  useEffect(() => {
    reconnectStream()
    return () => {
      streamCleanupRef.current?.()
    }
  }, [reconnectStream])

  useEffect(() => {
    if (pendingOutreachIds.size === 0) return
    const OUTREACH_TRANSIENT = new Set<OutreachStatus>(['pending', 'discovering', 'enriching', 'generating'])
    const EMAIL_TRANSIENT    = new Set<EmailCadenceStatus>(['pending_discovery', 'discovering', 'generating', 'email_not_found'])
    setPendingOutreachIds(prev => {
      const next = new Set(prev)
      for (const id of prev) {
        const job = jobs.find(j => j.id === id)
        if (!job) { next.delete(id); continue }
        const outreachDone = job.outreachTarget && !OUTREACH_TRANSIENT.has(job.outreachTarget.status as OutreachStatus)
        const emailDone    = job.emailCadence   && !EMAIL_TRANSIENT.has(job.emailCadence.status as EmailCadenceStatus)
        if (outreachDone && emailDone) next.delete(id)
      }
      return next
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs])

  const handleGradesChange = (next: Grade[]) => {
    // Filter is session-only on the Pipeline page — every navigation back here
    // resets to "all grades" so the user always sees every reviewable row.
    setSelectedGrades(next)
    loadJobs(next, sort)
  }

  const handleSortChange = async (newSort: SortOption) => {
    setSort(newSort)
    await updatePreferences({ hitl_sort: newSort }, candidateId)
    loadJobs(selectedGrades, newSort)
  }

  const setPending = (jobId: string, val: boolean) => {
    setPendingJobIds(prev => {
      const next = new Set(prev)
      if (val) next.add(jobId)
      else next.delete(jobId)
      return next
    })
  }

  const handleApprove = async (jobId: string) => {
    setPending(jobId, true)
    try {
      await approveJob(jobId, candidateId)
      setJobs(prev => prev.map(j => j.id === jobId ? { ...j, status: 'approved' } : j))
      setPendingOutreachIds(prev => new Set([...prev, jobId]))
      showToast('Job approved — LinkedIn outreach queued', 'success')
    } catch (e: unknown) {
      if (e instanceof Error && e.message.startsWith('409')) {
        showToast('Already decided — refreshing…', 'info')
        loadJobs(selectedGrades, sort)
      } else {
        showToast('Failed to approve job', 'error')
      }
    } finally {
      setPending(jobId, false)
    }
  }

  const handleGenerateResume = async (jobId: string) => {
    setPending(jobId, true)
    try {
      const res = await triggerResumeGeneration(jobId, candidateId)
      if (res.pipelineJobId) {
        setResumeBuilderJobIds((prev) => [...prev, res.pipelineJobId])
        setTimeout(() => {
          if (typeof logPaneRef.current?.scrollIntoView === 'function') {
            logPaneRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
          }
        }, 100)
      }
      showToast('Resume generation queued', 'success')
    } catch {
      showToast('Failed to queue resume generation', 'error')
    } finally {
      setPending(jobId, false)
    }
  }

  const handleReject = async (jobId: string) => {
    setPending(jobId, true)
    try {
      await rejectJob(jobId, candidateId)
      setJobs(prev => prev.filter(j => j.id !== jobId))
      showToast('Job rejected', 'info')
    } catch (e: unknown) {
      if (e instanceof Error && e.message.startsWith('409')) {
        showToast('Already decided — refreshing…', 'info')
        loadJobs(selectedGrades, sort)
      } else {
        showToast('Failed to reject job', 'error')
      }
    } finally {
      setPending(jobId, false)
    }
  }

  const handleSnooze = async (jobId: string) => {
    setPending(jobId, true)
    try {
      const result = await snoozeJob(jobId, candidateId, 7)
      setJobs(prev => prev.map(j =>
        j.id === jobId
          ? { ...j, status: 'snoozed', hitlCheckpoint: { id: result.checkpointId, status: 'snoozed', snoozedUntil: result.snoozedUntil, createdAt: new Date().toISOString() } }
          : j
      ))
      showToast('Job snoozed for 7 days', 'info')
    } catch (e: unknown) {
      if (e instanceof Error && e.message.startsWith('409')) {
        showToast('Already decided — refreshing…', 'info')
        loadJobs(selectedGrades, sort)
      } else {
        showToast('Failed to snooze job', 'error')
      }
    } finally {
      setPending(jobId, false)
    }
  }

  const handleUnsnooze = async (jobId: string) => {
    setPending(jobId, true)
    try {
      await unsnoozeJob(jobId, candidateId)
      setJobs(prev => prev.map(j =>
        j.id === jobId ? { ...j, status: 'awaiting', hitlCheckpoint: j.hitlCheckpoint ? { ...j.hitlCheckpoint, status: 'awaiting', snoozedUntil: null } : null } : j
      ))
      showToast('Job unsnoozed', 'info')
    } catch {
      showToast('Failed to unsnooze job', 'error')
    } finally {
      setPending(jobId, false)
    }
  }

  const allScored = jobs.filter(j => j.status !== 'score_failed')
  const allFailed = jobs.filter(j => j.status === 'score_failed')

  // Source counts feed the Source dropdown.
  const sourceCounts: Partial<Record<SourceFilter, number>> = {
    all: allScored.length,
    imported: allScored.filter(j => j.origin === 'imported').length,
    discovered: allScored.filter(j => j.origin === 'discovered').length,
  }

  // A job is visible when it matches the source filter AND (in batch mode) the
  // active import batch.
  const matchesView = (j: HitlJob) =>
    (sourceFilter === 'all' || j.origin === sourceFilter) &&
    (!batchFilterId || j.batchId === batchFilterId)

  // Per-grade counts feed the dropdown's count column + the inline badges. They
  // respect the active Source/batch view so the "N shown" total stays consistent.
  const counts = PIPELINE_GRADES.reduce((acc, g) => {
    acc[g] = jobs.filter((j) => j.grade === g && matchesView(j)).length
    return acc
  }, {} as Partial<Record<Grade, number>>)

  const scoredJobs = allScored.filter(matchesView)
  const failedJobs = allFailed.filter(matchesView)
  const displayedTotal = scoredJobs.length + failedJobs.length

  // How many of the just-added batch have finished scoring (scored or failed).
  const batchScoredCount = batchFilterId ? jobs.filter(j => j.batchId === batchFilterId).length : 0

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border bg-background flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-[15px] font-semibold text-foreground flex items-center gap-2">
            <Workflow className="w-4 h-4 text-primary" />
            Scorecard Review
          </h1>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {loading ? 'Loading…' : `${displayedTotal} job${displayedTotal !== 1 ? 's' : ''}`}
            {streamConnected && <span className="ml-2 text-emerald-500">● live</span>}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <CandidateSwitcher candidateId={candidateId} />
          <SourceFilterControl value={sourceFilter} onChange={setSourceFilter} counts={sourceCounts} />
          <GradeFilterDropdown
            selected={selectedGrades}
            onChange={handleGradesChange}
            counts={counts}
          />
          <PipelineSortControl value={sort} onChange={handleSortChange} />
        </div>
      </div>

      {/* Job list */}
      <div className="flex-1 overflow-y-auto p-6">
        {/* Batch banner — shown when arriving right after an "Add Jobs" import */}
        {batchFilterId && (
          <div className="max-w-3xl mb-4 rounded-xl border border-blue-800/40 bg-blue-950/20 px-4 py-3 flex items-center gap-3">
            {batchComplete ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
              <div className="w-4 h-4 rounded-full border-2 border-blue-400 border-t-transparent animate-spin shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-[12px] font-medium text-foreground">
                {batchComplete
                  ? `${batchCount || batchScoredCount} job${(batchCount || batchScoredCount) !== 1 ? 's' : ''} you added · scoring complete`
                  : `Scoring the ${batchCount || ''} job${batchCount !== 1 ? 's' : ''} you just added…`}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {batchScoredCount} scored so far{batchComplete ? '' : ' · this view updates automatically'}
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="text-[11px] border-border shrink-0"
              onClick={() => { setBatchFilterId(null); setBatchComplete(false) }}
            >
              Show all jobs
            </Button>
          </div>
        )}
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <Skeleton key={i} className="h-40 w-full rounded-xl bg-muted" />
            ))}
          </div>
        ) : scoredJobs.length === 0 && failedJobs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-20">
            {retryJobIds.length > 0 ? (
              <>
                <div className="w-8 h-8 rounded-full border-2 border-blue-500 border-t-transparent animate-spin mb-4" />
                <p className="text-[13px] text-muted-foreground mb-1 font-medium">
                  Scoring your jobs…
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Scored cards will appear here automatically. Progress is shown below.
                </p>
              </>
            ) : (
              <>
                <Workflow className="w-10 h-10 text-border mb-4" />
                <p className="text-[13px] text-muted-foreground mb-4">
                  No matching jobs — try a wider filter or run the pipeline
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-[11px] border-border text-muted-foreground hover:text-muted-foreground"
                  onClick={() => router.push(`/candidates/${candidateId}/dashboard`)}
                >
                  Search for New Jobs →
                </Button>
              </>
            )}
          </div>
        ) : (
          <div className="space-y-3 max-w-3xl">
            {scoredJobs.map(job => (
              <JobReviewCard
                key={job.id}
                job={job}
                candidateId={candidateId}
                onApprove={handleApprove}
                onReject={handleReject}
                onSnooze={handleSnooze}
                onUnsnooze={handleUnsnooze}
                onGenerateResume={handleGenerateResume}
                isPending={pendingJobIds.has(job.id)}
                isPendingOutreach={pendingOutreachIds.has(job.id)}
                onUpdate={() => loadJobs(selectedGrades, sort)}
              />
            ))}
          </div>
        )}

        {failedJobs.length > 0 && (
          <ScoreFailedSection
            jobs={failedJobs}
            candidateId={candidateId}
            onRetried={(pjId) => {
              setRetryJobIds(prev => [...prev, pjId])
              loadJobs(selectedGrades, sort)
            }}
          />
        )}

        {/* Live log pane for resume_builder runs queued from this page's
            Approve clicks. Hidden until the first approval; stays visible for
            the rest of the session so the user can watch each tailored
            resume build in sequence. */}
        {(resumeBuilderJobIds.length > 0 || retryJobIds.length > 0) && (
          <div ref={logPaneRef} className="max-w-3xl mt-6">
            <PipelineLogPane chainJobIds={[...resumeBuilderJobIds, ...retryJobIds]} />
          </div>
        )}
      </div>

      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onDismiss={() => setToast(null)}
        />
      )}
    </div>
  )
}
