import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { EmailOutreachPanel } from '@/components/pipeline/EmailOutreachPanel'
import type { EmailCadenceSummary, EmailDraftSummary } from '@/types/candidate'

vi.mock('@/lib/api', () => ({
  approveCadence: vi.fn(),
  updateDraft: vi.fn(),
  overrideEmail: vi.fn(),
}))

const makeDraft = (day: 1 | 3 | 7): EmailDraftSummary => ({
  id: `draft-00${day}`,
  dayNumber: day,
  subject: 'Re: Head of AI @ Acme',
  bodyHtml: `<p>Day ${day}</p>`,
  originalBodyHtml: `<p>Day ${day} original</p>`,
  isApproved: false,
  status: 'draft',
  scheduledSendAt: null,
  sentAt: null,
  openDetectedAt: null,
  clickDetectedAt: null,
})

const makeCadence = (overrides: Partial<EmailCadenceSummary> = {}): EmailCadenceSummary => ({
  id: 'cad-001',
  status: 'pending_approval',
  hiringManagerEmail: 'sarah@acme.com',
  emailConfidence: 84,
  approvedAt: null,
  replyDetectedAt: null,
  bounceDetectedAt: null,
  drafts: [makeDraft(1), makeDraft(3), makeDraft(7)],
  ...overrides,
})

describe('EmailOutreachPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders three draft cards when status pending_approval', () => {
    render(
      <EmailOutreachPanel
        cadence={makeCadence()}
        candidateId="cand-001"
        onCadenceUpdated={vi.fn()}
      />
    )
    expect(screen.getByTestId('email-outreach-panel')).toBeDefined()
    expect(screen.getByTestId('email-draft-card-day-1')).toBeDefined()
    expect(screen.getByTestId('email-draft-card-day-3')).toBeDefined()
    expect(screen.getByTestId('email-draft-card-day-7')).toBeDefined()
  })

  it('approve button present when pending_approval', () => {
    render(
      <EmailOutreachPanel
        cadence={makeCadence()}
        candidateId="cand-001"
        onCadenceUpdated={vi.fn()}
      />
    )
    expect(screen.getByTestId('approve-cadence-btn')).toBeDefined()
  })

  it('clicking approve calls approveCadence and updates status', async () => {
    const { approveCadence } = await import('@/lib/api')
    vi.mocked(approveCadence).mockResolvedValue({
      cadenceId: 'cad-001',
      status: 'approved',
      approvedAt: '2026-05-17T10:00:00Z',
      drafts: [],
    })

    const onUpdate = vi.fn()
    render(
      <EmailOutreachPanel
        cadence={makeCadence()}
        candidateId="cand-001"
        onCadenceUpdated={onUpdate}
      />
    )

    fireEvent.click(screen.getByTestId('approve-cadence-btn'))
    await waitFor(() => {
      expect(approveCadence).toHaveBeenCalledWith('cad-001', 'cand-001')
    })
  })

  it('shows low confidence notice with override button', () => {
    render(
      <EmailOutreachPanel
        cadence={makeCadence({ status: 'low_confidence', drafts: [] })}
        candidateId="cand-001"
        onCadenceUpdated={vi.fn()}
      />
    )
    expect(screen.getByTestId('low-confidence-notice')).toBeDefined()
    expect(screen.getByTestId('override-email-btn')).toBeDefined()
  })

  it('override button calls overrideEmail', async () => {
    const { overrideEmail } = await import('@/lib/api')
    vi.mocked(overrideEmail).mockResolvedValue({
      cadenceId: 'cad-001',
      status: 'generating',
      hiringManagerEmail: 'sarah@acme.com',
      emailSource: 'manual_override',
    })

    render(
      <EmailOutreachPanel
        cadence={makeCadence({ status: 'low_confidence', drafts: [] })}
        candidateId="cand-001"
        onCadenceUpdated={vi.fn()}
      />
    )

    fireEvent.click(screen.getByTestId('override-email-btn'))
    await waitFor(() => {
      expect(overrideEmail).toHaveBeenCalled()
    })
  })

  it('shows replied banner when status replied', () => {
    render(
      <EmailOutreachPanel
        cadence={makeCadence({ status: 'replied', drafts: [] })}
        candidateId="cand-001"
        onCadenceUpdated={vi.fn()}
      />
    )
    expect(screen.getByTestId('reply-received-banner')).toBeDefined()
  })

  it('shows bounce cancelled banner when status bounced', () => {
    render(
      <EmailOutreachPanel
        cadence={makeCadence({ status: 'bounced', drafts: [] })}
        candidateId="cand-001"
        onCadenceUpdated={vi.fn()}
      />
    )
    expect(screen.getByTestId('bounce-cancelled-banner')).toBeDefined()
  })

  it('shows auth expired warning when status auth_expired', () => {
    render(
      <EmailOutreachPanel
        cadence={makeCadence({ status: 'auth_expired', drafts: [] })}
        candidateId="cand-001"
        onCadenceUpdated={vi.fn()}
      />
    )
    expect(screen.getByTestId('auth-expired-banner')).toBeDefined()
  })

  it('shows attachment missing notice when status attachment_missing', () => {
    render(
      <EmailOutreachPanel
        cadence={makeCadence({ status: 'attachment_missing', drafts: [] })}
        candidateId="cand-001"
        onCadenceUpdated={vi.fn()}
      />
    )
    expect(screen.getByTestId('attachment-missing-notice')).toBeDefined()
  })
})
