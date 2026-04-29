interface StatCardProps {
  label: string
  value: string
  sub: string
  dotColor?: string
}

export function StatCard({ label, value, sub, dotColor }: StatCardProps) {
  return (
    <div className="bg-[#0d1f3c] border border-[#1e3a5f] rounded-xl p-4">
      <p className="text-[11px] font-medium text-[#60a5fa] tracking-wide mb-2">
        {label}
      </p>
      <p className="text-2xl font-bold text-[#f1f5f9] mb-1">{value}</p>
      <p className="text-[10px] text-[#475569] flex items-center gap-1.5">
        {dotColor && (
          <span
            className="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0"
            style={{ background: dotColor }}
          />
        )}
        {sub}
      </p>
    </div>
  )
}
