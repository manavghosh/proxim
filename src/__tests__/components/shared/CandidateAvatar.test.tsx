import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CandidateAvatar } from '@/components/shared/CandidateAvatar'

describe('CandidateAvatar', () => {
  it('renders initials from a two-word name when no avatarData', () => {
    render(<CandidateAvatar name="Manav Ghosh" />)
    expect(screen.getByText('MG')).toBeInTheDocument()
  })

  it('renders first two chars of a single-word name when no avatarData', () => {
    render(<CandidateAvatar name="Manav" />)
    expect(screen.getByText('MA')).toBeInTheDocument()
  })

  it('renders an img element when avatarData is provided', () => {
    const dataUrl = 'data:image/jpeg;base64,abc123'
    render(<CandidateAvatar name="Manav Ghosh" avatarData={dataUrl} />)
    const img = screen.getByRole('img')
    expect(img).toHaveAttribute('src', dataUrl)
  })

  it('applies sm size class (20px) when size is sm', () => {
    const { container } = render(<CandidateAvatar name="MG" size="sm" />)
    const root = container.firstChild as HTMLElement
    expect(root.className).toContain('h-5')
    expect(root.className).toContain('w-5')
  })

  it('applies md size class (28px) when size is md', () => {
    const { container } = render(<CandidateAvatar name="MG" size="md" />)
    const root = container.firstChild as HTMLElement
    expect(root.className).toContain('h-7')
    expect(root.className).toContain('w-7')
  })

  it('applies lg size class (64px) when size is lg', () => {
    const { container } = render(<CandidateAvatar name="MG" size="lg" />)
    const root = container.firstChild as HTMLElement
    expect(root.className).toContain('h-16')
    expect(root.className).toContain('w-16')
  })
})
