'use client'

import { useEffect, useRef, useState } from 'react'
import { FileText, Upload, CheckCircle2, AlertCircle, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { getPreferences, updatePreferences, uploadBasePdf } from '@/lib/api'
import { useRegisterSection } from '@/components/settings/SettingsDraftContext'

type AttachMode = 'tailored' | 'original'

interface Props {
  candidateId: string
  onSaved?: () => void
  sectionId?: string
}

export function ResumeAttachmentCard({ candidateId, onSaved, sectionId = 'resume-attachment' }: Props) {
  const [savedMode,     setSavedMode]     = useState<AttachMode>('tailored')
  const [attachMode,    setAttachMode]    = useState<AttachMode>('tailored')
  const [uploading,     setUploading]     = useState(false)
  const [uploadedName,  setUploadedName]  = useState<string | null>(null)
  const [uploadError,   setUploadError]   = useState<string | null>(null)
  const [loading,       setLoading]       = useState(true)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    getPreferences(candidateId).then(({ preferences }) => {
      const m = preferences.email_resume_attachment ?? 'tailored'
      setSavedMode(m)
      setAttachMode(m)
      setUploadedName(preferences.base_resume_pdf_name ?? null)
      setLoading(false)
    })
  }, [candidateId])

  const dirty = attachMode !== savedMode

  async function save() {
    await updatePreferences({ email_resume_attachment: attachMode }, candidateId)
    setSavedMode(attachMode)
    onSaved?.()
  }

  useRegisterSection(sectionId, dirty, save)

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
      </div>

      {loading ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : (
        <RadioGroup
          value={attachMode}
          onValueChange={(v) => setAttachMode(v as AttachMode)}
          className="space-y-2"
        >
          <label className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-all ${
            attachMode === 'tailored'
              ? 'border-primary bg-primary/5'
              : 'border-border hover:border-border-strong'
          }`}>
            <RadioGroupItem value="tailored" data-testid="attach-tailored" className="mt-0.5" />
            <div>
              <span className="text-xs font-medium text-foreground">Tailored AI resume</span>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                Attach the job-specific resume Proxim generated.
              </p>
            </div>
          </label>

          <label className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-all ${
            attachMode === 'original'
              ? 'border-primary bg-primary/5'
              : 'border-border hover:border-border-strong'
          }`}>
            <RadioGroupItem value="original" data-testid="attach-original" className="mt-0.5" />
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
                  <Button
                    asChild
                    variant="link"
                    className="h-auto min-w-0 gap-1 p-0 text-[10px] text-emerald-400 hover:text-emerald-300"
                  >
                    <a
                      href={`/api/cv/base-pdf?candidateId=${encodeURIComponent(candidateId)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Open resume in a read-only view"
                      data-testid="view-pdf-link"
                    >
                      <span className="truncate">{uploadedName}</span>
                      <ExternalLink className="w-2.5 h-2.5 shrink-0" />
                    </a>
                  </Button>
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
        </RadioGroup>
      )}
    </div>
  )
}
