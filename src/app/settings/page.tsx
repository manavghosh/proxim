'use client'

import { useEffect, useState } from 'react'
import { getCV, getReadiness } from '@/lib/api'
import { CVUploader } from '@/components/cv/CVUploader'
import { MarkdownEditor } from '@/components/cv/MarkdownEditor'
import { ParseStatusBadge } from '@/components/cv/ParseStatusBadge'
import { PreferencesForm } from '@/components/preferences/PreferencesForm'
import { PipelineReadinessIndicator } from '@/components/shared/PipelineReadinessIndicator'
import type { CandidateState, Preferences, PipelineReadiness } from '@/types/candidate'

export default function SettingsPage() {
  const [candidate, setCandidate] = useState<CandidateState | null>(null)
  const [readiness, setReadiness] = useState<PipelineReadiness | null>(null)
  const [convertedMarkdown, setConvertedMarkdown] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

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

  function handlePreferencesSaved(prefs: Preferences) {
    if (candidate) setCandidate({ ...candidate, preferences: prefs })
    void refresh()
  }

  if (loading) {
    return <div className="p-8 text-gray-500 text-sm">Loading…</div>
  }

  const markdownToEdit = convertedMarkdown ?? candidate?.baseCvMd

  return (
    <main className="max-w-3xl mx-auto p-8 space-y-10">
      <h1 className="text-2xl font-semibold text-gray-900">Settings</h1>

      {readiness && <PipelineReadinessIndicator readiness={readiness} />}

      {/* CV section */}
      <section className="space-y-4">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-medium text-gray-800">CV</h2>
          {candidate && (
            <ParseStatusBadge initialStatus={candidate.parseStatus} />
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
            <p className="text-sm text-gray-500">
              CV saved. Upload a new file to replace it.
            </p>
          )
        )}
      </section>

      {/* Preferences section */}
      <section className="space-y-4">
        <h2 className="text-lg font-medium text-gray-800">Preferences</h2>
        <PreferencesForm
          initialPreferences={candidate?.preferences ?? {}}
          onSaved={handlePreferencesSaved}
        />
      </section>
    </main>
  )
}
