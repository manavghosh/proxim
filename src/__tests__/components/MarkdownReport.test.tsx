import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MarkdownReport } from '@/components/ui/markdown-report'

describe('MarkdownReport', () => {
  it('renders ## headings as heading elements without literal hashes', () => {
    render(<MarkdownReport content={'## Executive Summary\n\nSome text.'} />)
    const heading = screen.getByRole('heading', { name: 'Executive Summary' })
    expect(heading).toBeInTheDocument()
    expect(screen.queryByText(/##/)).not.toBeInTheDocument()
  })

  it('renders a GFM pipe table (no outer pipes) as a real table', () => {
    const md = [
      '## CV Match',
      '',
      'JD Requirement | Candidate Proof Point | Strength',
      '--- | --- | ---',
      'Enterprise Architect | 20+ years in architecture | Strong',
    ].join('\n')
    render(<MarkdownReport content={md} />)

    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'JD Requirement' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'Enterprise Architect' })).toBeInTheDocument()
    // The separator row must never render as a data row.
    expect(screen.queryByText(/---/)).not.toBeInTheDocument()
  })

  it('renders "- " lines as list items', () => {
    render(<MarkdownReport content={'## Gaps\n\n- Critical: a gap\n- Minor: another gap'} />)
    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('Critical: a gap')
  })

  it('renders **bold** inline as strong, not literal asterisks', () => {
    render(<MarkdownReport content={'A **Strong** match here.'} />)
    expect(screen.getByText('Strong').tagName).toBe('STRONG')
    expect(screen.queryByText(/\*\*/)).not.toBeInTheDocument()
  })

  it('renders nothing when content is empty', () => {
    const { container } = render(<MarkdownReport content={''} />)
    expect(container).toBeEmptyDOMElement()
  })
})
