'use client'

import { useEffect, useState } from 'react'
import { Textarea } from '@/components/ui/textarea'
import { saveCV } from '@/lib/api'
import { useRegisterSection } from '@/components/settings/SettingsDraftContext'
import type { CandidateState } from '@/types/candidate'

interface MarkdownEditorProps {
  /** Markdown to display/edit (a freshly converted file, or the saved CV). */
  initialMarkdown: string
  /** The currently persisted CV markdown — the dirty baseline. */
  savedMarkdown: string | null
  candidateId: string
  onSaved?: (candidate: CandidateState) => void
  sectionId?: string
}

export function MarkdownEditor({
  initialMarkdown,
  savedMarkdown,
  candidateId,
  onSaved,
  sectionId = 'resume-cv',
}: MarkdownEditorProps) {
  const [markdown, setMarkdown] = useState(initialMarkdown)
  const [error, setError] = useState<string | null>(null)

  // Re-seed when a new file conversion replaces the source markdown.
  useEffect(() => {
    setMarkdown(initialMarkdown)
  }, [initialMarkdown])

  // Dirty against the *saved* CV, so a freshly converted (but unedited) upload
  // still counts as an unsaved change.
  const dirty = markdown !== (savedMarkdown ?? '')

  async function save() {
    setError(null)
    try {
      const candidate = await saveCV(markdown, candidateId)
      onSaved?.(candidate)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed. Try again.')
      throw e
    }
  }

  useRegisterSection(sectionId, dirty, save)

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Review and correct the Markdown — changes save with the bar below.
      </p>
      <Textarea
        value={markdown}
        onChange={(e) => setMarkdown(e.target.value)}
        rows={22}
        className="font-mono text-sm"
        spellCheck={false}
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
