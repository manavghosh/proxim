import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('@/lib/api', () => ({
  getPreferences: vi.fn(),
  updatePreferences: vi.fn(),
  revokeGmailAccess: vi.fn(),
  getGmailStatus: vi.fn(),
}))

import { getPreferences, updatePreferences, revokeGmailAccess, getGmailStatus } from '@/lib/api'
import { EmailOutreachModeCard } from '@/components/settings/EmailOutreachModeCard'
import { SettingsDraftProvider } from '@/components/settings/SettingsDraftContext'

const defaultGmailStatus = { connected: false, expired: false, email: null, expiry: null }

// Save now flows through the global save bar; drive it via the draft provider.
function renderCard() {
  render(
    <SettingsDraftProvider>
      {({ saveAll }) => (
        <>
          <EmailOutreachModeCard candidateId="cand-1" />
          <button onClick={() => void saveAll()}>do-save</button>
        </>
      )}
    </SettingsDraftProvider>,
  )
}

function save() {
  fireEvent.click(screen.getByText('do-save'))
}

describe('EmailOutreachModeCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getGmailStatus).mockResolvedValue(defaultGmailStatus)
  })

  it('shows Manual selected by default when no preference set', async () => {
    vi.mocked(getPreferences).mockResolvedValue({ preferences: {} })
    renderCard()
    await waitFor(() => {
      expect(screen.getByTestId('mode-manual')).toHaveAttribute('aria-checked', 'true')
    })
  })

  it('shows Agentic selected when preference is agentic', async () => {
    vi.mocked(getPreferences).mockResolvedValue({
      preferences: { email_outreach_mode: 'agentic' }
    })
    renderCard()
    await waitFor(() => {
      expect(screen.getByTestId('mode-agentic')).toHaveAttribute('aria-checked', 'true')
    })
  })

  it('calls updatePreferences with agentic on save when gmail is connected', async () => {
    vi.mocked(getPreferences).mockResolvedValue({ preferences: {} })
    vi.mocked(getGmailStatus).mockResolvedValue({ connected: true, expired: false, email: 'test@gmail.com', expiry: null })
    vi.mocked(updatePreferences).mockResolvedValue({ preferences: { email_outreach_mode: 'agentic' } })
    renderCard()
    await waitFor(() => screen.getByTestId('mode-agentic'))
    fireEvent.click(screen.getByTestId('mode-agentic'))
    save()
    await waitFor(() => {
      expect(updatePreferences).toHaveBeenCalledWith(
        expect.objectContaining({ email_outreach_mode: 'agentic' }),
        'cand-1'
      )
    })
  })

  it('shows Connect Gmail button when Gmail not connected', async () => {
    vi.mocked(getPreferences).mockResolvedValue({ preferences: {} })
    renderCard()
    await waitFor(() => screen.getByTestId('connect-gmail-btn'))
    expect(screen.getByTestId('connect-gmail-btn')).toBeDefined()
  })

  it('calls revokeGmailAccess (not updatePreferences) when switching agentic to manual', async () => {
    vi.mocked(getPreferences).mockResolvedValue({
      preferences: { email_outreach_mode: 'agentic' }
    })
    vi.mocked(revokeGmailAccess).mockResolvedValue({ revoked: true, mode: 'manual' })

    renderCard()
    await waitFor(() => screen.getByTestId('mode-manual'))

    // Currently on agentic — switch to manual
    fireEvent.click(screen.getByTestId('mode-manual'))

    // Should show revoke warning
    expect(screen.getByTestId('revoke-warning')).toBeDefined()

    save()
    await waitFor(() => {
      expect(revokeGmailAccess).toHaveBeenCalledWith('cand-1')
      expect(updatePreferences).not.toHaveBeenCalled()
    })
  })

  it('shows revoke warning when switching from agentic to manual', async () => {
    vi.mocked(getPreferences).mockResolvedValue({
      preferences: { email_outreach_mode: 'agentic' }
    })
    renderCard()
    await waitFor(() => screen.getByTestId('mode-manual'))
    fireEvent.click(screen.getByTestId('mode-manual'))
    expect(screen.getByTestId('revoke-warning')).toBeDefined()
  })
})
