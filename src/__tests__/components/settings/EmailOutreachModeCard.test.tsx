import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('@/lib/api', () => ({
  getPreferences: vi.fn(),
  updatePreferences: vi.fn(),
  revokeGmailAccess: vi.fn(),
}))

import { getPreferences, updatePreferences, revokeGmailAccess } from '@/lib/api'
import { EmailOutreachModeCard } from '@/components/settings/EmailOutreachModeCard'

describe('EmailOutreachModeCard', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('shows Manual selected by default when no preference set', async () => {
    vi.mocked(getPreferences).mockResolvedValue({ preferences: {} })
    render(<EmailOutreachModeCard candidateId="cand-1" />)
    await waitFor(() => {
      const manualRadio = screen.getByTestId('mode-manual')
      expect((manualRadio as HTMLInputElement).checked).toBe(true)
    })
  })

  it('shows Agentic selected when preference is agentic', async () => {
    vi.mocked(getPreferences).mockResolvedValue({
      preferences: { email_outreach_mode: 'agentic' }
    })
    render(<EmailOutreachModeCard candidateId="cand-1" />)
    await waitFor(() => {
      const agenticRadio = screen.getByTestId('mode-agentic')
      expect((agenticRadio as HTMLInputElement).checked).toBe(true)
    })
  })

  it('calls updatePreferences with agentic on save', async () => {
    vi.mocked(getPreferences).mockResolvedValue({ preferences: {} })
    vi.mocked(updatePreferences).mockResolvedValue({ preferences: { email_outreach_mode: 'agentic' } })
    render(<EmailOutreachModeCard candidateId="cand-1" />)
    await waitFor(() => screen.getByTestId('mode-agentic'))
    fireEvent.click(screen.getByTestId('mode-agentic'))
    fireEvent.click(screen.getByTestId('save-mode-btn'))
    await waitFor(() => {
      expect(updatePreferences).toHaveBeenCalledWith(
        expect.objectContaining({ email_outreach_mode: 'agentic' }),
        'cand-1'
      )
    })
  })

  it('shows gmail-not-connected warning when selecting agentic without gmail', async () => {
    vi.mocked(getPreferences).mockResolvedValue({ preferences: {} })
    render(<EmailOutreachModeCard candidateId="cand-1" gmailConnected={false} />)
    await waitFor(() => screen.getByTestId('mode-agentic'))
    fireEvent.click(screen.getByTestId('mode-agentic'))
    expect(screen.getByTestId('gmail-not-connected-warning')).toBeDefined()
  })

  it('calls revokeGmailAccess (not updatePreferences) when switching agentic to manual', async () => {
    vi.mocked(getPreferences).mockResolvedValue({
      preferences: { email_outreach_mode: 'agentic' }
    })
    vi.mocked(revokeGmailAccess).mockResolvedValue({ revoked: true, mode: 'manual' })

    render(<EmailOutreachModeCard candidateId="cand-1" gmailConnected={true} />)
    await waitFor(() => screen.getByTestId('mode-manual'))

    // Currently on agentic — switch to manual
    fireEvent.click(screen.getByTestId('mode-manual'))

    // Should show revoke warning
    expect(screen.getByTestId('revoke-warning')).toBeDefined()

    fireEvent.click(screen.getByTestId('save-mode-btn'))
    await waitFor(() => {
      expect(revokeGmailAccess).toHaveBeenCalledWith('cand-1')
      expect(updatePreferences).not.toHaveBeenCalled()
    })
  })

  it('shows revoke warning when switching from agentic to manual', async () => {
    vi.mocked(getPreferences).mockResolvedValue({
      preferences: { email_outreach_mode: 'agentic' }
    })
    render(<EmailOutreachModeCard candidateId="cand-1" gmailConnected={true} />)
    await waitFor(() => screen.getByTestId('mode-manual'))
    fireEvent.click(screen.getByTestId('mode-manual'))
    expect(screen.getByTestId('revoke-warning')).toBeDefined()
  })
})
