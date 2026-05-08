'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { getCV, getReadiness, reparseCV, getCandidates } from '@/lib/api'
import type { CandidateSummary } from '@/lib/api'
import { Topbar } from '@/components/layout/Topbar'
import { CVUploader } from '@/components/cv/CVUploader'
import { MarkdownEditor } from '@/components/cv/MarkdownEditor'
import { ParseStatusBadge } from '@/components/cv/ParseStatusBadge'
import { PreferencesForm } from '@/components/preferences/PreferencesForm'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { ChevronDownIcon, UsersIcon } from 'lucide-react'
import type { CandidateState, Preferences, PipelineReadiness } from '@/types/candidate'

export default function SettingsPage() {
  const { id: candidateId } = useParams<{ id: string }>()
  const router = useRouter()

  const [candidate, setCandidate]                 = useState<CandidateState | null>(null)
  const [readiness, setReadiness]                 = useState<PipelineReadiness | null>(null)
  const [convertedMarkdown, setConvertedMarkdown] = useState<string | null>(null)
  const [loading, setLoading]                     = useState(true)
  const [reparsing, setReparsing]                 = useState(false)
  const [reparseError, setReparseError]           = useState<string | null>(null)
  const [allCandidates, setAllCandidates]         = useState<CandidateSummary[]>([])

  async function refresh() {
    const [cv, r] = await Promise.all([getCV(candidateId), getReadiness(candidateId)])
    setCandidate(cv)
    setReadiness(r)
  }

  useEffect(() => {
    setLoading(true)
    setConvertedMarkdown(null)
    refresh().finally(() => setLoading(false))
  }, [candidateId])

  useEffect(() => {
    getCandidates().then(({ candidates }) => setAllCandidates(candidates)).catch(() => {})
  }, [])

  async function handleReparse() {
    setReparseError(null)
    setReparsing(true)
    try {
      const updated = await reparseCV(candidateId)
      setCandidate(updated)
    } catch (e) {
      setReparseError(e instanceof Error ? e.message : 'Re-parse failed. Try again.')
    } finally {
      setReparsing(false)
    }
  }

  function handleCVSaved(updated: CandidateState) {
    setCandidate(updated)
    setConvertedMarkdown(null)
    void refresh()
  }

  function handlePreferencesSaved(prefs: Preferences) {
    setCandidate(prev => prev ? { ...prev, preferences: prefs } : prev)
    void refresh()
  }

  if (loading) {
    return (
      <div className="flex flex-col flex-1 overflow-hidden">
        <Topbar title="Settings" />
        <div className="flex-1 flex items-center justify-center bg-[#0d1829]">
          <p className="text-[#475569] text-sm">Loading…</p>
        </div>
      </div>
    )
  }

  const markdownToEdit = convertedMarkdown ?? candidate?.baseCvMd

  const currentName = candidate?.name ?? allCandidates.find(c => c.id === candidateId)?.name ?? 'Candidate'

  const switcher = allCandidates.length > 1 ? (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-2 rounded-lg border border-[#1e2d4a] bg-[#0d1f3c] px-3 py-1.5 text-xs font-medium text-[#94a3b8] hover:border-[#2d4a6e] hover:text-[#e2e8f0] transition-colors focus:outline-none">
          <UsersIcon className="size-3.5 text-[#475569]" />
          <span className="text-[#e2e8f0] max-w-[140px] truncate">{currentName}</span>
          <ChevronDownIcon className="size-3 text-[#475569]" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56" align="end">
        <DropdownMenuLabel>Switch Candidate</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {allCandidates.map((c) => (
          <DropdownMenuItem
            key={c.id}
            onClick={() => router.push(`/candidates/${c.id}/settings`)}
            className={c.id === candidateId ? 'text-[#93c5fd]' : ''}
          >
            <span className="flex-1 truncate">{c.name}</span>
            {c.id === candidateId && <span className="text-[10px] text-[#475569] ml-2">current</span>}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  ) : null

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <Topbar title="Settings" actions={switcher} />
      <main className="flex-1 overflow-y-auto p-6 bg-[#0d1829]">
        <div className="grid grid-cols-[2fr_1fr] gap-6 max-w-6xl">
          <section className="bg-[#0d1f3c] border border-[#1e3a5f] rounded-xl p-5 space-y-4">
            <div className="flex items-center gap-3">
              <p className="text-[9px] font-semibold text-[#334155] tracking-widest uppercase">CV</p>
              {candidate && <ParseStatusBadge initialStatus={candidate.parseStatus} candidateId={candidateId} />}
              {candidate && candidate.parseStatus !== 'parsing' &&
                (candidate.baseCvMd || candidate.parseStatus === 'failed') && (
                <div className="ml-auto flex items-center gap-2">
                  {reparseError && <p className="text-[10px] text-destructive">{reparseError}</p>}
                  <Button variant="outline" size="sm"
                    className="text-xs border-[#1e3a5f] text-[#60a5fa] hover:bg-[#0d1f3c]"
                    onClick={handleReparse} isLoading={reparsing}>
                    ↺ Re-parse
                  </Button>
                </div>
              )}
            </div>
            <CVUploader onConverted={setConvertedMarkdown} />
            {markdownToEdit ? (
              <MarkdownEditor
                initialMarkdown={markdownToEdit}
                onSaved={handleCVSaved}
                candidateId={candidateId}
              />
            ) : (
              candidate?.baseCvMd && (
                <p className="text-sm text-[#475569]">CV saved. Upload a new file to replace it.</p>
              )
            )}
          </section>

          <section className="bg-[#0d1f3c] border border-[#1e3a5f] rounded-xl p-5 space-y-4">
            <p className="text-[9px] font-semibold text-[#334155] tracking-widest uppercase">Preferences</p>
            <PreferencesForm
              initialPreferences={candidate?.preferences ?? {}}
              onSaved={handlePreferencesSaved}
              candidateId={candidateId}
            />
          </section>
        </div>
      </main>
    </div>
  )
}
