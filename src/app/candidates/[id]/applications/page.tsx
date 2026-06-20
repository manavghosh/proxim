'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { getJobs, markSubmitted, rejectJob, archiveJob, getResumeVersions, triggerResumeGeneration, getPreferences, startJobStream, markInterview, retryPipelineStage } from '@/lib/api'
import type { ScoredJob, ResumeVersion } from '@/lib/api'
import { ArchiveAgedControl } from '@/components/jobs/ArchiveAgedControl'
import type { EmailOutreachMode, OutreachStatus, EmailCadenceStatus } from '@/types/candidate'
import { Topbar } from '@/components/layout/Topbar'
import { CandidateSwitcher } from '@/components/layout/CandidateSwitcher'
import { JobCard } from '@/components/applications/JobCard'
import { GradeFilterDropdown, ALL_GRADES } from '@/components/applications/GradeFilterDropdown'
import type { Grade } from '@/components/applications/GradeFilterDropdown'
import { ExportResumePanel } from '@/components/applications/ExportResumePanel'
import { PdfPreviewSheet } from '@/components/applications/PdfPreviewSheet'
import { X } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert } from '@/components/ui/alert'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AnalyticsPanel } from '@/components/applications/AnalyticsPanel'
import { RunHistoryTable } from '@/components/applications/RunHistoryTable'
import { getRunHistory, exportRunHistory } from '@/lib/api'
import type { PipelineRunSummary, TimeRange } from '@/types/candidate'

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
  const [emailResumeAttachment, setEmailResumeAttachment] = useState<'tailored' | 'original'>('tailored')
  const [livePolling, setLivePolling]       = useState(false)
  const [analyticsRange, setAnalyticsRange] = useState<TimeRange>('30d')
  const [analyticsRefresh, setAnalyticsRefresh] = useState(0)

  // History tab state
  const [historyPage, setHistoryPage] = useState(1)
  const [historyRuns, setHistoryRuns] = useState<PipelineRunSummary[]>([])
  const [historyInProgress, setHistoryInProgress] = useState<PipelineRunSummary[]>([])
  const [historyTotal, setHistoryTotal] = useState(0)
  const [historyTotalPages, setHistoryTotalPages] = useState(1)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [activeTab, setActiveTab]           = useState<'jobs' | 'analytics' | 'history'>('jobs')

  const loadHistory = useCallback(async (page: number, range: TimeRange) => {
    setHistoryLoading(true)
    try {
      const result = await getRunHistory(candidateId, page, range)
      setHistoryRuns(result.runs)
      setHistoryInProgress(result.inProgress)
      setHistoryTotal(result.total)
      setHistoryTotalPages(result.totalPages)
    } catch { /* ignore */ }
    finally { setHistoryLoading(false) }
  }, [candidateId])

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
      setEmailResumeAttachment(prefsResult.preferences.email_resume_attachment ?? 'tailored')
    } catch {
      setError('Failed to load jobs. Please refresh.')
    } finally {
      setLoading(false)
    }
  }, [candidateId])

  // Silent refresh — no loading spinner, just updates job data in place
  const silentRefresh = useCallback(async (grades: Grade[]) => {
    try {
      const jobsResult = await getJobs(candidateId, grades.length > 0 ? grades : [...ALL_GRADES])
      setJobs(jobsResult.jobs)
    } catch { /* ignore silent refresh errors */ }
  }, [candidateId])

  useEffect(() => { loadJobs(selectedGrades) }, [selectedGrades, loadJobs])

  // Auto-poll every 5 s while any approved job has pending outreach/email data
  useEffect(() => {
    const OUTREACH_TRANSIENT = new Set<OutreachStatus>(['pending', 'discovering', 'enriching', 'generating'])
    const EMAIL_TRANSIENT    = new Set<EmailCadenceStatus>(['pending_discovery', 'discovering', 'generating', 'email_not_found'])

    const needsPolling = jobs.some(j => {
      if (!['approved', 'resume_ready', 'submitted'].includes(j.status)) return false
      const outreachLive = !j.outreachTarget || OUTREACH_TRANSIENT.has(j.outreachTarget.status as OutreachStatus)
      const emailLive    = !j.emailCadence   || EMAIL_TRANSIENT.has(j.emailCadence.status as EmailCadenceStatus)
      return outreachLive || emailLive
    })

    setLivePolling(needsPolling)
    if (!needsPolling || loading) return

    const interval = setInterval(() => silentRefresh(selectedGrades), 5000)
    return () => clearInterval(interval)
  }, [jobs, loading, selectedGrades, silentRefresh])

  // SSE stream subscription — fires immediately when daemon writes any change.
  // F7: also handles run_status_changed to trigger silent refresh.
  useEffect(() => {
    const cleanup = startJobStream(
      candidateId,
      () => { void silentRefresh(selectedGrades) },
      () => { /* idle/disconnect — transient polling covers reconnect lag */ },
      () => {                                         // run_status_changed → refresh jobs + analytics
        void silentRefresh(selectedGrades)
        setAnalyticsRefresh(n => n + 1)
      }
    )
    return cleanup
  }, [candidateId, selectedGrades, silentRefresh])

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

  const handleArchive = async (jobId: string) => {
    setPendingId(jobId)
    setError(null)
    try {
      await archiveJob(jobId, candidateId)
      setJobs((prev) => prev.filter((j) => j.id !== jobId))
    } catch {
      setError('Failed to archive job. Please try again.')
    } finally {
      setPendingId(null)
    }
  }

  const handleGenerateResume = async (jobId: string) => {
    setPendingId(jobId)
    setError(null)
    try {
      setJobs((prev) => prev.map((j) => j.id === jobId ? { ...j, status: 'approved' } : j))
      await triggerResumeGeneration(jobId, candidateId)
    } catch {
      setError('Failed to queue resume generation. Please try again.')
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

  const handleBuildComplete = (_jobId: string) => {
    // Refresh the jobs list so "Resume ready" / "View Resume" appear without a manual page reload.
    loadJobs(selectedGrades)
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

  // F7: retry failed pipeline stage
  const handleRetry = async (jobId: string) => {
    setPendingId(jobId)
    setError(null)
    try {
      await retryPipelineStage(jobId, candidateId)
    } catch {
      setError('Failed to retry pipeline stage. Please try again.')
    } finally {
      setPendingId(null)
    }
  }

  // F7: mark / unmark interview callback
  const handleMarkInterview = async (jobId: string, mark: boolean) => {
    setError(null)
    try {
      const result = await markInterview(jobId, candidateId, mark)
      setJobs(prev => prev.map(j =>
        j.id === jobId ? { ...j, interviewCallbackAt: result.interviewCallbackAt } : j
      ))
    } catch {
      setError('Failed to update interview callback. Please try again.')
    }
  }

  const counts = ALL_GRADES.reduce((acc, g) => {
    acc[g] = jobs.filter((j) => j.grade === g).length
    return acc
  }, {} as Partial<Record<Grade, number>>)

  const emptyMessage = selectedGrades.length === 0
    ? 'Select at least one grade to see evaluated roles.'
    : `No ${selectedGrades.join(', ')}-grade roles found yet — start the AI Agent to discover and evaluate opportunities.`

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <Topbar
        title="Applications"
        actions={
          <div className="flex items-center gap-3">
            {livePolling && (
              <span className="flex items-center gap-1.5 text-[10px] text-emerald-400">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Live
              </span>
            )}
            <CandidateSwitcher candidateId={candidateId} />
          </div>
        }
      />
      <main className="flex-1 min-h-0 overflow-hidden bg-background">
        <Tabs
          defaultValue="jobs"
          className="flex flex-col h-full"
          onValueChange={(v) => {
            setActiveTab(v as 'jobs' | 'analytics' | 'history')
            if (v === 'history') void loadHistory(historyPage, analyticsRange)
          }}
        >
          <div className="px-6 py-3 border-b border-border-strong flex items-center justify-between gap-4">
            <TabsList className="bg-card border border-border-strong">
              <TabsTrigger value="jobs" className="data-[state=active]:bg-border-strong data-[state=active]:text-white text-muted-foreground">
                Jobs
              </TabsTrigger>
              <TabsTrigger value="analytics" className="data-[state=active]:bg-border-strong data-[state=active]:text-white text-muted-foreground">
                Analytics
              </TabsTrigger>
              <TabsTrigger value="history" className="data-[state=active]:bg-border-strong data-[state=active]:text-white text-muted-foreground">
                History
              </TabsTrigger>
            </TabsList>
            {activeTab === 'jobs' && (
              <div className="flex items-center gap-3">
                <GradeFilterDropdown selected={selectedGrades} onChange={setSelectedGrades} counts={counts} />
                <ArchiveAgedControl
                  candidateId={candidateId}
                  onArchived={() => loadJobs(selectedGrades)}
                  onError={(msg) => setError(msg)}
                />
              </div>
            )}
          </div>

          {/* ── Jobs Tab ─────────────────────────────────────────────────────── */}
          <TabsContent value="jobs" className="flex-1 overflow-x-hidden overflow-y-auto p-6 mt-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {error && (
              <Alert className="mb-4 px-4 py-3 bg-destructive/15 border-destructive/40 text-[12px] text-destructive flex items-center justify-between gap-3">
                <span>{error}</span>
                <button
                  onClick={() => setError(null)}
                  aria-label="Dismiss"
                  className="shrink-0 text-destructive hover:text-foreground transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </Alert>
            )}
            {loading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-[140px] rounded-xl bg-card" />)}
              </div>
            ) : jobs.length === 0 ? (
              <div className="text-center py-20">
                <p className="text-muted-foreground text-sm">{emptyMessage}</p>
              </div>
            ) : (
              // Two independent flex columns so collapsed cards don't inherit
              // the row-height of an expanded neighbour (CSS grid limitation).
              <div className="hidden md:flex gap-4">
                {[0, 1].map((col) => (
                  <div key={col} className="flex-1 min-w-0 flex flex-col gap-4">
                    {jobs.filter((_, i) => i % 2 === col).map((job) => (
                      <JobCard
                        key={job.id}
                        job={job}
                        candidateId={candidateId}
                        emailOutreachMode={emailOutreachMode}
                        emailResumeAttachment={emailResumeAttachment}
                        onMarkSubmitted={handleMarkSubmitted}
                        onMoveToRejected={handleMoveToRejected}
                        onArchive={handleArchive}
                        onGenerateResume={handleGenerateResume}
                        onRetryResume={handleRetryResume}
                        onBuildComplete={handleBuildComplete}
                        onViewResume={handleViewResume}
                        onViewCoverLetter={handleViewCoverLetter}
                        onRetry={handleRetry}
                        onMarkInterview={handleMarkInterview}
                        isPending={pendingId === job.id}
                      />
                    ))}
                  </div>
                ))}
              </div>
            )}
            {/* Single column on mobile */}
            {!loading && jobs.length > 0 && (
              <div className="flex md:hidden flex-col gap-4">
                {jobs.map((job) => (
                  <JobCard
                    key={job.id}
                    job={job}
                    candidateId={candidateId}
                    emailOutreachMode={emailOutreachMode}
                    emailResumeAttachment={emailResumeAttachment}
                    onMarkSubmitted={handleMarkSubmitted}
                    onMoveToRejected={handleMoveToRejected}
                    onArchive={handleArchive}
                    onGenerateResume={handleGenerateResume}
                    onRetryResume={handleRetryResume}
                    onBuildComplete={handleBuildComplete}
                    onViewResume={handleViewResume}
                    onViewCoverLetter={handleViewCoverLetter}
                    onRetry={handleRetry}
                    onMarkInterview={handleMarkInterview}
                    isPending={pendingId === job.id}
                  />
                ))}
              </div>
            )}
          </TabsContent>

          {/* ── Analytics Tab ────────────────────────────────────────────────── */}
          <TabsContent value="analytics" className="flex-1 overflow-x-hidden overflow-y-auto p-6 mt-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <AnalyticsPanel
              candidateId={candidateId}
              range={analyticsRange}
              onRangeChange={setAnalyticsRange}
              refreshTrigger={analyticsRefresh}
            />
          </TabsContent>

          {/* ── History Tab ──────────────────────────────────────────────────── */}
          <TabsContent
            value="history"
            className="flex-1 overflow-x-hidden overflow-y-auto p-6 mt-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            <RunHistoryTable
              runs={historyRuns}
              inProgress={historyInProgress}
              total={historyTotal}
              page={historyPage}
              totalPages={historyTotalPages}
              loading={historyLoading}
              onPageChange={(p) => {
                setHistoryPage(p)
                void loadHistory(p, analyticsRange)
              }}
              onExport={() => void exportRunHistory(candidateId, analyticsRange)}
            />
          </TabsContent>
        </Tabs>
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
