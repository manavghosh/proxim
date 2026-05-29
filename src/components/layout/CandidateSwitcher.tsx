'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { ChevronDownIcon } from 'lucide-react'
import { CandidateAvatar } from '@/components/shared/CandidateAvatar'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { getCandidates, type CandidateSummary } from '@/lib/api'

interface Props {
  candidateId: string
}

// Always renders the candidate's name in the topbar so the operator can see at
// a glance whose dashboard / pipeline / applications / settings they're on.
// When there are 2+ candidates it doubles as a quick-switcher to the same
// section under another candidate's id.
export function CandidateSwitcher({ candidateId }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const [candidates, setCandidates] = useState<CandidateSummary[] | null>(null)

  useEffect(() => {
    getCandidates()
      .then(({ candidates: list }) => setCandidates(list))
      .catch(() => setCandidates([]))
  }, [])

  // Pull the current section out of the URL so switching candidates keeps the
  // same page (dashboard → dashboard, settings → settings, etc.).
  const section = pathname.match(/\/candidates\/[^/]+\/([^/?#]+)/)?.[1] ?? 'dashboard'

  const current = candidates?.find((c) => c.id === candidateId)
  const currentName = current?.name ?? 'Candidate'
  const hasMultiple = (candidates?.length ?? 0) > 1

  const trigger = (
    <button
      type="button"
      className={`flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors focus:outline-none ${
        hasMultiple
          ? 'hover:border-border-strong hover:text-foreground cursor-pointer'
          : 'cursor-default'
      }`}
      aria-label={`Current candidate: ${currentName}`}
    >
      <CandidateAvatar name={currentName} avatarData={current?.avatarData} size="sm" />
      <span className="text-foreground max-w-[160px] truncate">{currentName}</span>
      {hasMultiple && <ChevronDownIcon className="size-3 text-muted-foreground" />}
    </button>
  )

  if (!hasMultiple) return trigger

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent className="w-56" align="end">
        <DropdownMenuLabel>Switch Candidate</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {candidates?.map((c) => (
          <DropdownMenuItem
            key={c.id}
            onClick={() => router.push(`/candidates/${c.id}/${section}`)}
            className={c.id === candidateId ? 'text-primary' : ''}
          >
            <CandidateAvatar name={c.name} avatarData={c.avatarData} size="sm" className="mr-1.5" />
            <span className="flex-1 truncate">{c.name}</span>
            {c.id === candidateId && (
              <span className="text-[10px] text-muted-foreground ml-2">current</span>
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
