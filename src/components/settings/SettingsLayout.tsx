'use client'

import { useEffect, useRef, useState } from 'react'
import { User, FileText, SlidersHorizontal, Plug, Send } from 'lucide-react'
import { CVCard } from '@/components/cv/CVCard'
import { PreferencesForm } from '@/components/preferences/PreferencesForm'
import { LinkedInConnectCard } from '@/components/settings/LinkedInConnectCard'
import { EmailOutreachModeCard } from '@/components/settings/EmailOutreachModeCard'
import { ResumeAttachmentCard } from '@/components/settings/ResumeAttachmentCard'
import { AvatarUploadSection } from '@/components/settings/AvatarUploadSection'
import { SettingsNav, type SettingsSectionMeta } from '@/components/settings/SettingsNav'
import { SettingsSaveBar } from '@/components/settings/SettingsSaveBar'
import { SettingsDraftProvider } from '@/components/settings/SettingsDraftContext'
import type { CandidateState, Preferences, PipelineReadiness } from '@/types/candidate'

const SECTIONS: SettingsSectionMeta[] = [
  { id: 'profile',     label: 'Profile',         icon: User },
  { id: 'resume',      label: 'Resume',          icon: FileText },
  { id: 'preferences', label: 'Job Preferences', icon: SlidersHorizontal },
  { id: 'connections', label: 'Connections',     icon: Plug },
  { id: 'outreach',    label: 'Outreach',        icon: Send },
]

interface SettingsLayoutProps {
  candidate: CandidateState
  candidateId: string
  readiness: PipelineReadiness
  onCandidateChange: (candidate: CandidateState) => void
  onPreferencesSaved: (prefs: Preferences) => void
  refresh: () => Promise<void> | void
  linkedinFlash?: string | null
  gmailFlash?: string | null
}

function SectionCard({
  id,
  title,
  children,
  refCb,
}: {
  id: string
  title: string
  children: React.ReactNode
  refCb: (el: HTMLElement | null) => void
}) {
  return (
    <section
      id={id}
      ref={refCb}
      className="bg-card border border-border-strong rounded-xl p-5 space-y-4 scroll-mt-6"
    >
      <p className="text-[9px] font-semibold text-muted-foreground tracking-widest uppercase">{title}</p>
      {children}
    </section>
  )
}

export function SettingsLayout({
  candidate,
  candidateId,
  readiness,
  onCandidateChange,
  onPreferencesSaved,
  refresh,
  linkedinFlash,
  gmailFlash,
}: SettingsLayoutProps) {
  const [activeId, setActiveId] = useState('profile')
  const scrollRef = useRef<HTMLDivElement>(null)
  const sectionEls = useRef<Map<string, HTMLElement>>(new Map())

  const setupTotal = 3
  const setupDone = setupTotal - (readiness.missing?.length ?? 0)

  // Scroll-spy: highlight whichever section is nearest the top of the viewport.
  useEffect(() => {
    const root = scrollRef.current
    if (!root || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visible[0]) setActiveId(visible[0].target.id)
      },
      { root, rootMargin: '-10% 0px -70% 0px', threshold: 0 },
    )
    sectionEls.current.forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [])

  function handleSelect(id: string) {
    sectionEls.current.get(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setActiveId(id)
  }

  const registerEl = (id: string) => (el: HTMLElement | null) => {
    if (el) sectionEls.current.set(id, el)
    else sectionEls.current.delete(id)
  }

  return (
    <SettingsDraftProvider onSaved={refresh}>
      {({ version }) => (
        <>
          <div ref={scrollRef} className="flex-1 overflow-y-auto bg-muted">
            <div className="mx-auto grid max-w-5xl grid-cols-[180px_1fr] gap-8 p-6">
              <SettingsNav
                sections={SECTIONS}
                activeId={activeId}
                onSelect={handleSelect}
                setupDone={setupDone}
                setupTotal={setupTotal}
              />

              <div className="space-y-6 pb-36">
                <SectionCard id="profile" title="Profile" refCb={registerEl('profile')}>
                  <AvatarUploadSection
                    candidateId={candidateId}
                    candidateName={candidate.parsedProfile?.name ?? candidate.name ?? 'Candidate'}
                    avatarData={candidate.avatarData ?? null}
                    onAvatarChange={(data) => onCandidateChange({ ...candidate, avatarData: data })}
                  />
                </SectionCard>

                <SectionCard id="resume" title="Resume / CV" refCb={registerEl('resume')}>
                  <CVCard
                    key={version}
                    candidate={candidate}
                    candidateId={candidateId}
                    onCandidateChange={onCandidateChange}
                  />
                </SectionCard>

                <SectionCard id="preferences" title="Job Preferences" refCb={registerEl('preferences')}>
                  <PreferencesForm
                    key={version}
                    initialPreferences={candidate.preferences ?? {}}
                    onSaved={onPreferencesSaved}
                    candidateId={candidateId}
                  />
                </SectionCard>

                <SectionCard id="connections" title="Connections" refCb={registerEl('connections')}>
                  <LinkedInConnectCard candidateId={candidateId} flash={linkedinFlash} />
                </SectionCard>

                <SectionCard id="outreach" title="Outreach" refCb={registerEl('outreach')}>
                  <EmailOutreachModeCard
                    key={`mode-${version}`}
                    candidateId={candidateId}
                    flash={gmailFlash}
                  />
                  <div className="border-t border-border pt-4">
                    <ResumeAttachmentCard key={`attach-${version}`} candidateId={candidateId} />
                  </div>
                </SectionCard>
              </div>
            </div>
          </div>

          <SettingsSaveBar />
        </>
      )}
    </SettingsDraftProvider>
  )
}
