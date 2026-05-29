'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { downloadResumeUrl, submitResumeVersion, triggerResumeGeneration } from '@/lib/api'
import type { ResumeVersion } from '@/lib/api'
import { DownloadIcon, CheckIcon, AlertTriangleIcon, FileTextIcon } from 'lucide-react'

interface Props {
  jobId: string
  candidateId: string
  versions: ResumeVersion[]
  currentCvHash: string | null
  onClose: () => void
  onRegenerate?: () => void
}

function VersionCard({
  version,
  jobId,
  onSubmit,
  submitting,
}: {
  version: ResumeVersion
  jobId: string
  onSubmit: (versionId: string) => void
  submitting: string | null
}) {
  const isStale = version.isStale
  const isSubmitted = version.isSubmitted
  const isPending = submitting === version.id

  return (
    <div className={`rounded-xl border p-4 space-y-3 ${isStale ? 'border-amber-700/30 bg-amber-950/10' : 'border-border bg-background'}`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-semibold text-foreground">v{version.versionN}</span>
            <Badge variant="outline" className="text-[10px] border-border text-teal-300 bg-teal-950/40">
              {version.archetype}
            </Badge>
            {isSubmitted && (
              <Badge className="text-[10px] bg-emerald-600 text-white border-transparent gap-1">
                <CheckIcon className="w-2.5 h-2.5" /> Submitted
              </Badge>
            )}
            {isStale && (
              <Badge className="text-[10px] bg-amber-900/60 text-amber-300 border-amber-700/30 gap-1">
                <AlertTriangleIcon className="w-2.5 h-2.5" /> Stale — CV updated
              </Badge>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            {new Date(version.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
          </p>
        </div>
        <span className={`text-[10px] px-2 py-0.5 rounded-full ${
          version.generationStatus === 'completed'
            ? 'bg-emerald-950/40 text-emerald-400'
            : version.generationStatus === 'failed'
              ? 'bg-red-950/40 text-red-400'
              : 'bg-card text-muted-foreground'
        }`}>
          {version.generationStatus}
        </span>
      </div>

      {/* Download links */}
      {version.generationStatus === 'completed' && (
        <div className="flex gap-2 flex-wrap">
          <Button size="sm" variant="outline"
            className="h-7 text-[10px] border-border text-primary gap-1.5"
            asChild>
            <a href={downloadResumeUrl(jobId, version.id, 'resume')} download>
              <DownloadIcon className="w-3 h-3" /> Resume PDF
            </a>
          </Button>
          <Button size="sm" variant="outline"
            className="h-7 text-[10px] border-border text-primary gap-1.5"
            asChild>
            <a href={downloadResumeUrl(jobId, version.id, 'cover-letter')} download>
              <DownloadIcon className="w-3 h-3" /> Cover Letter
            </a>
          </Button>
          {!isSubmitted && (
            <Button size="sm" variant="outline"
              className={`h-7 text-[10px] gap-1.5 ${isStale ? 'opacity-40 cursor-not-allowed' : 'border-emerald-700/40 text-emerald-400 hover:bg-emerald-950/30'}`}
              disabled={isStale || isPending}
              isLoading={isPending}
              onClick={() => onSubmit(version.id)}
              title={isStale ? 'Regenerate first — CV has changed' : 'Mark as submitted'}
            >
              <FileTextIcon className="w-3 h-3" /> Mark Submitted
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

export function ExportResumePanel({ jobId, candidateId, versions, currentCvHash, onClose, onRegenerate }: Props) {
  const [submitting, setSubmitting] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [localVersions, setLocalVersions] = useState(versions)

  // Sync local state when the parent resolves the fetch — `versions` starts as
  // [] until the async `getResumeVersions` call completes in the parent, so we
  // must keep the two in sync (same pattern as ParseStatusBadge).
  useEffect(() => {
    setLocalVersions(versions)
  }, [versions])

  async function handleSubmit(versionId: string) {
    setSubmitting(versionId)
    try {
      await submitResumeVersion(jobId, versionId)
      setLocalVersions(prev =>
        prev.map(v => v.id === versionId ? { ...v, isSubmitted: true } : v)
      )
    } catch {
      // error handled silently — user can retry
    } finally {
      setSubmitting(null)
    }
  }

  async function handleGenerate() {
    setGenerating(true)
    try {
      await triggerResumeGeneration(jobId, candidateId)
      onRegenerate?.()
      onClose()
    } catch {
      // error handled silently
    } finally {
      setGenerating(false)
    }
  }

  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose() }}>
      <SheetContent side="right"
        className="w-full max-w-xl bg-background border-l border-border overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-foreground text-sm font-semibold flex items-center justify-between">
            Resume &amp; Cover Letter
            <Button size="sm" className="text-xs bg-blue-600 hover:bg-blue-500"
              onClick={handleGenerate} isLoading={generating}>
              + Generate New
            </Button>
          </SheetTitle>
        </SheetHeader>

        <div className="px-6 pb-6 space-y-3 mt-2">
          {localVersions.length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-8">
              No versions yet. Click "Generate New" to create your first resume.
            </p>
          ) : (
            localVersions.map(v => (
              <VersionCard
                key={v.id}
                version={v}
                jobId={jobId}
                onSubmit={handleSubmit}
                submitting={submitting}
              />
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
