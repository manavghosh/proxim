'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, ArrowRight, ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { CVCard } from '@/components/cv/CVCard'
import { PreferencesForm } from '@/components/preferences/PreferencesForm'
import { LinkedInConnectCard } from '@/components/settings/LinkedInConnectCard'
import { EmailOutreachModeCard } from '@/components/settings/EmailOutreachModeCard'
import { ResumeAttachmentCard } from '@/components/settings/ResumeAttachmentCard'
import { SettingsDraftProvider } from '@/components/settings/SettingsDraftContext'
import type { CandidateState, Preferences, PipelineReadiness } from '@/types/candidate'

const STEPS = [
  { id: 'resume',      label: 'Resume',          blurb: 'Upload your CV so Proxim can tailor applications.' },
  { id: 'preferences', label: 'Job Preferences', blurb: 'Tell us what roles and locations to target.' },
  { id: 'connections', label: 'Connections',     blurb: 'Optionally connect LinkedIn for outreach.' },
  { id: 'outreach',    label: 'Outreach',        blurb: 'Choose how Proxim reaches hiring managers.' },
] as const

interface SettingsWizardProps {
  candidate: CandidateState
  candidateId: string
  readiness: PipelineReadiness
  onCandidateChange: (candidate: CandidateState) => void
  onPreferencesSaved: (prefs: Preferences) => void
  refresh: () => Promise<void> | void
  linkedinFlash?: string | null
  gmailFlash?: string | null
}

export function SettingsWizard({
  candidate,
  candidateId,
  readiness,
  onCandidateChange,
  onPreferencesSaved,
  refresh,
  linkedinFlash,
  gmailFlash,
}: SettingsWizardProps) {
  const router = useRouter()
  const [step, setStep] = useState(0)
  const current = STEPS[step]
  const isLast = step === STEPS.length - 1

  function gotoSettings() {
    router.push(`/candidates/${candidateId}/settings?view=settings`)
  }

  return (
    <SettingsDraftProvider onSaved={refresh}>
      {({ saveAll, saving, anyDirty }) => {
        async function handleContinue() {
          const ok = await saveAll()
          if (!ok) return
          if (isLast) gotoSettings()
          else setStep((s) => s + 1)
        }

        // Resume step requires a CV (existing or freshly converted/edited).
        const resumeReady = Boolean(candidate.baseCvMd) || anyDirty
        const continueDisabled = current.id === 'resume' && !resumeReady

        return (
          <div className="flex-1 overflow-y-auto bg-background">
            <div className="mx-auto max-w-2xl px-6 py-10">
              {/* Header */}
              <div className="mb-8 flex items-center justify-between">
                <div>
                  <h1 className="text-xl font-semibold text-foreground">Get set up</h1>
                  <p className="text-sm text-muted-foreground">
                    A few quick steps to start your job hunt.
                  </p>
                </div>
                <Button variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={gotoSettings}>
                  Skip for now
                </Button>
              </div>

              {/* Stepper */}
              <div className="mb-8 flex items-center">
                {STEPS.map((s, i) => {
                  const done = i < step
                  const active = i === step
                  return (
                    <div key={s.id} className="flex flex-1 items-center last:flex-none">
                      <div className="flex flex-col items-center gap-1">
                        <div
                          className={cn(
                            'flex h-7 w-7 items-center justify-center rounded-full border text-xs font-medium transition-colors',
                            done && 'border-emerald-500 bg-emerald-500 text-white',
                            active && 'border-primary bg-primary text-primary-foreground',
                            !done && !active && 'border-border-strong bg-card text-muted-foreground',
                          )}
                        >
                          {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
                        </div>
                        <span className={cn('text-[10px]', active ? 'text-foreground' : 'text-muted-foreground')}>
                          {s.label}
                        </span>
                      </div>
                      {i < STEPS.length - 1 && (
                        <div className={cn('mx-2 h-px flex-1', done ? 'bg-emerald-500' : 'bg-border-strong')} />
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Step content */}
              <div className="rounded-xl border border-border-strong bg-background p-6">
                <div className="mb-5">
                  <h2 className="text-base font-semibold text-foreground">{current.label}</h2>
                  <p className="text-sm text-muted-foreground">{current.blurb}</p>
                </div>

                {current.id === 'resume' && (
                  <CVCard
                    candidate={candidate}
                    candidateId={candidateId}
                    onCandidateChange={onCandidateChange}
                    defaultEditorOpen
                  />
                )}

                {current.id === 'preferences' && (
                  <PreferencesForm
                    initialPreferences={candidate.preferences ?? {}}
                    onSaved={onPreferencesSaved}
                    candidateId={candidateId}
                  />
                )}

                {current.id === 'connections' && (
                  <LinkedInConnectCard candidateId={candidateId} flash={linkedinFlash} />
                )}

                {current.id === 'outreach' && (
                  <div className="space-y-4">
                    <EmailOutreachModeCard candidateId={candidateId} flash={gmailFlash} />
                    <div className="border-t border-border pt-4">
                      <ResumeAttachmentCard candidateId={candidateId} />
                    </div>
                  </div>
                )}
              </div>

              {/* Footer nav */}
              <div className="mt-6 flex items-center justify-between">
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1.5 text-xs"
                  onClick={() => setStep((s) => Math.max(0, s - 1))}
                  disabled={step === 0 || saving}
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Back
                </Button>

                <div className="flex items-center gap-2">
                  {!isLast && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs text-muted-foreground"
                      onClick={() => setStep((s) => s + 1)}
                      disabled={saving}
                    >
                      Skip
                    </Button>
                  )}
                  <Button
                    size="sm"
                    className="gap-1.5 text-xs"
                    onClick={handleContinue}
                    isLoading={saving}
                    disabled={continueDisabled}
                  >
                    {isLast ? 'Finish' : 'Continue'}
                    {!isLast && <ArrowRight className="h-3.5 w-3.5" />}
                  </Button>
                </div>
              </div>

              {readiness.missing.length > 0 && (
                <p className="mt-4 text-center text-[11px] text-muted-foreground">
                  Still needed: {readiness.missing.join(' · ')}
                </p>
              )}
            </div>
          </div>
        )
      }}
    </SettingsDraftProvider>
  )
}
