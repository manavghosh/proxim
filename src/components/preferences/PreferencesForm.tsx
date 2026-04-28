'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { updatePreferences } from '@/lib/api'
import type { Preferences } from '@/types/candidate'

const SENIORITY_OPTIONS = ['CAIO', 'CTO', 'VP AI', 'Head of AI', 'Distinguished Engineer', 'AI Practice Head']
const LOCATION_OPTIONS = ['Remote', 'Hybrid', 'Bengaluru-based', 'Open to relocation']
const STAGE_OPTIONS = ['Startup Series B–D', 'GCC', 'Indian Enterprise', 'Product Co', 'Consultancy']
const DOMAIN_OPTIONS = ['BFSI', 'E-commerce', 'SaaS', 'Healthcare', 'Defence']

interface PreferencesFormProps {
  initialPreferences: Preferences
  onSaved: (prefs: Preferences) => void
}

export function PreferencesForm({ initialPreferences, onSaved }: PreferencesFormProps) {
  const [prefs, setPrefs] = useState<Preferences>(initialPreferences)
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

  function validate(): boolean {
    const errors: Record<string, string> = {}
    if (!prefs.seniority_levels?.length)
      errors.seniority_levels = 'Select at least one seniority level'
    if (!prefs.geographic_preference)
      errors.geographic_preference = 'Select a geographic preference'
    setFieldErrors(errors)
    return Object.keys(errors).length === 0
  }

  async function handleSave() {
    if (!validate()) return
    setError(null)
    setSaving(true)
    try {
      const { preferences } = await updatePreferences(prefs)
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
      <fieldset className="space-y-2">
        <Label>
          Target Seniority <span className="text-destructive">*</span>
        </Label>
        <div className="flex flex-wrap gap-2">
          {SENIORITY_OPTIONS.map((opt) => (
            <Button
              key={opt}
              type="button"
              size="sm"
              variant={prefs.seniority_levels?.includes(opt) ? 'default' : 'outline'}
              onClick={() => toggleMulti('seniority_levels', opt)}
            >
              {opt}
            </Button>
          ))}
        </div>
        {fieldErrors.seniority_levels && (
          <p className="text-xs text-destructive">{fieldErrors.seniority_levels}</p>
        )}
      </fieldset>

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
              variant={prefs.geographic_preference === opt ? 'default' : 'outline'}
              onClick={() => setPrefs((p) => ({ ...p, geographic_preference: opt }))}
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
          value={(prefs.target_companies ?? []).join('\n')}
          onChange={(e) =>
            setPrefs((p) => ({
              ...p,
              target_companies: e.target.value
                .split('\n')
                .map((s) => s.trim())
                .filter(Boolean),
            }))
          }
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
      </fieldset>

      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save Preferences'}
        </Button>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    </div>
  )
}
