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
      <div className="bg-card border border-border-strong rounded-xl p-5">
        <p className="text-[12px] text-muted-foreground">
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
    <div className="bg-card border border-border-strong rounded-xl p-5">
      {items.length === 0 ? (
        <p className="text-[12px] text-muted-foreground">
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
                <p className="text-[12px] text-muted-foreground">{item.text}</p>
                {item.time && (
                  <p className="text-[10px] text-muted-foreground">{item.time}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
