'use client'

import { useEffect, useState, useCallback } from 'react'
import { getJobs, submitDecision, getPreferences, updatePreferences } from '@/lib/api'
import type { ScoredJob } from '@/lib/api'
import { Topbar } from '@/components/layout/Topbar'
import { JobCard } from '@/components/applications/JobCard'
import { GradeFilter } from '@/components/applications/GradeFilter'
import { ReportDrawer } from '@/components/applications/ReportDrawer'
import { Skeleton } from '@/components/ui/skeleton'

type GradeFilterVal = 'A' | 'A+B' | 'all'

export default function ApplicationsPage() {
  const [jobs, setJobs]               = useState<ScoredJob[]>([])
  const [loading, setLoading]         = useState(true)
  const [gradeFilter, setGradeFilter] = useState<GradeFilterVal>('A+B')
  const [pendingId, setPendingId]     = useState<string | null>(null)
  const [reportJobId, setReportJobId] = useState<string | null>(null)
  const [error, setError]             = useState<string | null>(null)

  // Load saved grade filter preference on mount
  useEffect(() => {
    getPreferences()
      .then((r) => {
        const saved = r.preferences.grade_filter as GradeFilterVal | undefined
        if (saved) setGradeFilter(saved)
      })
      .catch(() => {})
  }, [])

  const loadJobs = useCallback(async (filter: GradeFilterVal) => {
    setLoading(true)
    setError(null)
    try {
      const r = await getJobs(filter)
      setJobs(r.jobs)
    } catch {
      setError('Failed to load jobs. Please refresh.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadJobs(gradeFilter) }, [gradeFilter, loadJobs])

  const handleFilterChange = (v: GradeFilterVal) => {
    setGradeFilter(v)
    updatePreferences({ grade_filter: v }).catch(() => {})
  }

  const handleDecision = async (
    jobId: string,
    decision: 'approved' | 'rejected' | 'snoozed'
  ) => {
    setPendingId(jobId)
    try {
      await submitDecision(jobId, decision)
      setJobs((prev) =>
        prev.map((j) => j.id === jobId ? { ...j, status: decision } : j)
      )
    } catch {
      setError('Failed to save decision. Please try again.')
    } finally {
      setPendingId(null)
    }
  }

  const counts = {
    A:     jobs.filter((j) => j.grade === 'A').length,
    B:     jobs.filter((j) => j.grade === 'B').length,
    total: jobs.length,
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <Topbar title="Applications" />
      <main className="flex-1 overflow-y-auto p-6 bg-[#0d1829]">
        {error && (
          <div className="mb-4 px-4 py-3 bg-[#450a0a] border border-[#7f1d1d] rounded-lg text-[12px] text-[#fca5a5]">
            {error}
          </div>
        )}

        <div className="mb-5">
          <GradeFilter value={gradeFilter} onChange={handleFilterChange} counts={counts} />
        </div>

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[...Array(6)].map((_, i) => (
              <Skeleton key={i} className="h-[140px] rounded-xl bg-[#0d1f3c]" />
            ))}
          </div>
        ) : jobs.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-[#475569] text-sm">
              {gradeFilter === 'all'
                ? 'No scored jobs yet — run the pipeline to discover and score matches.'
                : `No ${gradeFilter} grade jobs found. Try a wider filter or run the pipeline.`}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {jobs.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                onDecision={handleDecision}
                onViewReport={setReportJobId}
                isPending={pendingId === job.id}
              />
            ))}
          </div>
        )}
      </main>

      <ReportDrawer jobId={reportJobId} onClose={() => setReportJobId(null)} />
    </div>
  )
}
