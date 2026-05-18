'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { getJobs, markSubmitted, rejectJob, getResumeVersions, triggerResumeGeneration, getPreferences } from '@/lib/api'
import type { ScoredJob, ResumeVersion } from '@/lib/api'
import type { EmailOutreachMode } from '@/types/candidate'
import { Topbar } from '@/components/layout/Topbar'
import { CandidateSwitcher } from '@/components/layout/CandidateSwitcher'
import { JobCard } from '@/components/applications/JobCard'
import { GradeFilterDropdown, ALL_GRADES } from '@/components/applications/GradeFilterDropdown'
import type { Grade } from '@/components/applications/GradeFilterDropdown'
import { ExportResumePanel } from '@/components/applications/ExportResumePanel'
import { PdfPreviewSheet } from '@/components/applications/PdfPreviewSheet'
import { Skeleton } from '@/components/ui/skeleton'

export default function ApplicationsPage() {
  const { id: candidateId } = useParams<{ id: string }>()

  const [jobs, setJobs]                     = useState<ScoredJob[]>([])
  const [loading, setLoading]               = useState(true)
  const [selectedGrades, setSelectedGrades] = useState<Grade[]>([...ALL_GRADES])
  const [pendingId, setPendingId]               = useState<string | null>(null)
  // PDF preview sheet state — which job + which type is currently previewing
  const [pdfPreview, setPdfPreview]             = useState<{ jobId: string; type: 'resume' | 'cover-letter' } | null>(null)
  // Legacy ExportResumePanel (version management, generate new) — kept for the overflow flow
  const [resumeJobId, setResumeJobId]           = useState<string | null>(null)
  const [resumeVersions, setResumeVersions] = useState<ResumeVersion[]>([])
  const [resumeCvHash, setResumeCvHash]     = useState<string | null>(null)
  const [error, setError]                   = useState<string | null>(null)
  const [emailOutreachMode, setEmailOutreachMode] = useState<EmailOutreachMode>('manual')

  const loadJobs = useCallback(async (grades: Grade[]) => {
    setLoading(true)
    setError(null)
    try {
      const [jobsResult, prefsResult] = await Promise.all([
        getJobs(candidateId, grades.length > 0 ? grades : [...ALL_GRADES]),
        getPreferences(candidateId),
      ])
      setJobs(jobsResult.jobs)
      setEmailOutreachMode(prefsResult.preferences.email_outreach_mode ?? 'manual')
    } catch {
      setError('Failed to load jobs. Please refresh.')
    } finally {
      setLoading(false)
    }
  }, [candidateId])

  useEffect(() => { loadJobs(selectedGrades) }, [selectedGrades, loadJobs])

  const handleMarkSubmitted = async (jobId: string) => {
    setPendingId(jobId)
    setError(null)
    try {
      await markSubmitted(jobId)
      setJobs((prev) => prev.map((j) => j.id === jobId ? { ...j, status: 'submitted' } : j))
    } catch (e) {
      setError(e instanceof Error && e.message.startsWith('422')
        ? 'Job is not in resume_ready state — refresh and try again.'
        : 'Failed to mark as submitted. Please try again.')
    } finally {
      setPendingId(null)
    }
  }

  const handleMoveToRejected = async (jobId: string) => {
    setPendingId(jobId)
    setError(null)
    try {
      // Reuses the HITL reject endpoint — writes a checkpoint + status='rejected'.
      await rejectJob(jobId, candidateId)
      setJobs((prev) => prev.map((j) => j.id === jobId ? { ...j, status: 'rejected' } : j))
    } catch {
      setError('Failed to move to rejected. Please try again.')
    } finally {
      setPendingId(null)
    }
  }

  const handleRetryResume = async (jobId: string) => {
    setPendingId(jobId)
    setError(null)
    try {
      // /api/jobs/{id}/resume re-enqueues a resume_builder pipeline_job. The
      // existing endpoint requires status='approved'; resume_failed jobs get
      // flipped back to 'approved' first so the route accepts them.
      setJobs((prev) => prev.map((j) => j.id === jobId ? { ...j, status: 'approved' } : j))
      await triggerResumeGeneration(jobId, candidateId)
    } catch {
      setError('Failed to re-trigger resume build. Please try again.')
      setJobs((prev) => prev.map((j) => j.id === jobId ? { ...j, status: 'resume_failed' } : j))
    } finally {
      setPendingId(null)
    }
  }

  const handleViewResume = (jobId: string) => {
    setPdfPreview({ jobId, type: 'resume' })
  }

  const handleViewCoverLetter = (jobId: string) => {
    setPdfPreview({ jobId, type: 'cover-letter' })
  }

  // Legacy: open the full version-management panel (version history, generate new).
  const handleManageVersions = async (jobId: string) => {
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
      <Topbar title="Applications" actions={<CandidateSwitcher candidateId={candidateId} />} />
      <main className="flex-1 overflow-y-auto p-6 bg-[#0d1829]">
        {error && (
          <div className="mb-4 px-4 py-3 bg-[#450a0a] border border-[#7f1d1d] rounded-lg text-[12px] text-[#fca5a5] flex items-center justify-between gap-3">
            <span>{error}</span>
            <button
              onClick={() => setError(null)}
              aria-label="Dismiss"
              className="shrink-0 text-[#fca5a5] hover:text-white transition-colors"
            >
              ✕
            </button>
          </div>
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
                emailOutreachMode={emailOutreachMode}
                onMarkSubmitted={handleMarkSubmitted}
                onMoveToRejected={handleMoveToRejected}
                onRetryResume={handleRetryResume}
                onViewResume={handleViewResume}
                onViewCoverLetter={handleViewCoverLetter}
                isPending={pendingId === job.id}
              />
            ))}
          </div>
        )}
      </main>
      {/* Inline PDF preview — one sheet per type, swapped on each open */}
      <PdfPreviewSheet
        open={!!pdfPreview}
        jobId={pdfPreview?.jobId ?? ''}
        type={pdfPreview?.type ?? 'resume'}
        onOpenChange={(open) => { if (!open) setPdfPreview(null) }}
      />

      {/* Legacy version-management panel — available for future "Manage Versions" flow */}
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
