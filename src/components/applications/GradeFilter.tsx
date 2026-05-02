'use client'

interface Props {
  value: 'A' | 'A+B' | 'all'
  onChange: (v: 'A' | 'A+B' | 'all') => void
  counts: { A: number; B: number; total: number }
}

const OPTIONS: Array<{ label: string; value: 'A' | 'A+B' | 'all' }> = [
  { label: 'A only', value: 'A' },
  { label: 'A + B',  value: 'A+B' },
  { label: 'All',    value: 'all' },
]

export function GradeFilter({ value, onChange, counts }: Props) {
  return (
    <div className="flex items-center gap-1 bg-[#0d1f3c] border border-[#1e2d4a] rounded-lg p-1">
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
            value === opt.value
              ? 'bg-[#1e3a5f] text-[#e2e8f0]'
              : 'text-[#475569] hover:text-[#94a3b8]'
          }`}
        >
          {opt.label}
        </button>
      ))}
      <span className="ml-2 text-[10px] text-[#334155]">
        {counts.A}A · {counts.B}B · {counts.total} shown
      </span>
    </div>
  )
}
