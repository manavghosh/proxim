'use client'

import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { convertCV } from '@/lib/api'

interface CVUploaderProps {
  onConverted: (markdown: string) => void
}

const ACCEPTED = '.md,.docx,.pdf'
const MAX_MB = 10

export function CVUploader({ onConverted }: CVUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleFile(file: File) {
    setError(null)
    if (file.size > MAX_MB * 1024 * 1024) {
      setError(`File exceeds ${MAX_MB} MB limit.`)
      return
    }
    setLoading(true)
    try {
      const { markdown } = await convertCV(file)
      onConverted(markdown)
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Conversion failed. Try a different file.'
      )
    } finally {
      setLoading(false)
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }

  return (
    <div className="space-y-2">
      <Button
        variant="default"
        onClick={() => { if (!loading) inputRef.current?.click() }}
        isLoading={loading}
      >
        Upload CV
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED}
        className="hidden"
        onChange={handleChange}
      />
      <p className="text-xs text-muted-foreground">
        Accepted: .md, .docx, .pdf · Max {MAX_MB} MB
      </p>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
