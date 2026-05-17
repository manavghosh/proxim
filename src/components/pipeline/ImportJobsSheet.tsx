'use client'

import { useState } from 'react'
import { PlusCircle, ExternalLink, CheckCircle2, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { importJobs } from '@/lib/api'

interface Props {
  candidateId: string
  onImported?: () => void
}

type Status = 'idle' | 'loading' | 'success' | 'error'

export function ImportJobsSheet({ candidateId, onImported }: Props) {
  const [open, setOpen]     = useState(false)
  const [urls, setUrls]     = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [result, setResult] = useState<{ imported: number; skipped: number; message?: string } | null>(null)
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
      if (res.imported > 0) onImported?.()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Import failed')
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
        className="h-8 text-[11px] gap-1.5 border-[#1e2d4a] text-[#94a3b8] hover:text-white hover:border-[#334155]"
        onClick={() => setOpen(true)}
      >
        <PlusCircle className="w-3.5 h-3.5" />
        Import Jobs
      </Button>

      <Sheet open={open} onOpenChange={handleClose}>
        <SheetContent className="w-full sm:max-w-lg bg-[#0d1829] border-[#1e2d4a] text-[#e2e8f0]">
          <SheetHeader className="mb-4">
            <SheetTitle className="text-[#e2e8f0]">Import Jobs</SheetTitle>
            <SheetDescription className="text-[#64748b] text-xs">
              Paste one job URL per line. Supports LinkedIn and Naukri.
              Each job will be scraped, scored, and added to your pipeline.
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
                className="bg-[#0d1f3c] border-[#1e2d4a] text-[#e2e8f0] text-xs font-mono placeholder:text-[#334155] resize-none"
              />

              <div className="flex items-center justify-between">
                <span className="text-[11px] text-[#475569]">
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
                    <p className="text-xs text-[#64748b] mt-1">
                      {result?.skipped} URL{(result?.skipped ?? 0) > 1 ? 's' : ''} already in your pipeline — skipped
                    </p>
                  )}
                  {(result?.imported ?? 0) > 0 && (
                    <p className="text-xs text-[#64748b] mt-2">
                      The daemon will scrape each job, extract the description, and score it.
                      Jobs will appear in the Pipeline review queue once scored — usually within a minute.
                    </p>
                  )}
                </div>
              </div>

              <div className="flex gap-2 justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  className="text-[11px] border-[#1e2d4a]"
                  onClick={() => { setStatus('idle'); setResult(null); setUrls('') }}
                >
                  Import More
                </Button>
                <Button size="sm" className="text-[11px]" onClick={handleClose}>
                  Done
                </Button>
              </div>
            </div>
          )}

          {/* Tips */}
          {status === 'idle' && lineCount === 0 && (
            <div className="mt-6 space-y-2">
              <p className="text-[10px] font-semibold text-[#334155] uppercase tracking-wider">Tips</p>
              <ul className="text-[11px] text-[#475569] space-y-1.5">
                <li className="flex items-start gap-1.5">
                  <ExternalLink className="w-3 h-3 shrink-0 mt-0.5 text-[#334155]" />
                  LinkedIn tracking params are stripped automatically
                </li>
                <li className="flex items-start gap-1.5">
                  <ExternalLink className="w-3 h-3 shrink-0 mt-0.5 text-[#334155]" />
                  Duplicate URLs (already in your pipeline) are skipped
                </li>
                <li className="flex items-start gap-1.5">
                  <ExternalLink className="w-3 h-3 shrink-0 mt-0.5 text-[#334155]" />
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
