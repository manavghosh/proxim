import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { TailoredResumeCard } from '@/components/applications/TailoredResumeCard'
import type { ResumeVersion } from '@/lib/api'

const baseVersion: ResumeVersion = {
  id: 'rv1',
  jobId: 'j1',
  candidateId: 'c1',
  archetype: 'Enterprise CAIO',
  archetypeConfidence: '0.85',
  keywords: ['AI Strategy', 'Digital Transformation', 'Executive Leadership'],
  resumePdfPath: '/pdfs/rv1.pdf',
  coverLetterPdfPath: '/pdfs/rv1-cl.pdf',
  baseCvHash: 'abc123',
  isSubmitted: false,
  generationStatus: 'completed',
  errorMessage: null,
  versionN: 1,
  createdAt: '2026-01-01T10:00:00Z',
  isStale: false,
}

describe('TailoredResumeCard', () => {
  it('renders archetype name and confidence percentage', () => {
    render(<TailoredResumeCard version={baseVersion} onViewResume={vi.fn()} onViewCoverLetter={vi.fn()} />)
    expect(screen.getByText('Enterprise CAIO')).toBeInTheDocument()
    expect(screen.getByText(/85%/)).toBeInTheDocument()
  })

  it('renders keyword pills for each keyword', () => {
    render(<TailoredResumeCard version={baseVersion} onViewResume={vi.fn()} onViewCoverLetter={vi.fn()} />)
    expect(screen.getByText('AI Strategy')).toBeInTheDocument()
    expect(screen.getByText('Digital Transformation')).toBeInTheDocument()
    expect(screen.getByText('Executive Leadership')).toBeInTheDocument()
  })

  it('shows "Low confidence" amber badge when archetypeConfidence < 0.5', () => {
    render(<TailoredResumeCard
      version={{ ...baseVersion, archetypeConfidence: '0.4' }}
      onViewResume={vi.fn()}
      onViewCoverLetter={vi.fn()}
    />)
    expect(screen.getByText(/low confidence/i)).toBeInTheDocument()
  })

  it('does NOT show low confidence badge when archetypeConfidence >= 0.5', () => {
    render(<TailoredResumeCard version={baseVersion} onViewResume={vi.fn()} onViewCoverLetter={vi.fn()} />)
    expect(screen.queryByText(/low confidence/i)).not.toBeInTheDocument()
  })

  it('shows "No keywords detected" when keywords array is empty', () => {
    render(<TailoredResumeCard
      version={{ ...baseVersion, keywords: [] }}
      onViewResume={vi.fn()}
      onViewCoverLetter={vi.fn()}
    />)
    expect(screen.getByText(/no keywords detected/i)).toBeInTheDocument()
  })

  it('shows "No keywords detected" when keywords is null', () => {
    render(<TailoredResumeCard
      version={{ ...baseVersion, keywords: null }}
      onViewResume={vi.fn()}
      onViewCoverLetter={vi.fn()}
    />)
    expect(screen.getByText(/no keywords detected/i)).toBeInTheDocument()
  })

  it('filters empty strings from keywords array', () => {
    render(<TailoredResumeCard
      version={{ ...baseVersion, keywords: ['', 'AI Strategy', ''] }}
      onViewResume={vi.fn()}
      onViewCoverLetter={vi.fn()}
    />)
    expect(screen.getByText('AI Strategy')).toBeInTheDocument()
    // Should not render empty badge
    const badges = screen.getAllByRole('generic').filter(el => el.textContent === '')
    expect(badges).toHaveLength(0)
  })

  it('shows spinner and generating text when resumePdfPath is null', () => {
    render(<TailoredResumeCard
      version={{ ...baseVersion, resumePdfPath: null }}
      onViewResume={vi.fn()}
      onViewCoverLetter={vi.fn()}
    />)
    expect(screen.getByText(/generating/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /view resume/i })).not.toBeInTheDocument()
  })

  it('renders View Resume button when resumePdfPath is set', () => {
    render(<TailoredResumeCard version={baseVersion} onViewResume={vi.fn()} onViewCoverLetter={vi.fn()} />)
    expect(screen.getByRole('button', { name: /view resume/i })).toBeInTheDocument()
  })

  it('calls onViewResume when View Resume button is clicked', () => {
    const onViewResume = vi.fn()
    render(<TailoredResumeCard version={baseVersion} onViewResume={onViewResume} onViewCoverLetter={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /view resume/i }))
    expect(onViewResume).toHaveBeenCalledOnce()
  })

  it('renders View Cover Letter button when coverLetterPdfPath is set', () => {
    render(<TailoredResumeCard version={baseVersion} onViewResume={vi.fn()} onViewCoverLetter={vi.fn()} />)
    expect(screen.getByRole('button', { name: /view cover letter/i })).toBeInTheDocument()
  })

  it('calls onViewCoverLetter when View Cover Letter button is clicked', () => {
    const onViewCoverLetter = vi.fn()
    render(<TailoredResumeCard version={baseVersion} onViewResume={vi.fn()} onViewCoverLetter={onViewCoverLetter} />)
    fireEvent.click(screen.getByRole('button', { name: /view cover letter/i }))
    expect(onViewCoverLetter).toHaveBeenCalledOnce()
  })

  it('shows version number', () => {
    render(<TailoredResumeCard version={baseVersion} onViewResume={vi.fn()} onViewCoverLetter={vi.fn()} />)
    expect(screen.getByText('v1')).toBeInTheDocument()
  })

  it('shows stale warning when isStale is true', () => {
    render(<TailoredResumeCard
      version={{ ...baseVersion, isStale: true }}
      onViewResume={vi.fn()}
      onViewCoverLetter={vi.fn()}
    />)
    expect(screen.getByText(/cv updated since tailoring/i)).toBeInTheDocument()
  })

  it('does NOT show stale warning when isStale is false', () => {
    render(<TailoredResumeCard version={baseVersion} onViewResume={vi.fn()} onViewCoverLetter={vi.fn()} />)
    expect(screen.queryByText(/cv updated since tailoring/i)).not.toBeInTheDocument()
  })
})
