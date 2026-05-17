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
import { PipelineLogPane } from '@/components/dashboard/PipelineLogPane'
import {
  getCandidateJobs,
  approveJob,
  rejectJob,
  snoozeJob,
  unsnoozeJob,
  startJobStream,
  updatePreferences,
  getPreferences,
  type HitlJob,
} from '@/lib/api'
import { Workflow } from 'lucide-react'
import { ImportJobsSheet } from '@/components/pipeline/ImportJobsSheet'

// Pipeline review never includes F-grade jobs (route enforces it), so the
// available choices are A/B/C/D only.
const PIPELINE_GRADES: Grade[] = ALL_GRADES.filter((g) => g !== 'F')
type SortOption = 'score' | 'date' | 'company'

function Toast({ message, type = 'info', onDismiss }: { message: string; type?: 'info' | 'success' | 'error'; onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 4000)
    return () => clearTimeout(t)
  }, [onDismiss])

  const bg = type === 'success' ? 'bg-emerald-900 border-emerald-700' : type === 'error' ? 'bg-red-900 border-red-700' : 'bg-[#0d1f3c] border-[#1d4ed8]'
  return (
    <div className={`fixed bottom-4 right-4 z-50 px-4 py-3 rounded-lg border text-[12px] text-white shadow-lg ${bg}`}>
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
      const res = await approveJob(jobId, candidateId)
      setJobs(prev => prev.map(j => j.id === jobId ? { ...j, status: 'approved' } : j))
      // Push the returned pipelineJobId so the log pane below streams the
      // resume_builder graph for this approval. The pane keeps the most
      // recent build active and auto-scrolls.
      if (res.pipelineJobId) {
        setResumeBuilderJobIds((prev) => [...prev, res.pipelineJobId])
        // Scroll to the log pane immediately — don't wait for the first log entry.
        setTimeout(() => {
          if (typeof logPaneRef.current?.scrollIntoView === 'function') {
            logPaneRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
          }
        }, 100)
      }
      showToast('Job approved — resume generation queued', 'success')
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

  // Per-grade counts feed the dropdown's count column and the inline badges,
  // matching the Applications page exactly.
  const counts = PIPELINE_GRADES.reduce((acc, g) => {
    acc[g] = jobs.filter((j) => j.grade === g).length
    return acc
  }, {} as Partial<Record<Grade, number>>)

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-[#1e2d4a] bg-[#060d1f] flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-[15px] font-semibold text-[#f1f5f9] flex items-center gap-2">
            <Workflow className="w-4 h-4 text-[#93c5fd]" />
            Pipeline Review
          </h1>
          <p className="text-[11px] text-[#475569] mt-0.5">
            {loading ? 'Loading…' : `${jobs.length} job${jobs.length !== 1 ? 's' : ''}`}
            {streamConnected && <span className="ml-2 text-emerald-500">● live</span>}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <CandidateSwitcher candidateId={candidateId} />
          <ImportJobsSheet candidateId={candidateId} onImported={() => loadJobs(selectedGrades, sort)} />
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
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <Skeleton key={i} className="h-40 w-full rounded-xl bg-[#0d1829]" />
            ))}
          </div>
        ) : jobs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-20">
            <Workflow className="w-10 h-10 text-[#1e2d4a] mb-4" />
            <p className="text-[13px] text-[#64748b] mb-4">
              No matching jobs — try a wider filter or run the pipeline
            </p>
            <Button
              size="sm"
              variant="outline"
              className="text-[11px] border-[#1e2d4a] text-[#64748b] hover:text-[#94a3b8]"
              onClick={() => router.push(`/candidates/${candidateId}/dashboard`)}
            >
              Run Pipeline →
            </Button>
          </div>
        ) : (
          <div className="space-y-3 max-w-3xl">
            {jobs.map(job => (
              <JobReviewCard
                key={job.id}
                job={job}
                candidateId={candidateId}
                onApprove={handleApprove}
                onReject={handleReject}
                onSnooze={handleSnooze}
                onUnsnooze={handleUnsnooze}
                isPending={pendingJobIds.has(job.id)}
              />
            ))}
          </div>
        )}

        {/* Live log pane for resume_builder runs queued from this page's
            Approve clicks. Hidden until the first approval; stays visible for
            the rest of the session so the user can watch each tailored
            resume build in sequence. */}
        {resumeBuilderJobIds.length > 0 && (
          <div ref={logPaneRef} className="max-w-3xl mt-6">
            <PipelineLogPane chainJobIds={resumeBuilderJobIds} />
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
