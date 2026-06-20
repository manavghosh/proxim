'use client'

import { useState, useEffect } from 'react'
import { ExternalLink, FileTextIcon, MoreHorizontal, XCircle, CheckCheck, RotateCcw, Link2, MailIcon, ChevronDown, Sparkles, Star, Archive } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert } from '@/components/ui/alert'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import { GradeBadge } from '@/components/applications/GradeBadge'
import { JobStatusBadge } from '@/components/applications/JobStatusBadge'
import { GRADE_GLOW } from '@/lib/grade-colors'
import { LazyScoreReportPane } from '@/components/applications/LazyScoreReportPane'
import { BuildProgressPane } from '@/components/applications/BuildProgressPane'
import { EmailCadenceStatusBadge } from '@/components/pipeline/EmailCadenceStatusBadge'
import { EmailNotFoundPanel } from '@/components/pipeline/EmailNotFoundPanel'
import { EmailOutreachPanel } from '@/components/pipeline/EmailOutreachPanel'
import { OutreachNoteSelector } from '@/components/pipeline/OutreachNoteSelector'
import { OutreachStatusBadge } from '@/components/pipeline/OutreachStatusBadge'
import { TailoredResumeCard } from '@/components/applications/TailoredResumeCard'
import type { ScoredJob, EmailCadenceSummary, ResumeVersion } from '@/lib/api'
import { retryLinkedIn, startEmailOutreach, getEmailCadence, getResumeVersions } from '@/lib/api'
import type { OutreachTargetSummary, OutreachStatus, EmailOutreachMode, EmailCadenceStatus } from '@/types/candidate'

const LINKEDIN_TRANSIENT: OutreachStatus[] = ['pending', 'discovering', 'enriching', 'generating']
const EMAIL_TRANSIENT: EmailCadenceStatus[] = ['pending_discovery', 'discovering', 'generating']
// Extended set for polling: keep alive through email_not_found and low_confidence
// so the pending_approval transition (written by write_cadence_checkpoint_node) is caught.
const EMAIL_POLL_ACTIVE: EmailCadenceStatus[] = [...EMAIL_TRANSIENT, 'email_not_found', 'low_confidence']

interface Props {
  job: ScoredJob
  onMarkSubmitted: (jobId: string) => void
  onMoveToRejected: (jobId: string) => void
  onArchive: (jobId: string) => void
  onGenerateResume: (jobId: string) => void
  onRetryResume: (jobId: string) => void
  onBuildComplete?: (jobId: string) => void
  onViewResume?: (jobId: string) => void
  onViewCoverLetter?: (jobId: string) => void
  onRetry?: (jobId: string) => void
  onMarkInterview?: (jobId: string, mark: boolean) => void
  isPending: boolean
  candidateId: string
  emailOutreachMode?: EmailOutreachMode
  emailResumeAttachment?: 'tailored' | 'original'
}

function formatElapsed(updatedAt: string): string {
  const diffMs = Date.now() - new Date(updatedAt).getTime()
  const hours = Math.floor(diffMs / 3_600_000)
  const mins = Math.floor((diffMs % 3_600_000) / 60_000)
  if (hours > 0) return `${hours}h ${mins}m`
  if (mins > 0) return `${mins}m`
  return 'just now'
}

function getAgentBadge(pipelineJobStatus: string | null, status: string, errorMessage: string | null): {
  label: string
  agentName: string
  variant: 'running' | 'queued' | 'error' | 'done' | null
} | null {
  if (errorMessage || status === 'resume_failed') {
    const agentName = status === 'resume_failed' ? 'Resume Builder' : 'Pipeline'
    return { label: 'Error', agentName, variant: 'error' }
  }
  if (status === 'resume_ready' || status === 'submitted') {
    return { label: 'Complete', agentName: 'Resume Builder', variant: 'done' }
  }
  if (pipelineJobStatus === 'running') {
    return { label: 'Agent working', agentName: 'AI Agent', variant: 'running' }
  }
  if (pipelineJobStatus === 'queued' && status === 'approved') {
    return { label: 'In queue', agentName: 'AI Agent', variant: 'queued' }
  }
  return null
}

