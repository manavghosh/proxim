'use client'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { ChevronDown } from 'lucide-react'

export type SourceFilter = 'all' | 'imported' | 'discovered'

interface SourceFilterControlProps {
  value: SourceFilter
  onChange: (source: SourceFilter) => void
  counts?: Partial<Record<SourceFilter, number>>
}

const SOURCE_LABELS: Record<SourceFilter, string> = {
  all: 'All sources',
  imported: 'Manual search',
  discovered: 'AI based search',
}

export function SourceFilterControl({ value, onChange, counts }: SourceFilterControlProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-2 border-border bg-card text-muted-foreground hover:border-border-strong hover:text-foreground"
        >
          <span className="text-muted-foreground text-[10px] font-semibold uppercase tracking-wider">Source</span>
          <span className="text-foreground">{SOURCE_LABELS[value]}</span>
          <ChevronDown className="size-3 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {(Object.keys(SOURCE_LABELS) as SourceFilter[]).map(opt => (
          <DropdownMenuItem
            key={opt}
            onClick={() => onChange(opt)}
            className={`text-[11px] cursor-pointer gap-2 ${
              value === opt ? 'text-primary' : 'text-foreground'
            }`}
          >
            <span className="flex-1">{SOURCE_LABELS[opt]}</span>
            {counts?.[opt] !== undefined && (
              <span className="text-[10px] text-muted-foreground">{counts[opt]}</span>
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
