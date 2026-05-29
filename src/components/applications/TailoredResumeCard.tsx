'use client'

import { FileTextIcon, AlertTriangle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import type { ResumeVersion } from '@/lib/api'

interface Props {
  version: ResumeVersion
  onViewResume: () => void
  onViewCoverLetter: () => void
}

export function TailoredResumeCard({ version, onViewResume, onViewCoverLetter }: Props) {
  const confidence = version.archetypeConfidence ? Number(version.archetypeConfidence) : null
  const isLowConfidence = confidence !== null && confidence < 0.5
  const keywords = (version.keywords ?? []).filter(k => k.trim() !== '')
  const isPdfReady = Boolean(version.resumePdfPath)

  return (
    <div className="rounded-lg border border-border bg-background p-3 space-y-3">
      {/* Stale warning */}
      {version.isStale && (
        <div className="rounded-md bg-amber-950/30 border border-amber-800/40 px-2.5 py-1.5">
          <p className="text-[11px] text-amber-400 inline-flex items-center gap-1.5">
            <AlertTriangle className="w-3 h-3 shrink-0" /> CV updated since tailoring — consider re-tailoring.
          </p>
        </div>
      )}

      {/* Archetype row */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[9px] text-slate-500 uppercase tracking-wide">Archetype</span>
        {version.archetype ? (
          <>
            <span className="text-[12px] font-semibold text-slate-100">{version.archetype}</span>
            {confidence !== null && (
              isLowConfidence ? (
                <Badge className="bg-amber-950/40 text-amber-400 border-amber-800/40 text-[9px] px-1.5 py-0">
                  Low confidence · {Math.round(confidence * 100)}%
                </Badge>
              ) : (
                <Badge className="bg-card text-slate-400 border-border text-[9px] px-1.5 py-0">
                  {Math.round(confidence * 100)}%
                </Badge>
              )
            )}
          </>
        ) : (
          <span className="text-[11px] text-slate-600">Not detected</span>
        )}
      </div>

      {/* Keywords */}
      <div className="space-y-1">
        <span className="text-[9px] text-slate-500 uppercase tracking-wide">Keywords injected</span>
        {keywords.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {keywords.map((kw) => (
              <Badge
                key={kw}
                className="bg-blue-950/40 text-blue-300 border-blue-800/40 text-[10px] px-1.5 py-0"
              >
                {kw}
              </Badge>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-slate-600 italic">No keywords detected</p>
        )}
      </div>

      {/* PDF actions */}
      <div className="flex items-center gap-2">
        {isPdfReady ? (
          <>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[11px] gap-1 border-border text-primary"
              onClick={onViewResume}
            >
              <FileTextIcon className="w-3 h-3" />
              View Resume
            </Button>
            {version.coverLetterPdfPath && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-[11px] gap-1 border-border text-primary"
                onClick={onViewCoverLetter}
              >
                <FileTextIcon className="w-3 h-3" />
                View Cover Letter
              </Button>
            )}
          </>
        ) : (
          <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
            <Spinner className="w-3 h-3" />
            Generating PDF…
          </div>
        )}
        <span className="text-[10px] text-slate-600 ml-auto">v{version.versionN}</span>
      </div>
    </div>
  )
}
