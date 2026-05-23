'use client'

import { Card, CardContent } from '@/components/ui/card'

interface MetricCardProps {
  label: string
  value: number | null
  unit?: '%' | ''
}

export function MetricCard({ label, value, unit = '' }: MetricCardProps) {
  const display = value === null ? '—' : `${value}${unit}`

  return (
    <Card className="bg-[#0d1f3c] border-[#1e2d4a]">
      <CardContent className="p-4">
        <p className="text-[11px] text-[#64748b] uppercase tracking-wide mb-1">{label}</p>
        <p className="text-2xl font-bold text-[#e2e8f0]">{display}</p>
      </CardContent>
    </Card>
  )
}
