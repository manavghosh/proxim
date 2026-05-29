'use client'

import * as React from 'react'
import { ChevronDownIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuCheckboxItem,
  DropdownMenuGroup,
} from '@/components/ui/dropdown-menu'

import { GRADE_COLOR, GRADE_BG } from '@/lib/grade-colors'

export const ALL_GRADES = ['A', 'B', 'C', 'D', 'E', 'F'] as const
export type Grade = typeof ALL_GRADES[number]

const GRADE_LABEL: Record<Grade, string> = {
  A: 'A — Excellent match',
  B: 'B — Good match',
  C: 'C — Moderate match',
  D: 'D — Weak match',
  E: 'E — Poor match',
  F: 'F — Reject (gate fail)',
}
const GRADE_META: Record<Grade, { color: string; bg: string; label: string }> = Object.fromEntries(
  ALL_GRADES.map((g) => [g, { color: GRADE_COLOR[g], bg: GRADE_BG[g], label: GRADE_LABEL[g] }])
) as Record<Grade, { color: string; bg: string; label: string }>

interface Props {
  selected: Grade[]
  onChange: (grades: Grade[]) => void
  counts: Partial<Record<Grade, number>>
}

export function GradeFilterDropdown({ selected, onChange, counts }: Props) {
  const selectedSet = new Set(selected)

  const toggle = (grade: Grade) => {
    if (selectedSet.has(grade)) {
      onChange(selected.filter((g) => g !== grade))
    } else {
      onChange([...selected, grade].sort((a, b) => ALL_GRADES.indexOf(a) - ALL_GRADES.indexOf(b)))
    }
  }

  const triggerLabel = () => {
    if (selected.length === 0) return 'No grades'
    if (selected.length === ALL_GRADES.length) return 'All grades'
    return selected.join(', ')
  }

  return (
    <div className="flex items-center gap-3">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="gap-2 border-border bg-card text-muted-foreground hover:border-border-strong hover:text-foreground"
          >
            <span className="text-muted-foreground text-[10px] font-semibold uppercase tracking-wider">Grade</span>
            <span className="text-foreground">{triggerLabel()}</span>
            <ChevronDownIcon className="size-3 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent className="w-52" align="start">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Filter by grade</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {ALL_GRADES.map((grade) => {
              const meta = GRADE_META[grade]
              const count = counts[grade] ?? 0
              return (
                <DropdownMenuCheckboxItem
                  key={grade}
                  checked={selectedSet.has(grade)}
                  onCheckedChange={() => toggle(grade)}
                  className="gap-3"
                >
                  <span
                    className="flex size-5 shrink-0 items-center justify-center rounded font-bold text-[11px]"
                    style={{ color: meta.color, background: meta.bg }}
                  >
                    {grade}
                  </span>
                  <span className="flex-1 text-foreground">{meta.label.split('—')[1].trim()}</span>
                  {count > 0 && (
                    <span className="text-[10px] text-muted-foreground">{count}</span>
                  )}
                </DropdownMenuCheckboxItem>
              )
            })}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <div className="flex gap-1 px-1 pb-1">
            <Button
              variant="ghost"
              size="sm"
              className="flex-1 text-[10px] h-7 text-muted-foreground"
              onClick={() => onChange([...ALL_GRADES])}
            >
              All
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="flex-1 text-[10px] h-7 text-muted-foreground"
              onClick={() => onChange([])}
            >
              None
            </Button>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Grade pills showing live counts */}
      <div className="flex items-center gap-1.5">
        {ALL_GRADES.filter((g) => selectedSet.has(g) && (counts[g] ?? 0) > 0).map((grade) => {
          const meta = GRADE_META[grade]
          return (
            <Badge
              key={grade}
              className="gap-1 text-[10px] font-semibold border-transparent"
              style={{ color: meta.color, background: meta.bg }}
            >
              {grade}
              <span className="font-normal opacity-75">{counts[grade]}</span>
            </Badge>
          )
        })}
        <span className="text-[10px] text-muted-foreground">
          {Object.values(counts).reduce((a, b) => a + (b ?? 0), 0)} shown
        </span>
      </div>
    </div>
  )
}
