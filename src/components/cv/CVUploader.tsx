'use client'

import { useRef, useState } from 'react'
import { Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { convertCV } from '@/lib/api'

interface CVUploaderProps {
  onConverted: (markdown: string) => void
  /** Button label — defaults to "Upload CV". */
  label?: string
  variant?: 'default' | 'outline'
  size?: 'default' | 'sm'
  /** Hide the "Accepted: .md, .docx, .pdf" helper line. */
  hideHint?: boolean
  showIcon?: boolean
}

const ACCEPTED = '.md,.docx,.pdf'
const MAX_MB = 10

export function CVUploader({
  onConverted,
  label = 'Upload CV',
  variant = 'default',
  size = 'default',
  hideHint = false,
  showIcon = false,
}: CVUploaderProps) {
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
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <Button
        variant={variant}
        size={size}
        className={variant === 'outline' ? 'text-xs border-border-strong text-primary hover:bg-card gap-1.5' : undefined}
        onClick={() => { if (!loading) inputRef.current?.click() }}
        isLoading={loading}
      >
        {showIcon && <Upload className="w-3.5 h-3.5" />}
        {label}
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED}
        className="hidden"
        onChange={handleChange}
      />
      {!hideHint && (
        <p className="text-xs text-muted-foreground">
          Accepted: .md, .docx, .pdf · Max {MAX_MB} MB
        </p>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
