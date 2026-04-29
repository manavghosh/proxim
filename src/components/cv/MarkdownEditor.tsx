'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { saveCV } from '@/lib/api'
import type { CandidateState } from '@/types/candidate'

interface MarkdownEditorProps {
  initialMarkdown: string
  onSaved: (candidate: CandidateState) => void
}

export function MarkdownEditor({ initialMarkdown, onSaved }: MarkdownEditorProps) {
  const [markdown, setMarkdown] = useState(initialMarkdown)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    setError(null)
    setSaving(true)
    try {
      const candidate = await saveCV(markdown)
      onSaved(candidate)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed. Try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Review and correct the Markdown before saving.
        </p>
        <Button variant="default" size="sm" onClick={handleSave} isLoading={saving}>
          Save CV
        </Button>
      </div>
      <Textarea
        value={markdown}
        onChange={(e) => setMarkdown(e.target.value)}
        rows={24}
        className="font-mono text-sm"
        spellCheck={false}
        readOnly={saving}
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
