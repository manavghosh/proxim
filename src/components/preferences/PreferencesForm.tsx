'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { updatePreferences } from '@/lib/api'
import { parseSeniorityText } from '@/lib/preferences-helpers'
import type { Preferences } from '@/types/candidate'

const LOCATION_OPTIONS = ['Remote', 'Hybrid', 'Bengaluru-based', 'Open to relocation']
const STAGE_OPTIONS = ['Startup Series B–D', 'GCC', 'Indian Enterprise', 'Product Co', 'Consultancy']
const DOMAIN_OPTIONS = ['BFSI', 'E-commerce', 'SaaS', 'Healthcare', 'Defence']

const SOURCE_OPTIONS = [
  { label: 'Naukri', value: 'naukri' },
  { label: 'iimjobs', value: 'iimjobs' },
  { label: 'LinkedIn', value: 'linkedin' },
  { label: 'Monster', value: 'monster' },
]

interface PreferencesFormProps {
  initialPreferences: Preferences
  onSaved: (prefs: Preferences) => void
}

export function PreferencesForm({ initialPreferences, onSaved }: PreferencesFormProps) {
  // Normalise geographic_preference: old DB rows may store a plain string
  const normalisedInitial: Preferences = {
    ...initialPreferences,
    geographic_preference: Array.isArray(initialPreferences.geographic_preference)
      ? initialPreferences.geographic_preference
      : typeof initialPreferences.geographic_preference === 'string' && initialPreferences.geographic_preference
        ? [initialPreferences.geographic_preference]
        : [],
  }
  const [prefs, setPrefs] = useState<Preferences>(normalisedInitial)
  const [seniorityText, setSeniorityText] = useState(
    (initialPreferences.seniority_levels ?? []).join('\n')
  )
  const [targetCompaniesText, setTargetCompaniesText] = useState(
    (initialPreferences.target_companies ?? []).join('\n')
  )
  const [customJobSitesText, setCustomJobSitesText] = useState(
    (initialPreferences.custom_job_sites ?? []).join('\n')
  )
  const [customDomainsText, setCustomDomainsText] = useState(
    (initialPreferences.preferred_domains ?? [])
      .filter((d) => !DOMAIN_OPTIONS.includes(d))
      .join('\n')
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  function toggleMulti(key: keyof Preferences, value: string) {
    const current = (prefs[key] as string[] | undefined) ?? []
    const next = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value]
    setPrefs((p) => ({ ...p, [key]: next }))
  }

  function validate(parsed: string[]): boolean {
    const errors: Record<string, string> = {}
    if (!parsed.length)
      errors.seniority_levels = 'Enter at least one target role or seniority level'
    if (!prefs.geographic_preference?.length)
      errors.geographic_preference = 'Select at least one geographic preference'
    setFieldErrors(errors)
    return Object.keys(errors).length === 0
  }

  async function handleSave() {
    const parsed = parseSeniorityText(seniorityText)
    if (!validate(parsed)) return
    setError(null)
    setSaving(true)
    const parsedCompanies = targetCompaniesText
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
    const parsedCustomSites = customJobSitesText
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
    const parsedCustomDomains = customDomainsText
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
    const mergedDomains = [
      ...(prefs.preferred_domains?.filter((d) => DOMAIN_OPTIONS.includes(d)) ?? []),
      ...parsedCustomDomains,
    ]
    try {
      const { preferences } = await updatePreferences({
        ...prefs,
        seniority_levels: parsed,
        target_companies: parsedCompanies,
        custom_job_sites: parsedCustomSites,
        preferred_domains: mergedDomains,
      })
      onSaved(preferences as Preferences)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Seniority — REQUIRED */}
      <div className="space-y-2">
        <Label>
          Target Seniority / Role Keywords{' '}
          <span className="text-destructive">*</span>
          <span className="text-muted-foreground font-normal ml-1">(one per line)</span>
        </Label>
        <Textarea
          rows={4}
          placeholder={'CAIO\nCTO\nVP of AI\nHead of AI\nDirector of ML'}
          value={seniorityText}
          onChange={(e) => setSeniorityText(e.target.value)}
        />
        {fieldErrors.seniority_levels && (
          <p className="text-xs text-destructive">{fieldErrors.seniority_levels}</p>
        )}
      </div>

      {/* Geographic preference — REQUIRED */}
      <fieldset className="space-y-2">
        <Label>
          Geographic Preference <span className="text-destructive">*</span>
        </Label>
        <div className="flex flex-wrap gap-2">
          {LOCATION_OPTIONS.map((opt) => (
            <Button
              key={opt}
              type="button"
              size="sm"
              variant={prefs.geographic_preference?.includes(opt) ? 'default' : 'outline'}
              onClick={() => toggleMulti('geographic_preference', opt)}
            >
              {opt}
            </Button>
          ))}
        </div>
        {fieldErrors.geographic_preference && (
          <p className="text-xs text-destructive">{fieldErrors.geographic_preference}</p>
        )}
      </fieldset>

      {/* Company stage — optional */}
      <fieldset className="space-y-2">
        <Label>
          Company Stage <span className="text-muted-foreground font-normal">(optional)</span>
        </Label>
        <div className="flex flex-wrap gap-2">
          {STAGE_OPTIONS.map((opt) => (
            <Button
              key={opt}
              type="button"
              size="sm"
              variant={prefs.company_stages?.includes(opt) ? 'default' : 'outline'}
              onClick={() => toggleMulti('company_stages', opt)}
            >
              {opt}
            </Button>
          ))}
        </div>
      </fieldset>

      {/* Target companies — optional */}
      <div className="space-y-2">
        <Label>
          Target Companies{' '}
          <span className="text-muted-foreground font-normal">(optional — one per line)</span>
        </Label>
        <Textarea
          rows={4}
          placeholder={'JPMC India\nWalmart Global Tech\nFreshworks'}
          value={targetCompaniesText}
          onChange={(e) => setTargetCompaniesText(e.target.value)}
        />
      </div>

      {/* Job Sources — optional */}
      <fieldset className="space-y-2">
        <Label>
          Job Sources{' '}
          <span className="text-muted-foreground font-normal">(optional — all run if none selected)</span>
        </Label>
        <div className="flex flex-wrap gap-2">
          {SOURCE_OPTIONS.map((opt) => (
            <Button
              key={opt.value}
              type="button"
              size="sm"
              variant={prefs.enabled_sources?.includes(opt.value) ? 'default' : 'outline'}
              onClick={() => toggleMulti('enabled_sources', opt.value)}
            >
              {opt.label}
            </Button>
          ))}
        </div>
      </fieldset>

      {/* Custom job sites — optional */}
      <div className="space-y-2">
        <Label>
          Additional Job Sites{' '}
          <span className="text-muted-foreground font-normal">(optional — one URL per line)</span>
        </Label>
        <Textarea
          rows={3}
          placeholder={'https://jobs.acmecorp.com/careers\nhttps://careers.example.in'}
          value={customJobSitesText}
          onChange={(e) => setCustomJobSitesText(e.target.value)}
        />
      </div>

      {/* Preferred domains — optional */}
      <fieldset className="space-y-2">
        <Label>
          Preferred Domains{' '}
          <span className="text-muted-foreground font-normal">(optional)</span>
        </Label>
        <div className="flex flex-wrap gap-2">
          {DOMAIN_OPTIONS.map((opt) => (
            <Button
              key={opt}
              type="button"
              size="sm"
              variant={prefs.preferred_domains?.includes(opt) ? 'default' : 'outline'}
              onClick={() => toggleMulti('preferred_domains', opt)}
            >
              {opt}
            </Button>
          ))}
        </div>
        <Textarea
          rows={3}
          placeholder={'FinTech\nClimate Tech\nAI Research'}
          value={customDomainsText}
          onChange={(e) => setCustomDomainsText(e.target.value)}
        />
      </fieldset>

      <div className="flex items-center gap-3">
        <Button onClick={handleSave} isLoading={saving}>
          Save Preferences
        </Button>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    </div>
  )
}
