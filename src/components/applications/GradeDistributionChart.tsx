'use client'

import { Bar, BarChart, Cell, XAxis, YAxis } from 'recharts'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import type { GradeDistribution } from '@/types/candidate'

interface GradeDistributionChartProps {
  distribution: GradeDistribution
}

const GRADE_COLORS: Record<string, string> = {
  A: '#22c55e',
  B: '#3b82f6',
  C: '#f59e0b',
  D: '#f97316',
  E: '#ef4444',
  F: '#b91c1c',
}

const chartConfig: ChartConfig = {
  count: { label: 'Jobs' },
  A: { label: 'A', color: GRADE_COLORS.A },
  B: { label: 'B', color: GRADE_COLORS.B },
  C: { label: 'C', color: GRADE_COLORS.C },
  D: { label: 'D', color: GRADE_COLORS.D },
  E: { label: 'E', color: GRADE_COLORS.E },
  F: { label: 'F', color: GRADE_COLORS.F },
}

export function GradeDistributionChart({ distribution }: GradeDistributionChartProps) {
  const data = (['A', 'B', 'C', 'D', 'E', 'F'] as const).map(grade => ({
    grade,
    count: distribution[grade],
    fill: GRADE_COLORS[grade],
  }))

  return (
    <ChartContainer config={chartConfig} className="h-[160px] w-full">
      <BarChart accessibilityLayer data={data} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
        <XAxis
          dataKey="grade"
          tickLine={false}
          axisLine={false}
          tick={{ fill: '#64748b', fontSize: 11 }}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tick={{ fill: '#64748b', fontSize: 10 }}
          allowDecimals={false}
        />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar dataKey="count" radius={[3, 3, 0, 0]}>
          {data.map((entry) => (
            <Cell key={entry.grade} fill={entry.fill} />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  )
}
