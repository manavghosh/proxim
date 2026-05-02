'use client'

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { getJobReport } from '@/lib/api'

interface Props {
  jobId: string | null
  onClose: () => void
}

export function ReportDrawer({ jobId, onClose }: Props) {
  const [report, setReport] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!jobId) { setReport(null); return }
    setLoading(true)
    getJobReport(jobId)
      .then((r) => setReport(r.reportMd))
      .catch(() => setReport('Failed to load report.'))
      .finally(() => setLoading(false))
  }, [jobId])

  if (!jobId) return null

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/30"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl h-full bg-[#060d1f] border-l border-[#1e2d4a] overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-[#e2e8f0] font-semibold text-sm">Score Report</h2>
          <button
            onClick={onClose}
            className="text-[#475569] hover:text-[#94a3b8] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        {loading ? (
          <p className="text-[#475569] text-sm">Loading report…</p>
        ) : (
          <pre className="whitespace-pre-wrap text-xs font-mono text-[#94a3b8] leading-relaxed">
            {report ?? 'No report available.'}
          </pre>
        )}
      </div>
    </div>
  )
}
