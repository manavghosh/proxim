import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { PreferencesForm } from '@/components/preferences/PreferencesForm'
import { SettingsDraftProvider } from '@/components/settings/SettingsDraftContext'
import type { Preferences } from '@/types/candidate'

// Mock the api module
vi.mock('@/lib/api', () => ({
  updatePreferences: vi.fn(),
}))

import { updatePreferences } from '@/lib/api'
const mockUpdatePreferences = vi.mocked(updatePreferences)

const basePrefs: Preferences = {
  seniority_levels: ['VP of AI'],
  geographic_preference: ['Remote'],
}

// The per-section "Save" button was replaced by the global save bar. Tests drive
// the registered save via the draft provider's saveAll (exposed as a test button).
function setup(prefs: Preferences = basePrefs) {
  const onSaved = vi.fn()
  mockUpdatePreferences.mockResolvedValue({ preferences: prefs } as never)
  render(
    <SettingsDraftProvider>
      {({ saveAll }) => (
        <>
          <PreferencesForm initialPreferences={prefs} onSaved={onSaved} candidateId="test-id" />
          <button onClick={() => void saveAll()}>do-save</button>
        </>
      )}
    </SettingsDraftProvider>,
  )
  return { onSaved }
}

function save() {
  fireEvent.click(screen.getByText('do-save'))
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ── Job Sources section ────────────────────────────────────────────────────

describe('Job Sources section', () => {
  it('renders all four source toggle buttons', () => {
    setup()
    expect(screen.getByRole('button', { name: 'Naukri' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'iimjobs' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'LinkedIn' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Monster' })).toBeInTheDocument()
  })

  it('source buttons are outline by default when none selected', () => {
    setup({ ...basePrefs, enabled_sources: [] })
    const naukri = screen.getByRole('button', { name: 'Naukri' })
    expect(naukri.className).not.toContain('bg-primary')
  })

  it('source button appears selected when included in enabled_sources', () => {
    setup({ ...basePrefs, enabled_sources: ['naukri'] })
    const naukri = screen.getByRole('button', { name: 'Naukri' })
    expect(naukri.className).toContain('bg-primary')
  })

  it('clicking a source button toggles it into enabled_sources on save', async () => {
    setup({ ...basePrefs, enabled_sources: [] })

    fireEvent.click(screen.getByRole('button', { name: 'Naukri' }))
    save()

    await waitFor(() => expect(mockUpdatePreferences).toHaveBeenCalledOnce())
    const callArg = mockUpdatePreferences.mock.calls[0][0] as Preferences
    expect(callArg.enabled_sources).toContain('naukri')
  })

  it('renders Additional Job Sites textarea', () => {
    setup()
    expect(
      screen.getByPlaceholderText(/https:\/\/jobs\.acmecorp\.com\/careers/)
    ).toBeInTheDocument()
  })

  it('custom_job_sites textarea initialises with existing values', () => {
    setup({ ...basePrefs, custom_job_sites: ['https://jobs.example.com', 'https://careers.test.in'] })
    const textarea = screen.getByPlaceholderText(/https:\/\/jobs\.acmecorp\.com\/careers/) as HTMLTextAreaElement
    expect(textarea.value).toBe('https://jobs.example.com\nhttps://careers.test.in')
  })

  it('saves custom_job_sites from the textarea', async () => {
    setup({ ...basePrefs, custom_job_sites: [] })

    const textarea = screen.getByPlaceholderText(/https:\/\/jobs\.acmecorp\.com\/careers/)
    fireEvent.change(textarea, { target: { value: 'https://jobs.acmecorp.com/careers' } })

    save()

    await waitFor(() => expect(mockUpdatePreferences).toHaveBeenCalledOnce())
    const callArg = mockUpdatePreferences.mock.calls[0][0] as Preferences
    expect(callArg.custom_job_sites).toContain('https://jobs.acmecorp.com/careers')
  })
})

// ── Custom Domains textarea ───────────────────────────────────────────────

describe('Custom Domains textarea', () => {
  it('renders the Additional Job Sites label text', () => {
    setup()
    expect(screen.getByText(/Additional Job Sites/)).toBeInTheDocument()
  })

  it('Preferred Domains fieldset renders a textarea for custom domains', () => {
    setup()
    expect(screen.getByPlaceholderText(/FinTech/)).toBeInTheDocument()
  })

  it('custom domains textarea initialises with non-DOMAIN_OPTIONS values', () => {
    setup({ ...basePrefs, preferred_domains: ['BFSI', 'FinTech', 'Climate Tech'] })
    const textarea = screen.getByPlaceholderText(/FinTech/) as HTMLTextAreaElement
    expect(textarea.value).not.toContain('BFSI')
    expect(textarea.value).toContain('FinTech')
    expect(textarea.value).toContain('Climate Tech')
  })

  it('saves merged domains: toggled DOMAIN_OPTIONS + custom textarea entries', async () => {
    setup({ ...basePrefs, preferred_domains: ['BFSI'] })

    const textarea = screen.getByPlaceholderText(/FinTech/)
    fireEvent.change(textarea, { target: { value: 'Climate Tech' } })

    save()

    await waitFor(() => expect(mockUpdatePreferences).toHaveBeenCalledOnce())
    const callArg = mockUpdatePreferences.mock.calls[0][0] as Preferences
    expect(callArg.preferred_domains).toContain('BFSI')
    expect(callArg.preferred_domains).toContain('Climate Tech')
  })

  it('does not duplicate DOMAIN_OPTIONS values in preferred_domains on save', async () => {
    setup({ ...basePrefs, preferred_domains: ['BFSI'] })

    // Toggle an unrelated field to mark the form dirty without touching domains.
    fireEvent.click(screen.getByRole('button', { name: 'Naukri' }))
    save()

    await waitFor(() => expect(mockUpdatePreferences).toHaveBeenCalledOnce())
    const callArg = mockUpdatePreferences.mock.calls[0][0] as Preferences
    const bfsiCount = (callArg.preferred_domains ?? []).filter((d) => d === 'BFSI').length
    expect(bfsiCount).toBe(1)
  })
})
