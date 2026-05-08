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
          className="h-7 text-[11px] px-3 border-[#1e2d4a] bg-[#0d1829] text-[#94a3b8] hover:bg-[#0d1f3c] gap-1"
        >
          Sort: {SORT_LABELS[value]}
          <ChevronDown className="w-3 h-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="bg-[#0d1829] border-[#1e2d4a]" align="end">
        {(Object.keys(SORT_LABELS) as SortOption[]).map(opt => (
          <DropdownMenuItem
            key={opt}
            onClick={() => onChange(opt)}
            className={`text-[11px] cursor-pointer ${
              value === opt ? 'text-[#93c5fd]' : 'text-[#94a3b8]'
            }`}
          >
            {SORT_LABELS[opt]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
