import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { AvatarUploadSection } from '@/components/settings/AvatarUploadSection'

vi.mock('@/lib/api', () => ({
  updateCandidateAvatar: vi.fn().mockResolvedValue(undefined),
}))

const defaultProps = {
  candidateId: 'cand-1',
  candidateName: 'Manav Ghosh',
  avatarData: null as string | null,
  onAvatarChange: vi.fn(),
}

describe('AvatarUploadSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders CandidateAvatar with correct name', () => {
    render(<AvatarUploadSection {...defaultProps} />)
    expect(screen.getByText('MG')).toBeInTheDocument()
  })

  it('renders Upload photo button', () => {
    render(<AvatarUploadSection {...defaultProps} />)
    expect(screen.getByRole('button', { name: /upload photo/i })).toBeInTheDocument()
  })

  it('does not render Remove button when no avatar', () => {
    render(<AvatarUploadSection {...defaultProps} avatarData={null} />)
    expect(screen.queryByRole('button', { name: /remove/i })).not.toBeInTheDocument()
  })

  it('renders Remove button when avatarData is set', () => {
    render(<AvatarUploadSection {...defaultProps} avatarData="data:image/jpeg;base64,abc123" />)
    expect(screen.getByRole('button', { name: /remove/i })).toBeInTheDocument()
  })

  it('calls updateCandidateAvatar with null and onAvatarChange when Remove is clicked', async () => {
    const { updateCandidateAvatar } = await import('@/lib/api')
    const onAvatarChange = vi.fn()
    render(
      <AvatarUploadSection
        {...defaultProps}
        avatarData="data:image/jpeg;base64,abc123"
        onAvatarChange={onAvatarChange}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /remove/i }))
    await waitFor(() => {
      expect(updateCandidateAvatar).toHaveBeenCalledWith('cand-1', null)
      expect(onAvatarChange).toHaveBeenCalledWith(null)
    })
  })
})
