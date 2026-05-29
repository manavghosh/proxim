'use client'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { ChevronDown } from 'lucide-react'

type SortOption = 'score' | 'date' | 'company'

interface PipelineSortControlProps {
  value: SortOption
  onChange: (sort: SortOption) => void
}

const SORT_LABELS: Record<SortOption, string> = {
  score: 'Score (highest first)',
  date: 'Posted Date (newest)',
  company: 'Company (A–Z)',
}

export function PipelineSortControl({ value, onChange }: PipelineSortControlProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-[11px] px-3 border-border bg-muted text-muted-foreground hover:bg-card gap-1"
        >
          Sort: {SORT_LABELS[value]}
          <ChevronDown className="w-3 h-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="bg-muted border-border" align="end">
        {(Object.keys(SORT_LABELS) as SortOption[]).map(opt => (
          <DropdownMenuItem
            key={opt}
            onClick={() => onChange(opt)}
            className={`text-[11px] cursor-pointer ${
              value === opt ? 'text-primary' : 'text-muted-foreground'
            }`}
          >
            {SORT_LABELS[opt]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
