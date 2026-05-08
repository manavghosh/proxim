'use client'

import { Button } from '@/components/ui/button'

type FilterOption = 'A' | 'A+B' | 'all'

interface PipelineFilterBarProps {
  value: FilterOption
  onChange: (filter: FilterOption) => void
}

const OPTIONS: { label: string; value: FilterOption }[] = [
  { label: 'A only', value: 'A' },
  { label: 'A + B', value: 'A+B' },
  { label: 'All (C/D)', value: 'all' },
]

export function PipelineFilterBar({ value, onChange }: PipelineFilterBarProps) {
  return (
    <div className="flex items-center gap-1 bg-[#0d1829] rounded-md p-0.5">
      {OPTIONS.map(opt => (
        <Button
          key={opt.value}
          size="sm"
          variant={value === opt.value ? 'default' : 'ghost'}
          className={`h-7 text-[11px] px-3 ${
            value === opt.value
              ? 'bg-[#1d4ed8] text-white'
              : 'text-[#64748b] hover:text-[#94a3b8]'
          }`}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </Button>
      ))}
    </div>
  )
}
