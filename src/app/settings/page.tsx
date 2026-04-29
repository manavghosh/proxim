'use client'

import { useEffect, useState } from 'react'
import { getCV, getReadiness, reparseCV } from '@/lib/api'
import { Topbar } from '@/components/layout/Topbar'
import { CVUploader } from '@/components/cv/CVUploader'
import { MarkdownEditor } from '@/components/cv/MarkdownEditor'
import { ParseStatusBadge } from '@/components/cv/ParseStatusBadge'
import { PreferencesForm } from '@/components/preferences/PreferencesForm'
import { Button } from '@/components/ui/button'
import type { CandidateState, Preferences, PipelineReadiness } from '@/types/candidate'

export default function SettingsPage() {
  const [candidate, setCandidate] = useState<CandidateState | null>(null)
  const [readiness, setReadiness] = useState<PipelineReadiness | null>(null)
  const [convertedMarkdown, setConvertedMarkdown] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [reparsing, setReparsing] = useState(false)

  async function refresh() {
    const [cv, r] = await Promise.all([getCV(), getReadiness()])
    setCandidate(cv)
    setReadiness(r)
  }

  useEffect(() => {
    refresh().finally(() => setLoading(false))
  }, [])

  function handleConverted(markdown: string) {
    setConvertedMarkdown(markdown)
  }

  function handleCVSaved(updated: CandidateState) {
    setCandidate(updated)
    setConvertedMarkdown(null)
    void refresh()
  }

  async function handleReparse() {
    setReparsing(true)
    try {
      const updated = await reparseCV()
      setCandidate(updated)
    } finally {
      setReparsing(false)
    }
  }

  function handlePreferencesSaved(prefs: Preferences) {
    if (candidate) setCandidate({ ...candidate, preferences: prefs })
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

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <Topbar title="Settings" />

      <main className="flex-1 overflow-y-auto p-6 bg-[#0d1829]">
        <div className="grid grid-cols-[2fr_1fr] gap-6 max-w-6xl">

          {/* CV section */}
          <section className="bg-[#0d1f3c] border border-[#1e3a5f] rounded-xl p-5 space-y-4">
            <div className="flex items-center gap-3">
              <p className="text-[9px] font-semibold text-[#334155] tracking-widest uppercase">
                CV
              </p>
              {candidate && (
                <ParseStatusBadge initialStatus={candidate.parseStatus} />
              )}
              {candidate?.baseCvMd && candidate.parseStatus !== 'parsing' && (
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-auto text-xs border-[#1e3a5f] text-[#60a5fa] hover:bg-[#0d1f3c]"
                  onClick={handleReparse}
                  disabled={reparsing}
                >
                  {reparsing ? 'Queuing…' : '↺ Re-parse'}
                </Button>
              )}
            </div>

            <CVUploader onConverted={handleConverted} />

            {markdownToEdit ? (
              <MarkdownEditor
                initialMarkdown={markdownToEdit}
                onSaved={handleCVSaved}
              />
            ) : (
              candidate?.baseCvMd && (
                <p className="text-sm text-[#475569]">
                  CV saved. Upload a new file to replace it.
                </p>
              )
            )}
          </section>

          {/* Preferences section */}
          <section className="bg-[#0d1f3c] border border-[#1e3a5f] rounded-xl p-5 space-y-4">
            <p className="text-[9px] font-semibold text-[#334155] tracking-widest uppercase">
              Preferences
            </p>
            <PreferencesForm
              initialPreferences={candidate?.preferences ?? {}}
              onSaved={handlePreferencesSaved}
            />
          </section>

        </div>
      </main>
    </div>
  )
}
