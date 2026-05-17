import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// next/navigation hooks must be mocked before the page module resolves
vi.mock('next/navigation', () => ({
  useParams:       () => ({ id: 'cand-1' }),
  useRouter:       () => ({ push: vi.fn() }),
  useSearchParams: () => ({ get: () => null }),
}))

vi.mock('@/lib/api', () => ({
  getCV: vi.fn(),
  getReadiness: vi.fn(),
  reparseCV: vi.fn(),
  getCandidates: vi.fn(),
  getPreferences: vi.fn().mockResolvedValue({ preferences: {} }),
  updatePreferences: vi.fn(),
  getGmailStatus: vi.fn().mockResolvedValue({ connected: false, expired: false, email: null, expiry: null }),
  revokeGmailAccess: vi.fn(),
}))

// Stub out heavy child components so this test stays focused on the reparse
// optimistic-update behaviour and doesn't pull in MarkdownEditor / CVUploader
// internals that depend on browser APIs.
vi.mock('@/components/cv/CVUploader', () => ({
  CVUploader: () => <div data-testid="cv-uploader" />,
}))
vi.mock('@/components/cv/MarkdownEditor', () => ({
  MarkdownEditor: () => <div data-testid="markdown-editor" />,
}))
vi.mock('@/components/preferences/PreferencesForm', () => ({
  PreferencesForm: () => <div data-testid="preferences-form" />,
}))
vi.mock('@/components/layout/Topbar', () => ({
  Topbar: ({ title }: { title: string }) => <header>{title}</header>,
}))
vi.mock('@/components/settings/LinkedInConnectCard', () => ({
  LinkedInConnectCard: () => <div data-testid="linkedin-connect-card" />,
}))

import SettingsPage from '@/app/candidates/[id]/settings/page'
import { getCV, getReadiness, reparseCV, getCandidates } from '@/lib/api'
import type { CandidateState, ParseStatus } from '@/types/candidate'

const mockedGetCV         = vi.mocked(getCV)
const mockedGetReadiness  = vi.mocked(getReadiness)
const mockedReparseCV     = vi.mocked(reparseCV)
const mockedGetCandidates = vi.mocked(getCandidates)

const baseCandidate: CandidateState = {
  id: 'cand-1',
  name: 'Test Candidate',
  baseCvMd: '# resume content',
  baseCvHash: 'abc',
  parseStatus: 'failed' satisfies ParseStatus,
  parsedProfile: null,
  preferences: {},
}

describe('SettingsPage — Re-parse', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedGetReadiness.mockResolvedValue({ ready: true, missing: [], parseStatus: 'failed' })
    mockedGetCandidates.mockResolvedValue({ candidates: [] })
  })

  it('shows "Parsing CV…" optimistically while reparse is in flight, then "Profile ready" when it succeeds', async () => {
    mockedGetCV.mockResolvedValueOnce(baseCandidate)
    // reparseCV takes a tick to resolve so we can observe the in-flight state
    let resolveReparse: (v: typeof baseCandidate) => void = () => {}
    mockedReparseCV.mockReturnValueOnce(
      new Promise((res) => {
        resolveReparse = res as never
      }) as never,
    )

    render(<SettingsPage />)

    // Initial badge reflects the loaded candidate's stored status
    await waitFor(() => expect(screen.getByText('Parse failed')).toBeInTheDocument())

    // Click Re-parse — the optimistic update should immediately flip the badge
    fireEvent.click(screen.getByRole('button', { name: /Re-parse/i }))

    await waitFor(() => expect(screen.getByText('Parsing CV…')).toBeInTheDocument())
    expect(screen.queryByText('Parse failed')).not.toBeInTheDocument()

    // Now resolve the reparse with a successful parse
    resolveReparse({ ...baseCandidate, parseStatus: 'ready', parsedProfile: { name: 'Test' } as never })

    await waitFor(() => expect(screen.getByText('Profile ready')).toBeInTheDocument())
    expect(screen.queryByText('Parsing CV…')).not.toBeInTheDocument()
    expect(mockedReparseCV).toHaveBeenCalledWith('cand-1')
  })
})
