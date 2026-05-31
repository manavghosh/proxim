'use client'

import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { getCV, getReadiness } from '@/lib/api'
import { Topbar } from '@/components/layout/Topbar'
import { CandidateSwitcher } from '@/components/layout/CandidateSwitcher'
import { Button } from '@/components/ui/button'
import { SettingsLayout } from '@/components/settings/SettingsLayout'
import { SettingsWizard } from '@/components/settings/SettingsWizard'
import type { CandidateState, Preferences, PipelineReadiness } from '@/types/candidate'

export default function SettingsPage() {
  const { id: candidateId } = useParams<{ id: string }>()
  const searchParams = useSearchParams()
  const linkedinFlash = searchParams.get('linkedin')
  const gmailFlash    = searchParams.get('gmail')
  const forceSettings = searchParams.get('view') === 'settings'

  const [candidate, setCandidate] = useState<CandidateState | null>(null)
  const [readiness, setReadiness] = useState<PipelineReadiness | null>(null)
  const [loading, setLoading]     = useState(true)
  const [loadError, setLoadError] = useState(false)

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

  function handlePreferencesSaved(prefs: Preferences) {
    setCandidate(prev => prev ? { ...prev, preferences: prefs } : prev)
    void refresh()
  }

  if (loading || loadError || !candidate || !readiness) {
    return (
      <div className="flex flex-col flex-1 overflow-hidden">
        <Topbar title="Settings" actions={<CandidateSwitcher candidateId={candidateId} />} />
        <div className="flex-1 flex flex-col items-center justify-center gap-3 bg-background">
          {loadError ? (
            <>
              <p className="text-muted-foreground text-sm">Retrying…</p>
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
            <p className="text-muted-foreground text-sm">Loading…</p>
          )}
        </div>
      </div>
    )
  }

  const showWizard = !readiness.ready && !forceSettings

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <Topbar title="Settings" actions={<CandidateSwitcher candidateId={candidateId} />} />
      {showWizard ? (
        <SettingsWizard
          candidate={candidate}
          candidateId={candidateId}
          readiness={readiness}
          onCandidateChange={setCandidate}
          onPreferencesSaved={handlePreferencesSaved}
          refresh={refresh}
          linkedinFlash={linkedinFlash}
          gmailFlash={gmailFlash}
        />
      ) : (
        <SettingsLayout
          candidate={candidate}
          candidateId={candidateId}
          readiness={readiness}
          onCandidateChange={setCandidate}
          onPreferencesSaved={handlePreferencesSaved}
          refresh={refresh}
          linkedinFlash={linkedinFlash}
          gmailFlash={gmailFlash}
        />
      )}
    </div>
  )
}
