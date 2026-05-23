'use client'

import { useState, useEffect } from 'react'
import { ExternalLink, FileTextIcon, MoreHorizontal, XCircle, CheckCheck, RotateCcw, Link2, MailIcon, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
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
import { LazyScoreReportPane } from '@/components/applications/LazyScoreReportPane'
import { BuildProgressPane } from '@/components/applications/BuildProgressPane'
import { EmailCadenceStatusBadge } from '@/components/pipeline/EmailCadenceStatusBadge'
import { EmailNotFoundPanel } from '@/components/pipeline/EmailNotFoundPanel'
import { EmailOutreachPanel } from '@/components/pipeline/EmailOutreachPanel'
import { OutreachNoteSelector } from '@/components/pipeline/OutreachNoteSelector'
import { OutreachStatusBadge } from '@/components/pipeline/OutreachStatusBadge'
import type { ScoredJob, EmailCadenceSummary } from '@/lib/api'
import { retryLinkedIn, startEmailOutreach, getEmailCadence } from '@/lib/api'
import type { OutreachTargetSummary, OutreachStatus, EmailOutreachMode, EmailCadenceStatus } from '@/types/candidate'

const LINKEDIN_TRANSIENT: OutreachStatus[] = ['pending', 'discovering', 'enriching', 'generating']
const EMAIL_TRANSIENT: EmailCadenceStatus[] = ['pending_discovery', 'discovering', 'generating']

const GRADE_STYLES: Record<string, { badge: string; glow: string }> = {
  A: { badge: 'bg-emerald-500 text-white border-transparent', glow: 'shadow-[0_0_10px_rgba(16,185,129,0.25)]' },
  B: { badge: 'bg-blue-500   text-white border-transparent', glow: 'shadow-[0_0_10px_rgba(59,130,246,0.2)]'  },
  C: { badge: 'bg-amber-500  text-white border-transparent', glow: '' },
  D: { badge: 'bg-orange-500 text-white border-transparent', glow: '' },
  E: { badge: 'bg-rose-500   text-white border-transparent', glow: '' },
  F: { badge: 'bg-red-600    text-white border-transparent', glow: '' },
}

const STATUS_BADGE: Record<string, string> = {
  approved:      'bg-emerald-600 text-white border-transparent',
  resume_ready:  'bg-blue-600    text-white border-transparent',
  submitted:     'bg-cyan-700    text-white border-transparent',
  resume_failed: 'bg-red-700     text-white border-transparent',
  snoozed:       'bg-[#1e2d4a]  text-[#64748b] border-[#2d4a6e]',
  rejected:      'bg-red-900/40  text-red-400  border-red-800/40',
}

const STATUS_LABEL: Record<string, string> = {
  approved:      'Approved',
  resume_ready:  'Resume ready',
  submitted:     'Submitted',
  resume_failed: 'Resume failed',
  snoozed:       'Snoozed',
  rejected:      'Rejected',
}

interface Props {
  job: ScoredJob
  onMarkSubmitted: (jobId: string) => void
  onMoveToRejected: (jobId: string) => void
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

  // Sync emailCadence local state when the parent's silentRefresh delivers new
  // data from the backend. Only sync when prop carries a real (non-optimistic)
  // cadence row — optimistic inserts use id='' as a sentinel.
  useEffect(() => {
    if (job.emailCadence?.id && job.emailCadence.id !== '') {
      setEmailCadence(job.emailCadence)
    }
  }, [job.emailCadence?.id, job.emailCadence?.status])

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
  const gradeStyle = job.grade ? (GRADE_STYLES[job.grade] ?? GRADE_STYLES.F) : null
  const statusBadgeClass = STATUS_BADGE[job.status]
  const statusLabel = STATUS_LABEL[job.status]
  const agentBadge = getAgentBadge(job.pipelineJobStatus ?? null, job.status, job.errorMessage ?? null)
  const elapsedTime = job.updatedAt ? formatElapsed(job.updatedAt) : null
  const canMarkInterview = ['approved', 'resume_ready', 'submitted'].includes(job.status)
  const isInterviewMarked = !!job.interviewCallbackAt

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={setIsOpen}
      className={`bg-[#0d1f3c] border rounded-xl overflow-hidden transition-all duration-200 ${
        gradeStyle?.glow ?? ''
      } ${
        isSnoozed || isRejected
          ? 'border-[#1e2d4a] opacity-60'
          : isOpen
            ? 'border-[#2d4a6e]'
            : 'border-[#1e2d4a] hover:border-[#2d4a6e]'
      }`}
    >
      {/* ── Collapsed trigger — always visible ───────────────────────────── */}
      <CollapsibleTrigger asChild>
        <button
          className="w-full text-left px-4 py-3 flex items-center gap-3 group focus:outline-none"
          aria-label={isOpen ? 'Collapse job card' : 'Expand job card'}
        >
          {/* Grade badge */}
          {gradeStyle && job.grade ? (
            <Badge className={`w-7 h-7 flex items-center justify-center rounded-full text-xs font-bold shrink-0 ${gradeStyle.badge}`}>
              {job.grade}
            </Badge>
          ) : (
            <div className="w-7 h-7 shrink-0" />
          )}

          {/* Title + company */}
          <div className="flex-1 min-w-0">
            <p className="text-[#e2e8f0] font-medium text-sm leading-tight truncate">{job.title}</p>
            <p className="text-[#64748b] text-xs mt-0.5 truncate">{job.company}</p>
          </div>

          {/* Right chips cluster */}
          <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
            {/* Status */}
            {statusBadgeClass && statusLabel && (
              <Badge className={`text-[10px] h-5 px-1.5 ${statusBadgeClass}`}>{statusLabel}</Badge>
            )}

            {/* Elapsed time */}
            {elapsedTime && (
              <span className="text-[10px] text-[#475569] hidden sm:inline">{elapsedTime}</span>
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
              <Badge className="text-[10px] h-5 px-1.5 bg-purple-500/20 text-purple-300 border-purple-500/30">★ Interview</Badge>
            )}

            {/* Score */}
            {score !== undefined && (
              <span className="text-[10px] text-[#475569] font-mono hidden md:inline">{score.toFixed(1)}</span>
            )}

            {/* External link — stop propagation so it doesn't toggle card */}
            <a
              href={job.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open job listing"
              className="text-[#475569] hover:text-[#94a3b8] transition-colors p-0.5"
              onClick={(e) => e.stopPropagation()}
            >
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>

          {/* Chevron — rotates when open */}
          <ChevronDown
            className={`w-4 h-4 text-[#475569] transition-transform duration-200 shrink-0 ${
              isOpen ? 'rotate-180' : 'group-hover:text-[#94a3b8]'
            }`}
          />
        </button>
      </CollapsibleTrigger>

      {/* ── Expanded content ─────────────────────────────────────────────── */}
      <CollapsibleContent className="overflow-hidden data-[state=closed]:hidden">
        <div className="border-t border-[#1e2d4a] px-4 pb-4 pt-3 flex flex-col gap-3">

            {/* Error card */}
            {agentBadge?.variant === 'error' && (
              <div className="rounded-lg bg-[#450a0a] border border-[#7f1d1d] p-3 flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-[11px] font-semibold text-[#fca5a5]">{agentBadge.agentName} failed</p>
                    {job.errorMessage && (
                      <p className="text-[10px] text-[#f87171] mt-0.5 line-clamp-2">{job.errorMessage}</p>
                    )}
                    {elapsedTime && (
                      <p className="text-[10px] text-[#ef4444] mt-0.5">Failed {elapsedTime} ago</p>
                    )}
                  </div>
                  {onRetry && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-[10px] h-7 border-[#7f1d1d] text-[#fca5a5] hover:bg-[#7f1d1d] shrink-0"
                      onClick={() => onRetry(job.id)}
                      disabled={isPending}
                    >
                      <RotateCcw className="w-3 h-3 mr-1" />
                      Retry
                    </Button>
                  )}
                </div>
              </div>
            )}

            {/* Location + archetype pills */}
            {(job.location || job.archetype) && (
              <div className="flex gap-2 flex-wrap">
                {job.location && (
                  <Badge variant="outline" className="text-[10px] text-[#475569] border-[#1e2d4a] bg-[#0d1829]">
                    {job.location}
                  </Badge>
                )}
                {job.archetype && (
                  <Badge variant="outline" className="text-[10px] text-[#64748b] border-[#1e2d4a] bg-[#0d1829]">
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
                  disabled={isPending || buildRunning}
                  isLoading={buildRunning}>
                  <FileTextIcon className="w-3 h-3" />
                  {buildRunning ? 'AI Agent writing…' : 'Generate Resume'}
                </Button>
              )}

              {(isResumeReady || isSubmitted) && (
                <>
                  <Button size="sm" variant="outline"
                    className="h-7 text-[11px] gap-1 border-[#1e2d4a] text-[#93c5fd]"
                    onClick={() => onViewResume?.(job.id)}
                    disabled={isPending}>
                    <FileTextIcon className="w-3 h-3" />
                    View Resume
                  </Button>
                  <Button size="sm" variant="outline"
                    className="h-7 text-[11px] gap-1 border-[#1e2d4a] text-[#93c5fd]"
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
                      : 'border-[#1e2d4a] text-[#64748b] hover:text-[#94a3b8]'
                  }`}
                  onClick={() => onMarkInterview(job.id, !isInterviewMarked)}
                  disabled={isPending}
                  title={isInterviewMarked ? 'Unmark interview callback' : 'Mark as interview callback'}
                >
                  {isInterviewMarked ? '★ Interview' : '☆ Interview'}
                </Button>
              )}

              <div className="ml-auto flex gap-2 items-center">
                {!isRejected && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="sm" variant="ghost"
                        className="h-7 w-7 p-0 text-[#475569] hover:text-[#94a3b8]"
                        aria-label="More actions">
                        <MoreHorizontal className="w-3 h-3" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                      <DropdownMenuItem
                        onClick={() => onMoveToRejected(job.id)}
                        className="text-red-400 focus:text-red-300">
                        <XCircle className="w-3 h-3 mr-2" />
                        Move to Rejected
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            </div>

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
              <div className="border-t border-[#1e2d4a] pt-3 mt-1">
                <div className="flex items-center gap-2">
                  <span className="text-[9px] font-semibold text-[#334155] tracking-widest uppercase">
                    LinkedIn Outreach
                  </span>

                  {!job.outreachTarget && (
                    <span className="flex items-center gap-1.5 text-[10px] text-[#475569] animate-pulse">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                      AI Agent identifying hiring contact…
                    </span>
                  )}

                  {job.outreachTarget && LINKEDIN_TRANSIENT.includes(
                    (outreachStatus ?? job.outreachTarget.status) as OutreachStatus
                  ) && (
                    <>
                      <span className="flex items-center gap-1.5 text-[10px] text-[#475569] animate-pulse">
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                        {(outreachStatus ?? job.outreachTarget.status) === 'discovering'  && 'Identifying decision-maker…'}
                        {(outreachStatus ?? job.outreachTarget.status) === 'enriching'    && 'Researching their background…'}
                        {(outreachStatus ?? job.outreachTarget.status) === 'generating'   && 'Crafting personalised message…'}
                        {(outreachStatus ?? job.outreachTarget.status) === 'pending'      && 'AI Agent starting…'}
                      </span>
                      <Button size="sm" variant="outline"
                        className="h-6 text-[10px] border-[#1e3a5f] text-[#60a5fa] hover:bg-[#0d1f3c] gap-1"
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
                          className="text-[10px] text-[#60a5fa] hover:underline truncate">
                          {job.outreachTarget.name}
                          {job.outreachTarget.title && <span className="text-[#475569]"> · {job.outreachTarget.title}</span>}
                        </a>
                      ) : (
                        <span className="text-[10px] text-[#64748b]">
                          {job.outreachTarget.name}
                          {job.outreachTarget.title && <span className="text-[#475569]"> · {job.outreachTarget.title}</span>}
                        </span>
                      )}
                    </div>
                    <span className={`self-start text-[9px] font-medium px-1.5 py-0.5 rounded-full border ${
                      job.outreachTarget.seniority === 'JOB_POSTER'
                        ? 'bg-emerald-950/50 text-emerald-400 border-emerald-800/40'
                        : 'bg-amber-950/50 text-amber-400 border-amber-800/40'
                    }`}>
                      {job.outreachTarget.seniority === 'JOB_POSTER' ? '📋 From JD' : '✨ AI Match'}
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
              <div className="border-t border-[#1e2d4a] pt-3 mt-1">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[9px] font-semibold text-[#334155] tracking-widest uppercase">Email</span>

                  {!emailCadence && (
                    <span className="flex items-center gap-1.5 text-[10px] text-[#475569] animate-pulse">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                      AI Agent locating email address…
                    </span>
                  )}

                  {emailCadence && EMAIL_TRANSIENT.includes(emailCadence.status) && (
                    <span className="flex items-center gap-1.5 text-[10px] text-[#475569] animate-pulse">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                      {emailCadence.status === 'pending_discovery' && 'AI Agent starting…'}
                      {emailCadence.status === 'discovering'       && 'Running email discovery…'}
                      {emailCadence.status === 'generating'        && 'Writing 3-touch email sequence…'}
                    </span>
                  )}

                  {!emailCadence && (
                    <Button size="sm" variant="outline"
                      className="h-6 text-[10px] border-[#1e3a5f] text-[#60a5fa] hover:bg-[#0d1f3c] gap-1 ml-1"
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
                      className="h-6 text-[10px] border-[#1e3a5f] text-[#60a5fa] hover:bg-[#0d1f3c] gap-1"
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
                    <MailIcon className="w-3 h-3 text-[#475569] flex-shrink-0" />
                    <span className="text-[10px] text-[#64748b] font-mono truncate">
                      {emailCadence.hiringManagerEmail}
                    </span>
                  </div>
                )}

                {emailCadence && (
                  emailCadence.status === 'pending_approval' ||
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
