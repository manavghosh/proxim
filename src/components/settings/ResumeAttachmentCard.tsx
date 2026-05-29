'use client'

import { useEffect, useRef, useState } from 'react'
import { FileText, Upload, CheckCircle2, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getPreferences, updatePreferences, uploadBasePdf } from '@/lib/api'

interface Props {
  candidateId: string
}

export function ResumeAttachmentCard({ candidateId }: Props) {
  const [attachMode,    setAttachMode]    = useState<'tailored' | 'original'>('tailored')
  const [uploading,     setUploading]     = useState(false)
  const [uploadedName,  setUploadedName]  = useState<string | null>(null)
  const [uploadError,   setUploadError]   = useState<string | null>(null)
  const [saving,        setSaving]        = useState(false)
  const [saved,         setSaved]         = useState(false)
  const [loading,       setLoading]       = useState(true)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    getPreferences(candidateId).then(({ preferences }) => {
      setAttachMode(preferences.email_resume_attachment ?? 'tailored')
      setLoading(false)
    })
  }, [candidateId])

  async function handleModeChange(mode: 'tailored' | 'original') {
    setAttachMode(mode)
    setSaving(true)
    setSaved(false)
    try {
      await updatePreferences({ email_resume_attachment: mode }, candidateId)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally {
      setSaving(false)
    }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadError(null)
    setUploading(true)
    try {
      await uploadBasePdf(candidateId, file)
      setUploadedName(file.name)
    } catch {
      setUploadError('Upload failed. Please try again.')
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <FileText className="w-4 h-4 text-muted-foreground" />
        <p className="text-[9px] font-semibold text-muted-foreground tracking-widest uppercase">
          Resume Attachment
        </p>
        {saving && <span className="text-[9px] text-muted-foreground">Saving…</span>}
        {saved  && <span className="text-[9px] text-emerald-400">Saved ✓</span>}
      </div>

      {loading ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : (
        <div className="space-y-2">
          <label className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-all ${
            attachMode === 'tailored'
              ? 'border-blue-500 bg-blue-950/20'
              : 'border-border hover:border-border-strong'
          }`}>
            <input
              type="radio"
              name="attach-mode"
              value="tailored"
              checked={attachMode === 'tailored'}
              onChange={() => handleModeChange('tailored')}
              className="mt-0.5 accent-blue-500"
              data-testid="attach-tailored"
            />
            <div>
              <span className="text-xs font-medium text-foreground">Tailored AI resume</span>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                Attach the job-specific resume Proxim generated.
              </p>
            </div>
          </label>

          <label className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-all ${
            attachMode === 'original'
              ? 'border-blue-500 bg-blue-950/20'
              : 'border-border hover:border-border-strong'
          }`}>
            <input
              type="radio"
              name="attach-mode"
              value="original"
              checked={attachMode === 'original'}
              onChange={() => handleModeChange('original')}
              className="mt-0.5 accent-blue-500"
              data-testid="attach-original"
            />
            <div>
              <span className="text-xs font-medium text-foreground">My original resume</span>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                Attach a PDF you upload below.
              </p>
            </div>
          </label>

          {attachMode === 'original' && (
            <div className="rounded-lg border border-border bg-background p-3 space-y-2">
              {uploadedName ? (
                <div className="flex items-center gap-2 text-[10px] text-emerald-400">
                  <CheckCircle2 className="w-3 h-3 shrink-0" />
                  <span className="truncate">{uploadedName}</span>
                </div>
              ) : (
                <p className="text-[10px] text-muted-foreground">No PDF uploaded yet.</p>
              )}
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-[11px] border-border-strong text-primary hover:bg-card gap-1"
                isLoading={uploading}
                onClick={() => inputRef.current?.click()}
                data-testid="upload-pdf-btn"
              >
                <Upload className="w-3 h-3" />
                {uploadedName ? 'Replace PDF' : 'Upload PDF'}
              </Button>
              <input
                ref={inputRef}
                type="file"
                accept=".pdf,application/pdf"
                className="hidden"
                onChange={handleFileChange}
                data-testid="upload-pdf-input"
              />
              {uploadError && (
                <div className="flex items-center gap-1.5 text-[10px] text-red-400">
                  <AlertCircle className="w-3 h-3 shrink-0" />
                  {uploadError}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
