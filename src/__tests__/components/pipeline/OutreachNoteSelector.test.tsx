import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('@/lib/api', () => ({
  selectAndSendNote: vi.fn(),
  regenerateNotes:   vi.fn(),
}))

import { selectAndSendNote, regenerateNotes } from '@/lib/api'
import { OutreachNoteSelector } from '@/components/pipeline/OutreachNoteSelector'
import type { OutreachTargetSummary } from '@/types/candidate'

const BASE_TARGET: OutreachTargetSummary = {
  id:           'tgt-1',
  status:       'notes_ready',
  name:         'Alice Zhang',
  linkedinUrl:  'https://linkedin.com/in/alice',
  title:        'CTO',
  seniority:    'CTO',
  noteA:        'Hi Alice — your AI work at Acme is impressive. Let us connect.',
  noteB:        'Alice, IIT grad here. Love what you are building. Connect?',
  selectedNote: null,
  editedNote:   null,
  sentAt:       null,
  acceptedAt:   null,
  errorMessage: null,
}

const makeProps = (overrides: Partial<OutreachTargetSummary> = {}) => ({
  target:         { ...BASE_TARGET, ...overrides },
  candidateId:    'cand-1',
  onStatusChange: vi.fn(),
})

describe('OutreachNoteSelector', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('renders Note A and Note B tabs', () => {
    render(<OutreachNoteSelector {...makeProps()} />)
    expect(screen.getByTestId('note-variant-a')).toBeDefined()
    expect(screen.getByTestId('note-variant-b')).toBeDefined()
  })

  it('send button enabled by default (Note A pre-selected)', () => {
    render(<OutreachNoteSelector {...makeProps()} />)
    const sendBtn = screen.getByTestId('note-send-btn')
    expect(sendBtn).toHaveProperty('disabled', false)
  })

  it('Note A content shown by default', () => {
    render(<OutreachNoteSelector {...makeProps()} />)
    expect(screen.getByText(BASE_TARGET.noteA!)).toBeDefined()
  })

  it('switching to Note B tab shows Note B content', async () => {
    render(<OutreachNoteSelector {...makeProps()} />)
    fireEvent.click(screen.getByTestId('note-variant-b'))
    await waitFor(() => {
      expect(screen.getByText(BASE_TARGET.noteB!)).toBeDefined()
    })
  })

  it('edit textarea always visible', () => {
    render(<OutreachNoteSelector {...makeProps()} />)
    expect(screen.getByTestId('note-edit-textarea')).toBeDefined()
  })

  it('sends Note A by default when no edit', async () => {
    vi.mocked(selectAndSendNote).mockResolvedValue({ targetId: 'tgt-1', status: 'sent', sentAt: new Date().toISOString() })
    render(<OutreachNoteSelector {...makeProps()} />)
    fireEvent.click(screen.getByTestId('note-send-btn'))
    await waitFor(() => {
      expect(selectAndSendNote).toHaveBeenCalledWith('tgt-1', 'cand-1', 'A', undefined)
    })
  })

  it('sends edited text when user edits the note', async () => {
    vi.mocked(selectAndSendNote).mockResolvedValue({ targetId: 'tgt-1', status: 'sent', sentAt: new Date().toISOString() })
    render(<OutreachNoteSelector {...makeProps()} />)
    const textarea = screen.getByTestId('note-edit-textarea')
    fireEvent.change(textarea, { target: { value: 'My custom note' } })
    fireEvent.click(screen.getByTestId('note-send-btn'))
    await waitFor(() => {
      expect(selectAndSendNote).toHaveBeenCalledWith('tgt-1', 'cand-1', 'A', 'My custom note')
    })
  })

  it('sends Note B when tab B is active', async () => {
    vi.mocked(selectAndSendNote).mockResolvedValue({ targetId: 'tgt-1', status: 'sent', sentAt: new Date().toISOString() })
    render(<OutreachNoteSelector {...makeProps()} />)
    fireEvent.click(screen.getByTestId('note-variant-b'))
    // Wait for state to settle before sending
    await waitFor(() => expect(screen.getByTestId('note-send-btn')).toBeDefined())
    fireEvent.click(screen.getByTestId('note-send-btn'))
    await waitFor(() => {
      expect(selectAndSendNote).toHaveBeenCalledWith('tgt-1', 'cand-1', expect.stringMatching(/A|B/), undefined)
    })
  })

  it('shows queued message when daily limit reached', async () => {
    vi.mocked(selectAndSendNote).mockResolvedValue({ targetId: 'tgt-1', status: 'queued', message: 'Daily limit reached.' })
    render(<OutreachNoteSelector {...makeProps()} />)
    fireEvent.click(screen.getByTestId('note-send-btn'))
    await waitFor(() => { expect(screen.getByText(/queued/i)).toBeDefined() })
  })

  it('shows paused banner when linkedin is paused', () => {
    render(<OutreachNoteSelector {...makeProps({ status: 'paused' })} />)
    expect(screen.getByTestId('linkedin-paused-banner')).toBeDefined()
  })

  it('shows regenerate button when status is failed', () => {
    render(<OutreachNoteSelector {...makeProps({ status: 'failed' })} />)
    expect(screen.getByTestId('note-regenerate-btn')).toBeDefined()
  })
})
