import type { CandidateState } from '@/types/candidate'

interface ActivityFeedProps {
  candidate: CandidateState | null
}

const DOT: Record<string, string> = {
  green: '#10b981',
  blue: '#3b82f6',
  amber: '#f59e0b',
}

interface ActivityItem {
  text: string
  color: keyof typeof DOT
  time?: string
}

export function ActivityFeed({ candidate }: ActivityFeedProps) {
  if (!candidate) {
    return (
      <div className="bg-[#0d1f3c] border border-[#1e3a5f] rounded-xl p-5">
        <h2 className="text-[13px] font-semibold text-[#e2e8f0] mb-3">
          Recent Activity
        </h2>
        <p className="text-[12px] text-[#475569]">
          No activity yet — start by uploading your CV.
        </p>
      </div>
    )
  }

  const items: ActivityItem[] = []

  if (candidate.parseStatus === 'ready') {
    items.push({ text: 'Profile parsed successfully', color: 'green', time: 'recently' })
  } else if (candidate.parseStatus === 'parsing') {
    items.push({ text: 'CV parsing in progress…', color: 'amber' })
  } else if (candidate.parseStatus === 'failed') {
    items.push({ text: 'CV parse failed — try re-uploading', color: 'amber' })
  }

  if (Object.keys(candidate.preferences ?? {}).length > 0) {
    items.push({ text: 'Preferences updated', color: 'blue' })
  }

  if (candidate.baseCvMd) {
    items.push({ text: 'CV saved', color: 'amber', time: 'recently' })
  }

  return (
    <div className="bg-[#0d1f3c] border border-[#1e3a5f] rounded-xl p-5">
      <h2 className="text-[13px] font-semibold text-[#e2e8f0] mb-4">
        Recent Activity
      </h2>

      {items.length === 0 ? (
        <p className="text-[12px] text-[#475569]">
          No activity yet — start by uploading your CV.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((item, i) => (
            <div key={i} className="flex items-start gap-2.5">
              <span
                className="w-2 h-2 rounded-full mt-1 flex-shrink-0"
                style={{ background: DOT[item.color] }}
              />
              <div>
                <p className="text-[12px] text-[#94a3b8]">{item.text}</p>
                {item.time && (
                  <p className="text-[10px] text-[#334155]">{item.time}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
