'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { getJobs, submitDecision, getResumeVersions } from '@/lib/api'
import type { ScoredJob, ResumeVersion } from '@/lib/api'
import { Topbar } from '@/components/layout/Topbar'
import { JobCard } from '@/components/applications/JobCard'
import { GradeFilterDropdown, ALL_GRADES } from '@/components/applications/GradeFilterDropdown'
import type { Grade } from '@/components/applications/GradeFilterDropdown'
import { ReportDrawer } from '@/components/applications/ReportDrawer'
import { ExportResumePanel } from '@/components/applications/ExportResumePanel'
import { Skeleton } from '@/components/ui/skeleton'

export default function ApplicationsPage() {
  const { id: candidateId } = useParams<{ id: string }>()

  const [jobs, setJobs]                     = useState<ScoredJob[]>([])
  const [loading, setLoading]               = useState(true)
  const [selectedGrades, setSelectedGrades] = useState<Grade[]>([...ALL_GRADES])
  const [pendingId, setPendingId]           = useState<string | null>(null)
  const [reportJobId, setReportJobId]       = useState<string | null>(null)
  const [resumeJobId, setResumeJobId]       = useState<string | null>(null)
  const [resumeVersions, setResumeVersions] = useState<ResumeVersion[]>([])
  const [resumeCvHash, setResumeCvHash]     = useState<string | null>(null)
  const [error, setError]                   = useState<string | null>(null)

  const loadJobs = useCallback(async (grades: Grade[]) => {
    setLoading(true)
    setError(null)
    try {
      const r = await getJobs(candidateId, grades.length > 0 ? grades : [...ALL_GRADES])
      setJobs(r.jobs)
    } catch {
      setError('Failed to load jobs. Please refresh.')
    } finally {
      setLoading(false)
    }
  }, [candidateId])

  useEffect(() => { loadJobs(selectedGrades) }, [selectedGrades, loadJobs])

  const handleDecision = async (jobId: string, decision: 'approved' | 'rejected' | 'snoozed' | 'scored') => {
    setPendingId(jobId)
    try {
      await submitDecision(jobId, decision)
      setJobs((prev) => prev.map((j) => j.id === jobId ? { ...j, status: decision } : j))
    } catch {
      setError('Failed to save decision. Please try again.')
    } finally {
      setPendingId(null)
    }
  }

  const handleViewResume = async (jobId: string) => {
    setResumeJobId(jobId)
    try {
      const { versions, currentCvHash } = await getResumeVersions(jobId, candidateId)
      setResumeVersions(versions)
      setResumeCvHash(currentCvHash)
    } catch {
      setResumeVersions([])
      setResumeCvHash(null)
    }
  }

  const counts = ALL_GRADES.reduce((acc, g) => {
    acc[g] = jobs.filter((j) => j.grade === g).length
    return acc
  }, {} as Partial<Record<Grade, number>>)

  const emptyMessage = selectedGrades.length === 0
    ? 'Select at least one grade to see jobs.'
    : `No ${selectedGrades.join(', ')} grade jobs found — run the pipeline to discover and score matches.`

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <Topbar title="Applications" />
      <main className="flex-1 overflow-y-auto p-6 bg-[#0d1829]">
        {error && (
          <div className="mb-4 px-4 py-3 bg-[#450a0a] border border-[#7f1d1d] rounded-lg text-[12px] text-[#fca5a5]">{error}</div>
        )}
        <div className="mb-5">
          <GradeFilterDropdown selected={selectedGrades} onChange={setSelectedGrades} counts={counts} />
        </div>
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-[140px] rounded-xl bg-[#0d1f3c]" />)}
          </div>
        ) : jobs.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-[#475569] text-sm">{emptyMessage}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {jobs.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                candidateId={candidateId}
                onDecision={handleDecision}
                onViewReport={setReportJobId}
                onViewResume={handleViewResume}
                isPending={pendingId === job.id}
              />
            ))}
          </div>
        )}
      </main>
      <ReportDrawer jobId={reportJobId} onClose={() => setReportJobId(null)} />
      {resumeJobId && (
        <ExportResumePanel
          jobId={resumeJobId}
          candidateId={candidateId}
          versions={resumeVersions}
          currentCvHash={resumeCvHash}
          onClose={() => setResumeJobId(null)}
          onRegenerate={() => loadJobs(selectedGrades)}
        />
      )}
    </div>
  )
}
