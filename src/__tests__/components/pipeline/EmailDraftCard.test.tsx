import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { EmailDraftCard } from '@/components/pipeline/EmailDraftCard'
import type { EmailDraftSummary } from '@/types/candidate'

vi.mock('@/lib/api', () => ({
  updateDraft: vi.fn(),
}))

const makeDraft = (overrides: Partial<EmailDraftSummary> = {}): EmailDraftSummary => ({
  id: 'draft-001',
  dayNumber: 1,
  subject: 'Re: Head of AI @ Acme',
  bodyHtml: '<p>Hello Sarah</p>',
  bodyText: 'Hello Sarah',
  originalBodyHtml: '<p>Original Hello Sarah</p>',
  isApproved: false,
  status: 'draft',
  scheduledSendAt: null,
  sentAt: null,
  openDetectedAt: null,
  clickDetectedAt: null,
  ...overrides,
})

describe('EmailDraftCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders day label, subject and body', () => {
    render(
      <EmailDraftCard
        draft={makeDraft()}
        cadenceId="cad-001"
        candidateId="cand-001"
        onDraftUpdated={vi.fn()}
      />
    )
    expect(screen.getByTestId('email-draft-card-day-1')).toBeDefined()
    expect(screen.getByText(/Re: Head of AI @ Acme/)).toBeDefined()
  })

  it('edit button opens textarea with current body', async () => {
    render(
      <EmailDraftCard
        draft={makeDraft()}
        cadenceId="cad-001"
        candidateId="cand-001"
        onDraftUpdated={vi.fn()}
      />
    )
    const editBtn = screen.getByTestId('draft-edit-btn')
    fireEvent.click(editBtn)
    await waitFor(() => {
      expect(screen.getByTestId('draft-edit-textarea')).toBeDefined()
    })
  })

  it('save calls updateDraft with edited body', async () => {
    const { updateDraft } = await import('@/lib/api')
    vi.mocked(updateDraft).mockResolvedValue(makeDraft({ bodyHtml: '<p>Updated</p>' }))

    render(
      <EmailDraftCard
        draft={makeDraft()}
        cadenceId="cad-001"
        candidateId="cand-001"
        onDraftUpdated={vi.fn()}
      />
    )

    fireEvent.click(screen.getByTestId('draft-edit-btn'))
    await waitFor(() => screen.getByTestId('draft-edit-textarea'))

    const textarea = screen.getByTestId('draft-edit-textarea') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: '<p>Updated</p>' } })
    fireEvent.click(screen.getByTestId('draft-save-btn'))

    await waitFor(() => {
      expect(updateDraft).toHaveBeenCalledWith('cad-001', 'draft-001', 'cand-001', '<p>Updated</p>')
    })
  })

  it('original toggle shows original body html', async () => {
    render(
      <EmailDraftCard
        draft={makeDraft()}
        cadenceId="cad-001"
        candidateId="cand-001"
        onDraftUpdated={vi.fn()}
      />
    )
    fireEvent.click(screen.getByTestId('draft-original-toggle'))
    await waitFor(() => {
      expect(screen.getByText(/Original Hello Sarah/)).toBeDefined()
    })
  })

  it('shows sent_at when draft is sent', () => {
    render(
      <EmailDraftCard
        draft={makeDraft({ status: 'sent', sentAt: '2026-05-17T10:00:00Z' })}
        cadenceId="cad-001"
        candidateId="cand-001"
        onDraftUpdated={vi.fn()}
      />
    )
    expect(screen.getByTestId('draft-status-badge')).toBeDefined()
  })

  it('shows open detected badge when open detected', () => {
    render(
      <EmailDraftCard
        draft={makeDraft({ status: 'sent', sentAt: '2026-05-17T10:00:00Z', openDetectedAt: '2026-05-17T11:00:00Z' })}
        cadenceId="cad-001"
        candidateId="cand-001"
        onDraftUpdated={vi.fn()}
      />
    )
    expect(screen.getByTestId('draft-open-badge')).toBeDefined()
  })
})
