import Link from 'next/link'
import type { CandidateState } from '@/types/candidate'
import { CandidateAvatar } from '@/components/shared/CandidateAvatar'

interface ProfileCardProps {
  candidate: CandidateState | null
  candidateId: string
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

export function ProfileCard({ candidate, candidateId }: ProfileCardProps) {
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
          href={`/candidates/${candidateId}/settings`}
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
  const rawGeo = preferences?.geographic_preference
  const geoPrefs: string[] = Array.isArray(rawGeo)
    ? rawGeo
    : typeof rawGeo === 'string' && rawGeo
      ? [rawGeo]
      : []

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
      <CandidateAvatar name={name} avatarData={candidate?.avatarData} size="lg" className="rounded-xl mb-3" />
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
          <p className="text-[9px] font-semibold text-[#475569] tracking-widest uppercase mb-2">
            Top Skills
          </p>
          <div className="flex flex-wrap gap-1.5 mb-4">
            {topSkills.map((skill) => (
              <span
                key={skill}
                className="text-[10px] bg-teal-950/60 border border-teal-800/30 text-teal-300 px-2 py-0.5 rounded-md"
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
          <p className="text-[9px] font-semibold text-[#475569] tracking-widest uppercase mb-2">
            Target Roles
          </p>
          <div className="flex flex-wrap gap-1.5 mb-4">
            {seniorityLevels.map((level) => (
              <span
                key={level}
                className="text-[10px] bg-violet-950/60 border border-violet-700/30 text-violet-300 px-2 py-0.5 rounded-md"
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
          <p className="text-[9px] font-semibold text-[#475569] tracking-widest uppercase mb-1">
            Location
          </p>
          <div className="flex flex-wrap gap-1.5">
            {geoPrefs.map((g) => (
              <span key={g} className="text-[10px] bg-sky-950/40 border border-sky-700/20 text-sky-200/80 px-2 py-0.5 rounded-md">
                {g}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
