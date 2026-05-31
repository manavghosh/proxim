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
    <Card className="bg-background border-border">
      <CardContent className="p-4">
        <p className="text-[11px] text-muted-foreground uppercase tracking-wide mb-1">{label}</p>
        <p className="text-2xl font-bold text-foreground">{display}</p>
      </CardContent>
    </Card>
  )
}
