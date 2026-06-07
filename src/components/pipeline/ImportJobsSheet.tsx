'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { PlusCircle, ExternalLink, CheckCircle2, AlertCircle, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { importJobs } from '@/lib/api'

interface Props {
  candidateId: string
  onImported?: (pipelineJobId: string, importedCount: number) => void
  label?: string
}

type Status = 'idle' | 'loading' | 'success' | 'error'

// api.ts `request()` throws `"<status>: <body>"`. Surface the server's clean
// message (e.g. "Maximum 50 URLs per import") instead of the raw status+JSON.
function extractErrorMessage(e: unknown): string {
  if (!(e instanceof Error)) return 'Import failed'
  const m = e.message.match(/^\d+:\s*(\{[\s\S]*\})$/)
  if (m) {
    try {
      const parsed = JSON.parse(m[1]) as { error?: string }
      if (parsed.error) return parsed.error
    } catch { /* not JSON — fall through */ }
  }
  return e.message
}

export function ImportJobsSheet({ candidateId, onImported, label = '+ Add Jobs' }: Props) {
  const router              = useRouter()
  const [open, setOpen]     = useState(false)
  const [urls, setUrls]     = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [result, setResult] = useState<{ imported: number; skipped: number; pipelineJobId?: string; message?: string } | null>(null)
  const [error, setError]   = useState('')

  const lineCount = urls.split('\n').filter(l => l.trim().startsWith('http')).length

  async function handleImport() {
    if (!urls.trim()) return
    setStatus('loading')
    setError('')
    setResult(null)
    try {
      const res = await importJobs(urls, candidateId)
      setResult(res)
      setStatus('success')
      if (res.imported > 0) {
        onImported?.(res.pipelineJobId ?? '', res.imported)
        // Persist so the Scorecard can show batch progress + filter to just
        // these jobs when the user navigates there.
        if (res.pipelineJobId && typeof window !== 'undefined') {
          sessionStorage.setItem(
            `proxim-import-${candidateId}`,
            JSON.stringify({ id: res.pipelineJobId, count: res.imported }),
          )
        }
      }
    } catch (e: unknown) {
      setError(extractErrorMessage(e))
      setStatus('error')
    }
  }

  function handleClose() {
    setOpen(false)
    setTimeout(() => {
      setUrls('')
      setStatus('idle')
      setResult(null)
      setError('')
    }, 300)
  }

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className="h-8 text-[11px] gap-1.5 border-border text-muted-foreground hover:text-white hover:border-border-strong"
        onClick={() => setOpen(true)}
      >
        <PlusCircle className="w-3.5 h-3.5" />
        {label}
      </Button>

      <Sheet open={open} onOpenChange={handleClose}>
        <SheetContent className="w-full sm:max-w-lg bg-background border-border text-foreground">
          <SheetHeader className="mb-4">
            <SheetTitle className="text-foreground">Add Jobs</SheetTitle>
            <SheetDescription className="text-muted-foreground text-xs">
              Paste one job URL per line. Supports LinkedIn and Naukri.
              Each job will be scraped, scored, and added to your Scorecard.
            </SheetDescription>
          </SheetHeader>

          {status !== 'success' ? (
            <div className="space-y-4">
              <Textarea
                value={urls}
                onChange={e => { setUrls(e.target.value); setStatus('idle') }}
                placeholder={
                  'https://www.linkedin.com/jobs/view/4415158878/\nhttps://www.linkedin.com/jobs/view/4398234521/\nhttps://www.naukri.com/job-listings-...'
                }
                rows={10}
                className="bg-card border-border text-foreground text-xs font-mono placeholder:text-muted-foreground resize-none"
              />

              <div className="flex items-center justify-between">
                <span className="text-[11px] text-muted-foreground">
                  {lineCount > 0 ? `${lineCount} URL${lineCount > 1 ? 's' : ''} detected` : 'Paste URLs above'}
                </span>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" className="text-[11px]" onClick={handleClose}>
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    className="text-[11px] bg-blue-600 hover:bg-blue-700 text-white"
                    onClick={handleImport}
                    disabled={lineCount === 0 || status === 'loading'}
                    isLoading={status === 'loading'}
                  >
                    Import & Score
                  </Button>
                </div>
              </div>

              {status === 'error' && (
                <div className="flex items-start gap-2 text-red-400 text-xs bg-red-950/20 border border-red-800/30 rounded-lg p-3">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  {error}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-start gap-3 bg-emerald-950/20 border border-emerald-800/30 rounded-lg p-4">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-emerald-300">
                    {result?.imported === 0
                      ? result?.message ?? 'No new jobs to import'
                      : `${result?.imported} job${(result?.imported ?? 0) > 1 ? 's' : ''} queued for import`}
                  </p>
                  {(result?.skipped ?? 0) > 0 && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {result?.skipped} URL{(result?.skipped ?? 0) > 1 ? 's' : ''} already in your Scorecard — skipped
                    </p>
                  )}
                  {(result?.imported ?? 0) > 0 && (
                    <>
                      <p className="text-xs text-muted-foreground mt-2">
                        The AI Agent is processing each URL, extracting the job description, and scoring it against your CV.
                        This usually takes 1–2 minutes per job.
                      </p>
                      <div className="mt-3 flex flex-col gap-2 text-[11px] text-muted-foreground">
                        <div className="flex items-center gap-1.5">
                          <span className="w-4 h-4 rounded-full bg-border flex items-center justify-center text-[9px] text-muted-foreground">1</span>
                          Scraping job pages — extracting title, company &amp; description
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="w-4 h-4 rounded-full bg-border flex items-center justify-center text-[9px] text-muted-foreground">2</span>
                          Scoring against your CV — 10-dimension analysis
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="w-4 h-4 rounded-full bg-border flex items-center justify-center text-[9px] text-muted-foreground">3</span>
                          Jobs appear in your Scorecard for review
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div className="flex gap-2 justify-between mt-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-[11px] text-muted-foreground"
                  onClick={() => { setStatus('idle'); setResult(null); setUrls('') }}
                >
                  + Add More
                </Button>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" className="text-[11px] border-border" onClick={handleClose}>
                    Stay here
                  </Button>
                  <Button
                    size="sm"
                    className="text-[11px] bg-blue-600 hover:bg-blue-700 text-white gap-1.5"
                    onClick={() => {
                      handleClose()
                      router.push(`/candidates/${candidateId}/pipeline`)
                    }}
                  >
                    Go to Scorecard
                    <ArrowRight className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Tips */}
          {status === 'idle' && lineCount === 0 && (
            <div className="mt-6 space-y-2">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Tips</p>
              <ul className="text-[11px] text-muted-foreground space-y-1.5">
                <li className="flex items-start gap-1.5">
                  <ExternalLink className="w-3 h-3 shrink-0 mt-0.5 text-muted-foreground" />
                  LinkedIn tracking params are stripped automatically
                </li>
                <li className="flex items-start gap-1.5">
                  <ExternalLink className="w-3 h-3 shrink-0 mt-0.5 text-muted-foreground" />
                  Duplicate URLs (already in your Scorecard) are skipped
                </li>
                <li className="flex items-start gap-1.5">
                  <ExternalLink className="w-3 h-3 shrink-0 mt-0.5 text-muted-foreground" />
                  Maximum 50 URLs per import
                </li>
              </ul>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </>
  )
}
