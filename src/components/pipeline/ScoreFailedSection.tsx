'use client'

import { useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronUp, ExternalLink, RotateCcw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { resetFailedJobs, retryScoring, triggerPipeline } from '@/lib/api'
import type { HitlJob } from '@/lib/api'

interface Props {
  jobs: HitlJob[]
  candidateId: string
  onRetried: (pipelineJobId: string) => void
  onDismiss: (jobId: string) => Promise<void> | void
}

// An "unreadable" job (wall/login/expired page → empty JD) can't be rescored, so
// it gets a Dismiss action instead of Retry. Identified by its error message.
function isUnreadable(job: HitlJob): boolean {
  return (job.errorMessage ?? '').startsWith("Couldn't read this posting")
}

export function ScoreFailedSection({ jobs, candidateId, onRetried, onDismiss }: Props) {
  const [open, setOpen]               = useState(false)
  const [retryingAll, setRetryingAll] = useState(false)
  const [retryingId, setRetryingId]   = useState<string | null>(null)
  const [dismissingId, setDismissingId] = useState<string | null>(null)
  const [error, setError]             = useState<string | null>(null)

  const retryableCount = jobs.filter(j => !isUnreadable(j)).length

  const count = jobs.length

  async function handleRetryAll() {
    setRetryingAll(true)
    setError(null)
    try {
      await resetFailedJobs(candidateId)
      const { jobId } = await triggerPipeline('score_jobs', candidateId)
      onRetried(jobId)
    } catch {
      setError('Failed to retry — please try again')
    } finally {
      setRetryingAll(false)
    }
  }

  async function handleRetryOne(jobId: string) {
    setRetryingId(jobId)
    setError(null)
    try {
      const { pipelineJobId } = await retryScoring(jobId, candidateId)
      onRetried(pipelineJobId)
    } catch {
      setError('Failed to retry — please try again')
    } finally {
      setRetryingId(null)
    }
  }

  async function handleDismiss(jobId: string) {
    setDismissingId(jobId)
    setError(null)
    try {
      await onDismiss(jobId)
    } catch {
      setError('Failed to dismiss — please try again')
    } finally {
      setDismissingId(null)
    }
  }

  return (
    <div className="max-w-3xl mt-4 border border-amber-800/40 rounded-xl overflow-hidden bg-muted">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-amber-950/20">
        <Button
          variant="ghost"
          className="flex items-center gap-2 h-auto p-0 text-amber-400 hover:text-amber-300 hover:bg-transparent"
          onClick={() => setOpen(v => !v)}
          aria-label={`${count} job${count !== 1 ? 's' : ''} could not be scored`}
        >
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <span className="text-[12px] font-semibold">
            {count} job{count !== 1 ? 's' : ''} could not be scored
          </span>
          {open
            ? <ChevronUp className="w-3.5 h-3.5 ml-1" />
            : <ChevronDown className="w-3.5 h-3.5 ml-1" />
          }
        </Button>

        {retryableCount > 0 && (
          <Button
            size="sm"
            variant="outline"
            className="h-6 text-[10px] border-amber-700/50 text-amber-400 hover:bg-amber-950/40 gap-1"
            onClick={handleRetryAll}
            disabled={retryingAll}
            isLoading={retryingAll}
            aria-label="Retry All"
          >
            <RotateCcw className="w-3 h-3" />
            Retry All
          </Button>
        )}
      </div>

      {/* Body */}
      {open && (
        <div className="divide-y divide-border">
          {jobs.map(job => (
            <div key={job.id} className="flex items-start justify-between gap-3 px-4 py-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[12px] font-medium text-foreground truncate">
                    {job.title}
                  </span>
                  <span className="text-[11px] text-muted-foreground shrink-0">
                    · {job.company}
                  </span>
                  <a
                    href={job.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted-foreground hover:text-primary shrink-0"
                    title="Open original job listing"
                  >
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
                {job.errorMessage && (
                  <p className="text-[11px] text-amber-600/80 mt-0.5">{job.errorMessage}</p>
                )}
              </div>

              {isUnreadable(job) ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 text-[10px] border-border-strong text-muted-foreground hover:bg-card gap-1 shrink-0"
                  onClick={() => handleDismiss(job.id)}
                  disabled={dismissingId === job.id}
                  isLoading={dismissingId === job.id}
                  aria-label="Dismiss"
                >
                  <X className="w-3 h-3" />
                  Dismiss
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 text-[10px] border-border-strong text-primary hover:bg-card gap-1 shrink-0"
                  onClick={() => handleRetryOne(job.id)}
                  disabled={retryingId === job.id}
                  isLoading={retryingId === job.id}
                  aria-label="Retry"
                >
                  <RotateCcw className="w-3 h-3" />
                  Retry
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {error && (
        <p className="px-4 py-2 text-[10px] text-red-400 border-t border-border">{error}</p>
      )}
    </div>
  )
}
