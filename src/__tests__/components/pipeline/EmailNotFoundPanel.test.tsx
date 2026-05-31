import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { EmailNotFoundPanel } from '@/components/pipeline/EmailNotFoundPanel'
import type { EmailCadenceSummary } from '@/types/candidate'
import type { OutreachTargetSummary } from '@/types/candidate'

vi.mock('@/lib/api', () => ({
  overrideEmail:      vi.fn().mockResolvedValue({ cadenceId: 'c1', status: 'pending_approval' }),
  cancelCadence:      vi.fn().mockResolvedValue({ cadenceId: 'c1', status: 'cancelled' }),
  startEmailOutreach: vi.fn().mockResolvedValue({ pipelineJobId: 'pj1', status: 'queued' }),
}))

const baseCadence: EmailCadenceSummary = {
  id: 'c1', status: 'email_not_found', hiringManagerEmail: null,
  emailConfidence: null, approvedAt: null, replyDetectedAt: null,
  bounceDetectedAt: null, retryCount: 0, drafts: [],
}

const baseProps = {
  jobId: 'j1', candidateId: 'cand1',
  cadence: baseCadence, company: 'Acme Corp',
  outreachTarget: null, onUpdate: vi.fn(),
}

describe('EmailNotFoundPanel', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows "No email found" message for email_not_found status', () => {
    render(<EmailNotFoundPanel {...baseProps} />)
    expect(screen.getByText('No verified email found for Acme Corp')).toBeInTheDocument()
  })

  it('shows "could not be verified" message for low_confidence status', () => {
    render(<EmailNotFoundPanel {...baseProps} cadence={{ ...baseCadence, status: 'low_confidence' }} />)
    expect(screen.getByText(/Email found but unverified for Acme Corp/)).toBeInTheDocument()
  })

  it('shows Retry (0/2) when retryCount is 0', () => {
    render(<EmailNotFoundPanel {...baseProps} />)
    expect(screen.getByText('Retry (0/2)')).toBeInTheDocument()
  })

  it('shows Retry (1/2) when retryCount is 1', () => {
    render(<EmailNotFoundPanel {...baseProps} cadence={{ ...baseCadence, retryCount: 1 }} />)
    expect(screen.getByText('Retry (1/2)')).toBeInTheDocument()
  })

  it('disables retry and shows max message when retryCount is 2', () => {
    render(<EmailNotFoundPanel {...baseProps} cadence={{ ...baseCadence, retryCount: 2 }} />)
    expect(screen.getByText('Max retries reached')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /max retries/i })).toBeDisabled()
  })

  it('hides LinkedIn button when outreachTarget is null', () => {
    render(<EmailNotFoundPanel {...baseProps} outreachTarget={null} />)
    expect(screen.queryByText(/Use LinkedIn/)).not.toBeInTheDocument()
  })

  it('shows LinkedIn button when outreachTarget has a linkedinUrl', () => {
    const target: OutreachTargetSummary = {
      id: 't1', status: 'notes_ready', name: 'Ivy Wong',
      linkedinUrl: 'https://linkedin.com/in/ivy-wong',
      title: 'HR Director', seniority: null,
      noteA: null, noteB: null, selectedNote: null,
      editedNote: null, sentAt: null, acceptedAt: null, errorMessage: null,
      email: null, emailConfidence: null,
    }
    render(<EmailNotFoundPanel {...baseProps} outreachTarget={target} />)
    expect(screen.getByText(/Use LinkedIn/)).toBeInTheDocument()
  })

  it('shows email input when Enter email button is clicked', () => {
    render(<EmailNotFoundPanel {...baseProps} />)
    fireEvent.click(screen.getByText(/Enter email/))
    expect(screen.getByPlaceholderText('hiring@company.com')).toBeInTheDocument()
  })

  it('calls overrideEmail and onUpdate when a valid email is saved', async () => {
    const { overrideEmail } = await import('@/lib/api')
    render(<EmailNotFoundPanel {...baseProps} />)
    fireEvent.click(screen.getByText(/Enter email/))
    fireEvent.change(screen.getByPlaceholderText('hiring@company.com'), {
      target: { value: 'test@acme.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => expect(overrideEmail).toHaveBeenCalledWith('c1', 'cand1', 'test@acme.com'))
    expect(baseProps.onUpdate).toHaveBeenCalled()
  })

  it('calls cancelCadence and onUpdate when Skip is clicked', async () => {
    const { cancelCadence } = await import('@/lib/api')
    render(<EmailNotFoundPanel {...baseProps} />)
    fireEvent.click(screen.getByText(/Skip/))
    await waitFor(() => expect(cancelCadence).toHaveBeenCalledWith('c1', 'cand1'))
    expect(baseProps.onUpdate).toHaveBeenCalled()
  })

  it('calls startEmailOutreach with jobId+candidateId and then onUpdate when Retry is clicked', async () => {
    const { startEmailOutreach } = await import('@/lib/api')
    render(<EmailNotFoundPanel {...baseProps} />)
    fireEvent.click(screen.getByText('Retry (0/2)'))
    await waitFor(() => expect(startEmailOutreach).toHaveBeenCalledWith('j1', 'cand1'))
    expect(baseProps.onUpdate).toHaveBeenCalled()
  })

  it('shows Max retries reached when retry returns 429', async () => {
    const { startEmailOutreach } = await import('@/lib/api')
    ;(startEmailOutreach as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('429: Max retries reached')
    )
    render(<EmailNotFoundPanel {...baseProps} />)
    fireEvent.click(screen.getByText('Retry (0/2)'))
    await waitFor(() => expect(screen.getByText('Max retries reached')).toBeInTheDocument())
  })
})
