'use client'

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { DownloadIcon } from 'lucide-react'

interface Props {
  jobId: string
  type: 'resume' | 'cover-letter'
  candidateName?: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

// Renders the latest resume or cover letter PDF inline in a right-side Sheet
// using an <iframe>. A Download button at the top triggers a browser download
// of the same file. Both operations hit /api/jobs/{jobId}/resume/latest-pdf —
// ?download=true forces attachment disposition; omitting it uses inline.
export function PdfPreviewSheet({ jobId, type, candidateName, open, onOpenChange }: Props) {
  const baseUrl = `/api/jobs/${jobId}/resume/latest-pdf?type=${type}`
  const previewUrl = baseUrl
  const downloadUrl = `${baseUrl}&download=true`
  const title = type === 'cover-letter' ? 'Cover Letter' : 'Resume'
  const filename = type === 'cover-letter' ? 'cover_letter.pdf' : 'resume.pdf'

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="bg-[#060d1f] border-l border-[#1e2d4a] flex flex-col gap-0 p-0 sm:max-w-2xl w-full"
      >
        <SheetHeader className="border-b border-[#1e2d4a] px-5 py-4 flex-row items-center justify-between flex-shrink-0">
          <div>
            <SheetTitle className="text-[#f1f5f9] text-sm">{title}</SheetTitle>
            {candidateName && (
              <p className="text-[11px] text-[#475569] mt-0.5">{candidateName}</p>
            )}
          </div>
          <Button
            asChild
            size="sm"
            variant="outline"
            className="border-[#1e2d4a] text-[#93c5fd] gap-1.5 mr-8"
          >
            <a href={downloadUrl} download={filename}>
              <DownloadIcon className="w-3 h-3" />
              Download
            </a>
          </Button>
        </SheetHeader>

        {/* PDF viewer — the iframe requests the file with inline disposition so
            the browser renders it rather than triggering a download. */}
        <div className="flex-1 overflow-hidden">
          {open && (
            <iframe
              src={previewUrl}
              title={title}
              className="w-full h-full border-0"
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
