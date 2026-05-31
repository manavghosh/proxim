'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { LayoutDashboard, Workflow, Send, Settings, Users } from 'lucide-react'
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
} from '@/components/ui/command'
import { getCandidates, type CandidateSummary } from '@/lib/api'
import { CandidateAvatar } from '@/components/shared/CandidateAvatar'

const SECTIONS = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { key: 'pipeline', label: 'Scorecard', icon: Workflow },
  { key: 'applications', label: 'Applications', icon: Send },
  { key: 'settings', label: 'Settings', icon: Settings },
] as const

/**
 * Global ⌘K / Ctrl-K command palette. Mounted once in the root layout so it is
 * available on every screen. Jumps between candidates and the sections of the
 * current candidate, and back to the roster.
 */
export function CommandMenu() {
  const router = useRouter()
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [candidates, setCandidates] = useState<CandidateSummary[]>([])
  const [loaded, setLoaded] = useState(false)

  // Toggle on ⌘K / Ctrl-K
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  // Lazy-load candidates the first time the palette opens
  useEffect(() => {
    if (!open || loaded) return
    getCandidates()
      .then(({ candidates }) => setCandidates(candidates))
      .catch(() => setCandidates([]))
      .finally(() => setLoaded(true))
  }, [open, loaded])

  const match = pathname.match(/\/candidates\/([^/]+)\/([^/?#]+)/)
  const currentId = match?.[1] ?? null

  const run = useCallback(
    (path: string) => {
      setOpen(false)
      router.push(path)
    },
    [router]
  )

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Search candidates, jump to a section…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        {currentId && (
          <>
            <CommandGroup heading="Go to">
              {SECTIONS.map(({ key, label, icon: Icon }) => (
                <CommandItem
                  key={key}
                  value={`go ${label}`}
                  onSelect={() => run(`/candidates/${currentId}/${key}`)}
                >
                  <Icon />
                  {label}
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        <CommandGroup heading="Candidates">
          {candidates.map((c) => (
            <CommandItem
              key={c.id}
              value={`candidate ${c.name}`}
              onSelect={() => run(`/candidates/${c.id}/dashboard`)}
            >
              <CandidateAvatar name={c.name} avatarData={c.avatarData} size="sm" />
              <span className="flex-1 truncate">{c.name}</span>
              {c.id === currentId && (
                <span className="text-[10px] text-muted-foreground">current</span>
              )}
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Pages">
          <CommandItem value="all candidates roster" onSelect={() => run('/')}>
            <Users />
            All Candidates
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
