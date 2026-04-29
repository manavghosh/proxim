import Link from 'next/link'
import type { CandidateState } from '@/types/candidate'

interface ProfileCardProps {
  candidate: CandidateState | null
}

function initials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

const STATUS_STYLE: Record<string, string> = {
  ready: 'bg-[#064e3b] text-[#6ee7b7]',
  parsing: 'bg-[#1e3a5f] text-[#60a5fa]',
  pending: 'bg-[#1e2d4a] text-[#475569]',
  failed: 'bg-[#450a0a] text-[#fca5a5]',
}

const STATUS_LABEL: Record<string, string> = {
  ready: 'Parsed',
  parsing: 'Parsing…',
  pending: 'Pending',
  failed: 'Parse failed',
}

export function ProfileCard({ candidate }: ProfileCardProps) {
  if (!candidate?.parsedProfile) {
    return (
      <div className="bg-[#0d1f3c] border border-[#1e3a5f] rounded-xl p-5 flex flex-col items-center justify-center min-h-[240px] gap-3 text-center">
        <div className="w-12 h-12 rounded-xl bg-[#0a1835] border border-[#1e3a5f] flex items-center justify-center text-2xl text-[#334155]">
          ?
        </div>
        <p className="text-[12px] text-[#475569] max-w-[180px]">
          Upload your CV in Settings to populate your profile.
        </p>
        <Link
          href="/settings"
          className="text-[11px] text-[#3b82f6] hover:text-[#60a5fa] transition-colors"
        >
          Go to Settings →
        </Link>
      </div>
    )
  }

  const { parsedProfile, preferences, parseStatus } = candidate
  const name = parsedProfile.name || 'Unknown'
  const topRole = parsedProfile.roles?.[0]
  const topSkills = parsedProfile.skills?.slice(0, 6) ?? []
  const seniorityLevels = (preferences?.seniority_levels ?? []) as string[]
  const geoPrefs = (preferences?.geographic_preference as string[] | undefined) ?? []

  return (
    <div className="bg-[#0d1f3c] border border-[#1e3a5f] rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-[13px] font-semibold text-[#e2e8f0]">Profile</h2>
        <span
          className={`text-[10px] font-medium px-2.5 py-0.5 rounded-full ${STATUS_STYLE[parseStatus]}`}
        >
          {STATUS_LABEL[parseStatus]}
        </span>
      </div>

      {/* Avatar + name */}
      <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-700 to-indigo-700 flex items-center justify-center text-white font-bold text-lg mb-3">
        {initials(name)}
      </div>
      <p className="text-[15px] font-bold text-[#f1f5f9] mb-0.5">{name}</p>
      {topRole && (
        <p className="text-[11px] text-[#60a5fa] mb-4">
          {topRole.title} · {topRole.company}
        </p>
      )}

      <div className="h-px bg-[#1e2d4a] my-3" />

      {/* Skills */}
      {topSkills.length > 0 && (
        <>
          <p className="text-[9px] font-semibold text-[#334155] tracking-widest uppercase mb-2">
            Top Skills
          </p>
          <div className="flex flex-wrap gap-1 mb-4">
            {topSkills.map((skill) => (
              <span
                key={skill}
                className="text-[10px] bg-[#0a1835] border border-[#1e3a5f] text-[#93c5fd] px-2 py-0.5 rounded"
              >
                {skill}
              </span>
            ))}
          </div>
          <div className="h-px bg-[#1e2d4a] my-3" />
        </>
      )}

      {/* Target roles */}
      {seniorityLevels.length > 0 && (
        <>
          <p className="text-[9px] font-semibold text-[#334155] tracking-widest uppercase mb-2">
            Target Roles
          </p>
          <div className="flex flex-wrap gap-1 mb-4">
            {seniorityLevels.map((level) => (
              <span
                key={level}
                className="text-[10px] bg-[#0a1835] border border-[#1d4ed8] text-[#93c5fd] px-2 py-0.5 rounded"
              >
                {level}
              </span>
            ))}
          </div>
          <div className="h-px bg-[#1e2d4a] my-3" />
        </>
      )}

      {/* Geo */}
      {geoPrefs.length > 0 && (
        <>
          <p className="text-[9px] font-semibold text-[#334155] tracking-widest uppercase mb-1">
            Location
          </p>
          <div className="flex flex-wrap gap-1">
            {geoPrefs.map((g) => (
              <span key={g} className="text-[10px] bg-[#0a1835] border border-[#1e3a5f] text-[#94a3b8] px-2 py-0.5 rounded">
                {g}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
