'use client'

import { useEffect, useState } from 'react'
import { FileCheck2, FileText, ChevronDown, RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { CVUploader } from '@/components/cv/CVUploader'
import { MarkdownEditor } from '@/components/cv/MarkdownEditor'
import { ParseStatusBadge } from '@/components/cv/ParseStatusBadge'
import { reparseCV, getCV } from '@/lib/api'
import type { CandidateState } from '@/types/candidate'

interface CVCardProps {
  candidate: CandidateState
  candidateId: string
  onCandidateChange: (candidate: CandidateState) => void
  /** Open the markdown editor by default (used by the first-run wizard). */
  defaultEditorOpen?: boolean
}

export function CVCard({ candidate, candidateId, onCandidateChange, defaultEditorOpen = false }: CVCardProps) {
  const [convertedMarkdown, setConvertedMarkdown] = useState<string | null>(null)
  const [editorOpen, setEditorOpen] = useState(defaultEditorOpen)
  const [reparsing, setReparsing] = useState(false)
  const [reparseError, setReparseError] = useState<string | null>(null)

  const markdownToEdit = convertedMarkdown ?? candidate.baseCvMd ?? null
  const hasCV = Boolean(candidate.baseCvMd) || Boolean(convertedMarkdown)

  // Reveal the editor automatically when a freshly converted file arrives.
  useEffect(() => {
    if (convertedMarkdown) setEditorOpen(true)
  }, [convertedMarkdown])

  const canReparse =
    candidate.parseStatus !== 'parsing' &&
    (Boolean(candidate.baseCvMd) || candidate.parseStatus === 'failed')

  async function handleReparse() {
    setReparseError(null)
    setReparsing(true)
    onCandidateChange({ ...candidate, parseStatus: 'parsing' })
    try {
      const updated = await reparseCV(candidateId)
      onCandidateChange(updated)
    } catch (e) {
      setReparseError(e instanceof Error ? e.message : 'Re-parse failed. Try again.')
      try {
        onCandidateChange(await getCV(candidateId))
      } catch {
        onCandidateChange({ ...candidate, parseStatus: 'failed' })
      }
    } finally {
      setReparsing(false)
    }
  }

  function handleCVSaved(updated: CandidateState) {
    setConvertedMarkdown(null)
    onCandidateChange(updated)
  }

  // ── Empty state: no CV on file ──
  if (!hasCV) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3 rounded-lg border border-dashed border-border-strong bg-background p-4">
          <FileText className="w-5 h-5 text-muted-foreground shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-foreground">No CV uploaded yet</p>
            <p className="text-xs text-muted-foreground">
              Upload your résumé to let Proxim tailor applications.
            </p>
          </div>
        </div>
        <CVUploader onConverted={setConvertedMarkdown} showIcon />
      </div>
    )
  }

  return (
    <Collapsible open={editorOpen} onOpenChange={setEditorOpen} className="space-y-4">
      {/* Status row */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border-strong bg-background p-3">
        <FileCheck2 className="w-5 h-5 text-emerald-400 shrink-0" />
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium text-foreground truncate">CV on file</span>
          <ParseStatusBadge initialStatus={candidate.parseStatus} candidateId={candidateId} />
        </div>

        <div className="ml-auto flex items-center gap-2">
          <CVUploader
            onConverted={setConvertedMarkdown}
            label="Replace"
            variant="outline"
            size="sm"
            hideHint
            showIcon
          />
          <CollapsibleTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="text-xs border-border-strong text-primary hover:bg-card gap-1.5"
            >
              Edit
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${editorOpen ? 'rotate-180' : ''}`} />
            </Button>
          </CollapsibleTrigger>
          {canReparse && (
            <Button
              variant="outline"
              size="sm"
              className="text-xs border-border-strong text-primary hover:bg-card gap-1.5"
              onClick={handleReparse}
              isLoading={reparsing}
            >
              <RotateCw className="w-3.5 h-3.5" />
              Re-parse
            </Button>
          )}
        </div>
      </div>

      {reparseError && <p className="text-xs text-destructive">{reparseError}</p>}

      <CollapsibleContent>
        {markdownToEdit !== null && (
          <MarkdownEditor
            initialMarkdown={markdownToEdit}
            savedMarkdown={candidate.baseCvMd}
            candidateId={candidateId}
            onSaved={handleCVSaved}
          />
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}
