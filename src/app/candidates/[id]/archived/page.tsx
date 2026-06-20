'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { Archive, ArchiveRestore, Building2, ExternalLink } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { GradeBadge } from '@/components/applications/GradeBadge'
import { JobStatusBadge } from '@/components/applications/JobStatusBadge'
import { CandidateSwitcher } from '@/components/layout/CandidateSwitcher'
import { getArchivedJobs, unarchiveJob, type ArchivedJob } from '@/lib/api'

// Statuses that route back to the Scorecard; everything else lives on Applications.
const SCORECARD_STATUSES = new Set(['scored', 'awaiting', 'score_failed'])

function formatRelative(iso: string | null): string {
  if (!iso) return ''
  try {
    const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
    if (days <= 0) return 'today'
    if (days === 1) return 'yesterday'
    if (days < 7) return `${days} days ago`
    if (days < 30) return `${Math.floor(days / 7)} week${Math.floor(days / 7) === 1 ? '' : 's'} ago`
    return `${Math.floor(days / 30)} month${Math.floor(days / 30) === 1 ? '' : 's'} ago`
  } catch {
    return ''
  }
}

function Toast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 4000)
    return () => clearTimeout(t)
  }, [onDismiss])
  return (
    <div className="fixed bottom-4 right-4 z-50 px-4 py-3 rounded-lg border border-primary bg-background text-[12px] text-white shadow-lg">
      {message}
    </div>
  )
}

export default function ArchivedPage() {
  const { id: candidateId } = useParams<{ id: string }>()
  const [jobs, setJobs] = useState<ArchivedJob[]>([])
  const [loading, setLoading] = useState(true)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const data = await getArchivedJobs(candidateId)
      setJobs(data.jobs)
    } catch {
      setToast('Failed to load archived jobs')
    } finally {
      setLoading(false)
    }
  }, [candidateId])

  useEffect(() => { load() }, [load])

  const handleRetrieve = async (job: ArchivedJob) => {
    setPendingId(job.id)
    try {
      await unarchiveJob(job.id, candidateId)
      setJobs((prev) => prev.filter((j) => j.id !== job.id))
      setToast(
        SCORECARD_STATUSES.has(job.status)
          ? 'Restored to Scorecard'
          : 'Restored to Applications'
      )
    } catch {
      setToast('Failed to restore job')
    } finally {
      setPendingId(null)
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border bg-background flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-[15px] font-semibold text-foreground flex items-center gap-2">
            <Archive className="w-4 h-4 text-primary" />
            Archived Jobs
          </h1>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {loading ? 'Loading…' : `${jobs.length} archived job${jobs.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        <CandidateSwitcher candidateId={candidateId} />
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="space-y-3 max-w-3xl">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-20 w-full rounded-xl bg-muted" />
            ))}
          </div>
        ) : jobs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-20">
            <Archive className="w-10 h-10 text-border mb-4" />
            <p className="text-[13px] text-muted-foreground">
              No archived jobs. Archive aged or unwanted jobs from the Scorecard or Applications screens to declutter them here.
            </p>
          </div>
        ) : (
          <div className="space-y-3 max-w-3xl">
            {jobs.map((job) => (
              <Card
                key={job.id}
                className="bg-background border border-border hover:border-border-strong transition-colors"
                data-testid="archived-job-row"
              >
                <CardContent className="p-4 flex items-center gap-3">
                  <GradeBadge grade={job.grade} variant="soft" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-[13px] font-semibold text-foreground leading-snug truncate">
                        {job.title}
                      </h3>
                      <JobStatusBadge status={job.status} />
                    </div>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        <Building2 className="w-3 h-3" />
                        {job.company}
                      </span>
                      {job.archivedAt && (
                        <span className="text-[11px] text-muted-foreground">
                          archived {formatRelative(job.archivedAt)}
                        </span>
                      )}
                    </div>
                  </div>
                  <a
                    href={job.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted-foreground hover:text-primary transition-colors flex-shrink-0"
                    title={job.sourceUrl}
                  >
                    <ExternalLink className="w-4 h-4" />
                  </a>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-[11px] px-3 gap-1 border-border text-primary shrink-0"
                    onClick={() => handleRetrieve(job)}
                    disabled={pendingId === job.id}
                    isLoading={pendingId === job.id}
                    data-testid="retrieve-btn"
                  >
                    <ArchiveRestore className="w-3 h-3" />
                    Retrieve
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {toast && <Toast message={toast} onDismiss={() => setToast(null)} />}
    </div>
  )
}