export function JobCard({
  job,
  onMarkSubmitted,
  onMoveToRejected,
  onArchive,
  onGenerateResume,
  onRetryResume,
  onBuildComplete,
  onViewResume,
  onViewCoverLetter,
  onRetry,
  onMarkInterview,
  isPending,
  candidateId,
  emailOutreachMode = 'manual',
  emailResumeAttachment = 'tailored',
}: Props) {
  const [emailCadence, setEmailCadence]     = useState<EmailCadenceSummary | null>(job.emailCadence)
  const [outreachStatus, setOutreachStatus] = useState<OutreachStatus | null>(
    job.outreachTarget?.status as OutreachStatus ?? null
  )
  const [liStarting,  setLiStarting]  = useState(false)
  const [emStarting,  setEmStarting]  = useState(false)
  const [localResumeFailed, setLocalResumeFailed] = useState(false)
  const [buildRunning, setBuildRunning] = useState(false)
  const [retryCount, setRetryCount] = useState(0)

  const [isOpen, setIsOpen] = useState(false)
  const [resumeVersion, setResumeVersion] = useState<ResumeVersion | null>(null)

  // Fetch resume version when card expands and resume exists (incl. rejected jobs — read-only)
  const hasResume = job.status === 'resume_ready' || job.status === 'submitted' || job.status === 'rejected'
  useEffect(() => {
    if (!isOpen || !hasResume) return
    let cancelled = false
    function fetchVersion() {
      getResumeVersions(job.id, candidateId).then(({ versions }) => {
        if (cancelled || versions.length === 0) return
        const best = versions.reduce((a, b) => (b.versionN > a.versionN ? b : a))
        setResumeVersion(best)
      }).catch(() => { /* ignore */ })
    }
    fetchVersion()
    // Poll every 3s while PDF path is still null (generation in progress)
    const interval = setInterval(() => {
      setResumeVersion(prev => {
        if (prev && prev.resumePdfPath) { clearInterval(interval); return prev }
        fetchVersion()
        return prev
      })
    }, 3000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [isOpen, hasResume, job.id, candidateId])

  // Sync emailCadence local state when the parent's silentRefresh delivers new
  // data from the backend. Only sync when prop carries a real (non-optimistic)
  // cadence row — optimistic inserts use id='' as a sentinel.
  useEffect(() => {
    if (job.emailCadence?.id && job.emailCadence.id !== '') {
      setEmailCadence(job.emailCadence)
    }
  }, [job.emailCadence?.id, job.emailCadence?.status])

  // Poll cadence status while the daemon is processing (e.g. after retry) so the
  // UI transitions to pending_approval without requiring a manual page refresh.
  useEffect(() => {
    const id = emailCadence?.id
    if (!id || id === '' || !EMAIL_POLL_ACTIVE.includes(emailCadence!.status)) return
    const interval = setInterval(async () => {
      try {
        const fresh = await getEmailCadence(id, candidateId)
        if (!EMAIL_POLL_ACTIVE.includes(fresh.status) || fresh.drafts.length > 0) {
          setEmailCadence(fresh)
        }
      } catch { /* ignore transient polling errors */ }
    }, 3000)
    return () => clearInterval(interval)
  }, [emailCadence?.id, emailCadence?.status, candidateId])

  // Sync outreach status when the parent's silentRefresh delivers an update
  // (e.g. generating → notes_ready after the LinkedIn agent finishes).
  useEffect(() => {
    if (job.outreachTarget?.status) {
      setOutreachStatus(job.outreachTarget.status as OutreachStatus)
    }
  }, [job.outreachTarget?.status])

  const score = (job.score10d as Record<string, unknown> | null)?.numeric_score as number | undefined
  const isSnoozed   = job.status === 'snoozed'
  const isApproved  = job.status === 'approved'
  const isRejected  = job.status === 'rejected'
  const isSubmitted = job.status === 'submitted'
  const isResumeReady   = job.status === 'resume_ready'
  const isResumeFailed  = job.status === 'resume_failed'
  const gradeGlow = job.grade ? GRADE_GLOW[job.grade] : undefined
  const agentBadge = getAgentBadge(job.pipelineJobStatus ?? null, job.status, job.errorMessage ?? null)
  const elapsedTime = job.updatedAt ? formatElapsed(job.updatedAt) : null
  const canMarkInterview = ['approved', 'resume_ready', 'submitted'].includes(job.status)
  const isInterviewMarked = !!job.interviewCallbackAt

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={setIsOpen}
      style={gradeGlow ? { boxShadow: gradeGlow } : undefined}
      className={`bg-background border rounded-xl overflow-hidden transition-all duration-200 ${
        isSnoozed || isRejected
          ? 'border-border opacity-60'
          : isOpen
            ? 'border-border-strong'
            : 'border-border hover:border-border-strong'
      }`}
    >
      {/* ── Collapsed trigger — always visible ───────────────────────────── */}
      <CollapsibleTrigger asChild>
        <button
          className="w-full text-left px-4 py-3 flex items-center gap-3 group focus:outline-none"
          aria-label={isOpen ? 'Collapse job card' : 'Expand job card'}
        >
          {/* Grade badge */}
          {job.grade ? (
            <GradeBadge grade={job.grade} variant="solid" />
          ) : (
            <div className="w-7 h-7 shrink-0" />
          )}

          {/* Title + company */}
          <div className="flex-1 min-w-0">
            <p className="text-foreground font-medium text-sm leading-snug break-words">{job.title}</p>
            <p className="text-muted-foreground text-xs mt-0.5 break-words">{job.company}</p>
          </div>

          {/* Right chips cluster */}
          <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
            {/* Status */}
            <JobStatusBadge status={job.status} />

            {/* Elapsed time */}
            {elapsedTime && (
              <span className="text-[10px] text-muted-foreground hidden sm:inline">{elapsedTime}</span>
            )}

            {/* Agent status badge */}
            {agentBadge?.variant === 'running' && (
              <Badge className="text-[10px] h-5 px-1.5 bg-blue-500/20 text-blue-300 border-blue-500/30 flex items-center gap-1">
                <span className="w-1 h-1 rounded-full bg-blue-400 animate-pulse" />
                Agent working
              </Badge>
            )}
            {agentBadge?.variant === 'queued' && (
              <Badge className="text-[10px] h-5 px-1.5 bg-amber-500/20 text-amber-300 border-amber-500/30">In queue</Badge>
            )}
            {agentBadge?.variant === 'error' && (
              <Badge className="text-[10px] h-5 px-1.5 bg-red-500/20 text-red-300 border-red-500/30 flex items-center gap-1">
                <span className="w-1 h-1 rounded-full bg-red-400" />
                Action needed
              </Badge>
            )}
            {agentBadge?.variant === 'done' && (
              <Badge className="text-[10px] h-5 px-1.5 bg-emerald-500/20 text-emerald-300 border-emerald-500/30">Complete</Badge>
            )}

            {/* Interview marker */}
            {isInterviewMarked && (
              <Badge className="text-[10px] h-5 px-1.5 bg-purple-500/20 text-purple-300 border-purple-500/30 inline-flex items-center gap-1"><Star className="w-2.5 h-2.5 fill-current" /> Interview</Badge>
            )}

            {/* Score */}
            {score !== undefined && (
              <span className="text-[10px] text-muted-foreground font-mono hidden md:inline">{score.toFixed(1)}</span>
            )}

            {/* External link — stop propagation so it doesn't toggle card */}
            <a
              href={job.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open job listing"
              className="text-muted-foreground hover:text-muted-foreground transition-colors p-0.5"
              onClick={(e) => e.stopPropagation()}
            >
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>

          {/* Chevron — rotates when open */}
          <ChevronDown
            className={`w-4 h-4 text-muted-foreground transition-transform duration-200 shrink-0 ${
              isOpen ? 'rotate-180' : 'group-hover:text-muted-foreground'
            }`}
          />
        </button>
      </CollapsibleTrigger>

      {/* ── Expanded content ─────────────────────────────────────────────── */}
      <CollapsibleContent className="overflow-hidden data-[state=closed]:hidden">
        <div className="border-t border-border px-4 pb-4 pt-3 flex flex-col gap-3">

            {/* Error card */}
            {agentBadge?.variant === 'error' && (
              <Alert className="bg-destructive/15 border-destructive/40 p-3 flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-[11px] font-semibold text-destructive">{agentBadge.agentName} failed</p>
                    {job.errorMessage && (
                      <p className="text-[10px] text-destructive mt-0.5 line-clamp-2">{job.errorMessage}</p>
                    )}
                    {elapsedTime && (
                      <p className="text-[10px] text-destructive mt-0.5">Failed {elapsedTime} ago</p>
                    )}
                  </div>
                  {onRetry && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-[10px] h-7 border-destructive/40 text-destructive hover:bg-destructive/40 shrink-0"
                      onClick={() => onRetry(job.id)}
                      disabled={isPending}
                    >
                      <RotateCcw className="w-3 h-3 mr-1" />
                      Retry
                    </Button>
                  )}
                </div>
              </Alert>
            )}

            {/* Location + archetype pills */}
            {(job.location || job.archetype) && (
              <div className="flex gap-2 flex-wrap">
                {job.location && (
                  <Badge variant="outline" className="text-[10px] text-muted-foreground border-border bg-muted">
                    {job.location}
                  </Badge>
                )}
                {job.archetype && (
                  <Badge variant="outline" className="text-[10px] text-muted-foreground border-border bg-muted">
                    {job.archetype}
                  </Badge>
                )}
              </div>
            )}

            {/* Score report */}
            <LazyScoreReportPane jobId={job.id} />

            {/* Action buttons */}
            <div className="flex items-center gap-2 pt-1 flex-wrap">
              {isApproved && !localResumeFailed && (
                <Button size="sm" variant="outline"
                  className="h-7 text-[11px] border-blue-700/40 text-blue-400 hover:bg-blue-950/30 gap-1"
                  onClick={() => onGenerateResume(job.id)}
                  disabled={isPending || buildRunning || !job.jdRaw}
                  title={!job.jdRaw ? 'Fetch JD first before tailoring' : undefined}
                  isLoading={buildRunning}>
                  {!buildRunning && <Sparkles className="w-3 h-3" />}
                  {buildRunning ? 'AI Agent writing…' : 'Tailor for This Role'}
                </Button>
              )}

              {(isResumeReady || isSubmitted || isRejected) && !resumeVersion && (
                <>
                  <Button size="sm" variant="outline"
                    className="h-7 text-[11px] gap-1 border-border text-primary"
                    onClick={() => onViewResume?.(job.id)}
                    disabled={isPending}>
                    <FileTextIcon className="w-3 h-3" />
                    View Resume
                  </Button>
                  <Button size="sm" variant="outline"
                    className="h-7 text-[11px] gap-1 border-border text-primary"
                    onClick={() => onViewCoverLetter?.(job.id)}
                    disabled={isPending}>
                    <FileTextIcon className="w-3 h-3" />
                    View Cover Letter
                  </Button>
                </>
              )}

              {(isResumeFailed || localResumeFailed) && (
                <Button size="sm" variant="outline"
                  className="h-7 text-[11px] border-red-700/40 text-red-400 hover:bg-red-950/30 gap-1"
                  onClick={() => {
                    setLocalResumeFailed(false)
                    setBuildRunning(false)
                    setRetryCount((c) => c + 1)
                    onRetryResume(job.id)
                  }}
                  disabled={isPending || buildRunning}
                  isLoading={isPending}>
                  <RotateCcw className="w-3 h-3" />
                  Retry Resume
                </Button>
              )}

              {isResumeReady && (
                <Button size="sm"
                  className="h-7 text-[11px] bg-emerald-600 hover:bg-emerald-700 text-white px-3 gap-1"
                  onClick={() => onMarkSubmitted(job.id)}
                  disabled={isPending}
                  isLoading={isPending}>
                  <CheckCheck className="w-3 h-3" /> Mark Submitted
                </Button>
              )}

              {/* Interview callback */}
              {canMarkInterview && onMarkInterview && (
                <Button
                  size="sm"
                  variant="outline"
                  className={`h-7 text-[11px] gap-1 ${
                    isInterviewMarked
                      ? 'border-purple-500/50 text-purple-300 bg-purple-900/20'
                      : 'border-border text-muted-foreground hover:text-muted-foreground'
                  }`}
                  onClick={() => onMarkInterview(job.id, !isInterviewMarked)}
                  disabled={isPending}
                  title={isInterviewMarked ? 'Unmark interview callback' : 'Mark as interview callback'}
                >
                  <Star className={`w-3 h-3 ${isInterviewMarked ? 'fill-current' : ''}`} /> Interview
                </Button>
              )}

              <div className="ml-auto flex gap-2 items-center">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant="ghost"
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-muted-foreground"
                      aria-label="More actions">
                      <MoreHorizontal className="w-3 h-3" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                    {!isRejected && (
                      <DropdownMenuItem
                        onClick={() => onMoveToRejected(job.id)}
                        className="text-red-400 focus:text-red-300">
                        <XCircle className="w-3 h-3 mr-2" />
                        Move to Rejected
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem
                      onClick={() => onArchive(job.id)}
                      data-testid="archive-menu-item">
                      <Archive className="w-3 h-3 mr-2" />
                      Archive
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            {/* Tailored resume card — shown when resume version data is available (read-only for rejected) */}
            {(isResumeReady || isSubmitted || isRejected) && resumeVersion && (
              <TailoredResumeCard
                version={resumeVersion}
                onViewResume={() => onViewResume?.(job.id)}
                onViewCoverLetter={() => onViewCoverLetter?.(job.id)}
              />
            )}

            {/* Build progress pane */}
            {(isApproved || isResumeReady || isSubmitted || isResumeFailed) && (
              <BuildProgressPane
                key={retryCount}
                jobId={job.id}
                autoOpen={isResumeFailed || localResumeFailed}
                onBuildFailed={() => setLocalResumeFailed(true)}
                onBuildComplete={() => onBuildComplete?.(job.id)}
                onRunningChange={setBuildRunning}
              />
            )}

            {/* LinkedIn Outreach */}
            {(isApproved || isResumeReady || isSubmitted) && (
              <div className="border-t border-border pt-3 mt-1">
                <div className="flex items-center gap-2">
                  <span className="text-[9px] font-semibold text-muted-foreground tracking-widest uppercase">
                    LinkedIn Outreach
                  </span>

                  {!job.outreachTarget && (
                    <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground animate-pulse">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                      AI Agent identifying hiring contact…
                    </span>
                  )}

                  {job.outreachTarget && LINKEDIN_TRANSIENT.includes(
                    (outreachStatus ?? job.outreachTarget.status) as OutreachStatus
                  ) && (
                    <>
                      <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground animate-pulse">
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                        {(outreachStatus ?? job.outreachTarget.status) === 'discovering'  && 'Identifying decision-maker…'}
                        {(outreachStatus ?? job.outreachTarget.status) === 'enriching'    && 'Researching their background…'}
                        {(outreachStatus ?? job.outreachTarget.status) === 'generating'   && 'Crafting personalised message…'}
                        {(outreachStatus ?? job.outreachTarget.status) === 'pending'      && 'AI Agent starting…'}
                      </span>
                      <Button size="sm" variant="outline"
                        className="h-6 text-[10px] border-border-strong text-primary hover:bg-card gap-1"
                        isLoading={liStarting}
                        onClick={async () => {
                          setLiStarting(true)
                          try {
                            await retryLinkedIn(job.id, candidateId)
                            setOutreachStatus('discovering')
                          } finally { setLiStarting(false) }
                        }}>
                        <RotateCcw className="w-3 h-3" />
                        Retry
                      </Button>
                    </>
                  )}

                  {job.outreachTarget && !LINKEDIN_TRANSIENT.includes(
                    (outreachStatus ?? job.outreachTarget.status) as OutreachStatus
                  ) && (
                    <OutreachStatusBadge status={(outreachStatus ?? job.outreachTarget.status) as OutreachStatus} />
                  )}
                </div>

                {job.outreachTarget?.name && (
                  <div className="flex flex-col gap-1 mt-1.5">
                    <div className="flex items-center gap-1.5">
                      <Link2 className="w-3 h-3 text-[#0A66C2] flex-shrink-0" />
                      {job.outreachTarget.linkedinUrl ? (
                        <a href={job.outreachTarget.linkedinUrl} target="_blank" rel="noopener noreferrer"
                          className="text-[10px] text-primary hover:underline truncate">
                          {job.outreachTarget.name}
                          {job.outreachTarget.title && <span className="text-muted-foreground"> · {job.outreachTarget.title}</span>}
                        </a>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">
                          {job.outreachTarget.name}
                          {job.outreachTarget.title && <span className="text-muted-foreground"> · {job.outreachTarget.title}</span>}
                        </span>
                      )}
                    </div>
                    <span className={`self-start inline-flex items-center gap-1 text-[9px] font-medium px-1.5 py-0.5 rounded-full border ${
                      job.outreachTarget.seniority === 'JOB_POSTER'
                        ? 'bg-emerald-950/50 text-emerald-400 border-emerald-800/40'
                        : 'bg-amber-950/50 text-amber-400 border-amber-800/40'
                    }`}>
                      {job.outreachTarget.seniority === 'JOB_POSTER'
                        ? <><FileTextIcon className="w-2.5 h-2.5" /> From JD</>
                        : <><Sparkles className="w-2.5 h-2.5" /> AI Match</>}
                    </span>
                  </div>
                )}

                {job.outreachTarget && (
                  (['notes_ready', 'no_contact_found', 'failed'] as OutreachStatus[]).includes(
                    (outreachStatus ?? job.outreachTarget.status) as OutreachStatus
                  ) || (!!job.outreachTarget.noteA && !!job.outreachTarget.noteB)
                ) && (
                  <div className="mt-2">
                    <OutreachNoteSelector
                      target={{ ...job.outreachTarget, status: (outreachStatus ?? job.outreachTarget.status) as OutreachStatus }}
                      candidateId={candidateId}
                      jobId={job.id}
                      onStatusChange={(s) => setOutreachStatus(s)}
                    />
                  </div>
                )}
              </div>
            )}

            {/* Email Outreach */}
            {(isApproved || isResumeReady || isSubmitted) && (
              <div className="border-t border-border pt-3 mt-1">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[9px] font-semibold text-muted-foreground tracking-widest uppercase">Email</span>

                  {!emailCadence && (
                    <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground animate-pulse">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                      AI Agent locating email address…
                    </span>
                  )}

                  {emailCadence && EMAIL_TRANSIENT.includes(emailCadence.status) && (
                    <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground animate-pulse">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                      {emailCadence.status === 'pending_discovery' && 'AI Agent starting…'}
                      {emailCadence.status === 'discovering'       && 'Running email discovery…'}
                      {emailCadence.status === 'generating'        && 'Writing 3-touch email sequence…'}
                    </span>
                  )}

                  {!emailCadence && (
                    <Button size="sm" variant="outline"
                      className="h-6 text-[10px] border-border-strong text-primary hover:bg-card gap-1 ml-1"
                      isLoading={emStarting}
                      onClick={async () => {
                        setEmStarting(true)
                        try {
                          await startEmailOutreach(job.id, candidateId)
                          setEmailCadence({ id: '', status: 'pending_discovery', hiringManagerEmail: null,
                            emailConfidence: null, approvedAt: null, replyDetectedAt: null, bounceDetectedAt: null, retryCount: 0, drafts: [] })
                        } catch (e) {
                          if (e instanceof Error && e.message.startsWith('409')) {
                            try {
                              const body = JSON.parse(e.message.replace(/^\d+:\s*/, ''))
                              if (body.currentStatus) {
                                setEmailCadence({ id: '', status: body.currentStatus as EmailCadenceStatus,
                                  hiringManagerEmail: null, emailConfidence: null, approvedAt: null,
                                  replyDetectedAt: null, bounceDetectedAt: null, retryCount: 0, drafts: [] })
                              }
                            } catch { /* ignore */ }
                          }
                        } finally { setEmStarting(false) }
                      }}>
                      Start
                    </Button>
                  )}

                  {emailCadence && (EMAIL_TRANSIENT.includes(emailCadence.status) || emailCadence.status === 'cancelled') && (
                    <Button size="sm" variant="outline"
                      className="h-6 text-[10px] border-border-strong text-primary hover:bg-card gap-1"
                      isLoading={emStarting}
                      onClick={async () => {
                        setEmStarting(true)
                        try {
                          await startEmailOutreach(job.id, candidateId)
                          setEmailCadence({ id: '', status: 'pending_discovery', hiringManagerEmail: null,
                            emailConfidence: null, approvedAt: null, replyDetectedAt: null, bounceDetectedAt: null, retryCount: 0, drafts: [] })
                        } catch (e) {
                          if (e instanceof Error && e.message.startsWith('409')) {
                            try {
                              const body = JSON.parse(e.message.replace(/^\d+:\s*/, ''))
                              if (body.currentStatus && emailCadence) {
                                setEmailCadence({ ...emailCadence, status: body.currentStatus as EmailCadenceStatus })
                              }
                            } catch { /* ignore */ }
                          } else if (e instanceof Error && e.message.startsWith('429')) {
                            if (emailCadence) setEmailCadence({ ...emailCadence, retryCount: 2 })
                          }
                        } finally { setEmStarting(false) }
                      }}>
                      <RotateCcw className="w-3 h-3" />
                      Retry
                    </Button>
                  )}

                  {emailCadence &&
                    !EMAIL_TRANSIENT.includes(emailCadence.status) &&
                    emailCadence.status !== 'email_not_found' &&
                    emailCadence.status !== 'low_confidence' && (
                    <EmailCadenceStatusBadge status={emailCadence.status} />
                  )}
                </div>

                {emailCadence && (
                  emailCadence.status === 'email_not_found' ||
                  emailCadence.status === 'low_confidence' ||
                  emailCadence.status === 'failed'
                ) && (
                  <EmailNotFoundPanel
                    jobId={job.id}
                    candidateId={candidateId}
                    cadence={emailCadence}
                    company={job.company ?? ''}
                    outreachTarget={job.outreachTarget ?? null}
                    onUpdate={async () => {
                      try {
                        const updated = await getEmailCadence(emailCadence.id, candidateId)
                        setEmailCadence(updated)
                      } catch { /* stale */ }
                    }}
                  />
                )}

                {emailCadence?.hiringManagerEmail && (
                  <div className="flex items-center gap-1.5 mb-2">
                    <MailIcon className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                    <span className="text-[10px] text-muted-foreground font-mono truncate">
                      {emailCadence.hiringManagerEmail}
                    </span>
                  </div>
                )}

                {emailCadence && (
                  emailCadence.status === 'pending_approval' ||
                  emailCadence.status === 'generating' ||
                  emailCadence.status === 'active' ||
                  emailCadence.status === 'replied' ||
                  emailCadence.status === 'bounced' ||
                  emailCadence.status === 'auth_expired' ||
                  emailCadence.status === 'attachment_missing' ||
                  // Always surface drafts when they exist, even if email not yet confirmed
                  ((emailCadence.status === 'email_not_found' || emailCadence.status === 'low_confidence') && emailCadence.drafts.length > 0)
                ) && (
                  <EmailOutreachPanel
                    cadence={emailCadence}
                    candidateId={candidateId}
                    jobId={job.id}
                    mode={emailOutreachMode}
                    attachmentMode={emailResumeAttachment}
                    suggestedEmail={job.outreachTarget?.email ?? null}
                    suggestedEmailConfidence={job.outreachTarget?.emailConfidence ?? null}
                    onCadenceUpdated={setEmailCadence}
                  />
                )}
              </div>
            )}

          </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
