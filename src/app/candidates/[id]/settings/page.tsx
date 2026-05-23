'use client'

import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { getCV, getReadiness, reparseCV } from '@/lib/api'
import { Topbar } from '@/components/layout/Topbar'
import { CandidateSwitcher } from '@/components/layout/CandidateSwitcher'
import { CVUploader } from '@/components/cv/CVUploader'
import { MarkdownEditor } from '@/components/cv/MarkdownEditor'
import { ParseStatusBadge } from '@/components/cv/ParseStatusBadge'
import { PreferencesForm } from '@/components/preferences/PreferencesForm'
import { Button } from '@/components/ui/button'
import type { CandidateState, Preferences, PipelineReadiness } from '@/types/candidate'
import { LinkedInConnectCard } from '@/components/settings/LinkedInConnectCard'
import { EmailOutreachModeCard } from '@/components/settings/EmailOutreachModeCard'
import { ResumeAttachmentCard } from '@/components/settings/ResumeAttachmentCard'
import { AvatarUploadSection } from '@/components/settings/AvatarUploadSection'

export default function SettingsPage() {
  const { id: candidateId } = useParams<{ id: string }>()
  const searchParams = useSearchParams()
  const linkedinFlash = searchParams.get('linkedin')
  const gmailFlash    = searchParams.get('gmail')

  const [candidate, setCandidate]                 = useState<CandidateState | null>(null)
  const [readiness, setReadiness]                 = useState<PipelineReadiness | null>(null)
  const [convertedMarkdown, setConvertedMarkdown] = useState<string | null>(null)
  const [loading, setLoading]                     = useState(true)
  const [loadError, setLoadError]                 = useState(false)
  const [reparsing, setReparsing]                 = useState(false)
  const [reparseError, setReparseError]           = useState<string | null>(null)

  async function refresh() {
    setLoadError(false)
    try {
      const [cv, r] = await Promise.all([getCV(candidateId), getReadiness(candidateId)])
      setCandidate(cv)
      setReadiness(r)
    } catch {
      setLoadError(true)
    }
  }

  useEffect(() => {
    setLoading(true)
    setConvertedMarkdown(null)
    refresh().finally(() => setLoading(false))
  }, [candidateId])

  // Auto-retry once after 3s when load fails (handles cold-start after OAuth redirect)
  useEffect(() => {
    if (!loadError) return
    const t = setTimeout(() => {
      setLoading(true)
      setLoadError(false)
      refresh().finally(() => setLoading(false))
    }, 3000)
    return () => clearTimeout(t)
  }, [loadError])

  async function handleReparse() {
    setReparseError(null)
    setReparsing(true)
    // Optimistically flip the badge to "Parsing CV…" so the user gets
    // immediate feedback instead of staring at the previous Parse failed/
    // Profile ready state during the round-trip.
    setCandidate((prev) => (prev ? { ...prev, parseStatus: 'parsing' } : prev))
    try {
      const updated = await reparseCV(candidateId)
      setCandidate(updated)
    } catch (e) {
      setReparseError(e instanceof Error ? e.message : 'Re-parse failed. Try again.')
      // Roll back the optimistic 'parsing' state on a transport-level failure.
      try {
        const fresh = await getCV(candidateId)
        setCandidate(fresh)
      } catch {
        setCandidate((prev) => (prev ? { ...prev, parseStatus: 'failed' } : prev))
      }
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

  if (loading || loadError) {
    return (
      <div className="flex flex-col flex-1 overflow-hidden">
        <Topbar title="Settings" actions={<CandidateSwitcher candidateId={candidateId} />} />
        <div className="flex-1 flex flex-col items-center justify-center gap-3 bg-[#0d1829]">
          {loadError ? (
            <>
              <p className="text-[#475569] text-sm">Retrying…</p>
              <Button
                size="sm"
                variant="outline"
                className="text-xs"
                onClick={() => { setLoading(true); setLoadError(false); refresh().finally(() => setLoading(false)) }}
              >
                Retry now
              </Button>
            </>
          ) : (
            <p className="text-[#475569] text-sm">Loading…</p>
          )}
        </div>
      </div>
    )
  }

  const markdownToEdit = convertedMarkdown ?? candidate?.baseCvMd

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <Topbar title="Settings" actions={<CandidateSwitcher candidateId={candidateId} />} />
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

          <div className="flex flex-col gap-6">
            <section className="bg-[#0d1f3c] border border-[#1e3a5f] rounded-xl p-5 space-y-4">
              <p className="text-[9px] font-semibold text-[#334155] tracking-widest uppercase">Profile Photo</p>
              <AvatarUploadSection
                candidateId={candidateId}
                candidateName={candidate?.parsedProfile?.name ?? 'Candidate'}
                avatarData={candidate?.avatarData ?? null}
                onAvatarChange={(data) => setCandidate(prev => prev ? { ...prev, avatarData: data } : prev)}
              />
            </section>

            <section className="bg-[#0d1f3c] border border-[#1e3a5f] rounded-xl p-5 space-y-4">
              <p className="text-[9px] font-semibold text-[#334155] tracking-widest uppercase">Preferences</p>
              <PreferencesForm
                initialPreferences={candidate?.preferences ?? {}}
                onSaved={handlePreferencesSaved}
                candidateId={candidateId}
              />
            </section>

            <section className="bg-[#0d1f3c] border border-[#1e3a5f] rounded-xl p-5">
              <LinkedInConnectCard candidateId={candidateId} flash={linkedinFlash} />
            </section>

            <section className="bg-[#0d1f3c] border border-[#1e3a5f] rounded-xl p-5">
              <EmailOutreachModeCard
                candidateId={candidateId}
                flash={gmailFlash}
              />
            </section>

            <section className="bg-[#0d1f3c] border border-[#1e3a5f] rounded-xl p-5">
              <ResumeAttachmentCard candidateId={candidateId} />
            </section>
          </div>
        </div>
      </main>
    </div>
  )
}
