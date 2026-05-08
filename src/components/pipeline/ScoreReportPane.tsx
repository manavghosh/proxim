'use client'

import { Button } from '@/components/ui/button'
import { ChevronDown, ChevronUp } from 'lucide-react'

interface ScoreReportPaneProps {
  reportMd: string | null
  isOpen: boolean
  onToggle: () => void
}

export function ScoreReportPane({ reportMd, isOpen, onToggle }: ScoreReportPaneProps) {
  if (!reportMd) return null

  return (
    <div className="mt-3">
      <Button
        variant="ghost"
        size="sm"
        onClick={onToggle}
        className="text-[11px] text-[#64748b] hover:text-[#94a3b8] px-0 h-auto gap-1"
        data-testid="report-toggle"
      >
        {isOpen ? (
          <>Hide Report <ChevronUp className="w-3 h-3" /></>
        ) : (
          <>View Report <ChevronDown className="w-3 h-3" /></>
        )}
      </Button>

      {isOpen && (
        <div className="mt-2 p-3 rounded-md bg-[#080f1e] border border-[#1e2d4a] max-h-80 overflow-y-auto">
          <pre className="text-[11px] text-[#94a3b8] whitespace-pre-wrap font-mono leading-relaxed">
            {reportMd}
          </pre>
        </div>
      )}
    </div>
  )
}
