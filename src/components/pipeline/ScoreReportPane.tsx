'use client'

import { Button } from '@/components/ui/button'
import { MarkdownReport } from '@/components/ui/markdown-report'
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
        className="text-[11px] text-muted-foreground hover:text-muted-foreground px-0 h-auto gap-1"
        data-testid="report-toggle"
      >
        {isOpen ? (
          <>Hide Report <ChevronUp className="w-3 h-3" /></>
        ) : (
          <>View Report <ChevronDown className="w-3 h-3" /></>
        )}
      </Button>

      {isOpen && (
        <div className="mt-2 p-3 rounded-md bg-background border border-border max-h-80 overflow-y-auto">
          <MarkdownReport content={reportMd} />
        </div>
      )}
    </div>
  )
}
