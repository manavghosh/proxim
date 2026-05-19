import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the DB module so the module-level neon() call doesn't require a real
// DATABASE_URL in the unit test environment.
vi.mock('@/db', () => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
  },
}))

import { shouldTriggerParse, canReparse, markParseReady } from '@/lib/cv-service'
import { db } from '@/db'
import type { Candidate } from '@/db/schema'

const base: Candidate = {
  id: 'test-id',
  name: 'Test Candidate',
  candidateId: null,
  baseCvMd: null,
  baseCvHash: null,
  baseResumePdfPath: null,
  parsedProfile: null,
  parseStatus: 'pending',
  preferences: {},
  createdAt: new Date(),
  updatedAt: new Date(),
}

describe('canReparse', () => {
  it('returns false when there is no CV content', () => {
    expect(canReparse({ ...base, baseCvMd: null })).toBe(false)
  })

  it('returns false when parseStatus is parsing', () => {
    expect(canReparse({ ...base, baseCvMd: '# CV', parseStatus: 'parsing' })).toBe(false)
  })

  it('returns true when CV is saved and parseStatus is failed', () => {
    expect(canReparse({ ...base, baseCvMd: '# CV', parseStatus: 'failed' })).toBe(true)
  })

  it('returns true when CV is saved and parseStatus is pending', () => {
    expect(canReparse({ ...base, baseCvMd: '# CV', parseStatus: 'pending' })).toBe(true)
  })

  it('returns true when CV is saved and parseStatus is ready', () => {
    expect(canReparse({ ...base, baseCvMd: '# CV', parseStatus: 'ready' })).toBe(true)
  })
})

// shouldTriggerParse is a pure function — no DB calls involved
describe('shouldTriggerParse', () => {
  it('returns true when the existing hash is null', () => {
    expect(shouldTriggerParse(null, 'abc123')).toBe(true)
  })

  it('returns true when the existing hash is undefined', () => {
    expect(shouldTriggerParse(undefined, 'abc123')).toBe(true)
  })

  it('returns true when the hash has changed', () => {
    expect(shouldTriggerParse('old-hash', 'new-hash')).toBe(true)
  })

  it('returns false when the hash is identical', () => {
    expect(shouldTriggerParse('same-hash', 'same-hash')).toBe(false)
  })
})

describe('markParseReady — auto-promote parsed name', () => {
  let setMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    setMock = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) })
    vi.mocked(db.update).mockReturnValue({ set: setMock } as never)
  })

  function mockCurrentName(name: string) {
    const selectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([{ name }]),
    }
    vi.mocked(db.select).mockReturnValue(selectChain as never)
  }

  it('promotes parsed name when current name is the placeholder "New Candidate"', async () => {
    mockCurrentName('New Candidate')
    await markParseReady('cand-1', { name: 'Arijit Bhattacharya', skills: [] })
    expect(setMock).toHaveBeenCalledWith(
      expect.objectContaining({ parseStatus: 'ready', name: 'Arijit Bhattacharya' }),
    )
  })

  it('does NOT overwrite a name the user typed manually', async () => {
    mockCurrentName('Manav Ghosh')
    await markParseReady('cand-1', { name: 'Someone Else', skills: [] })
    const updateArg = setMock.mock.calls[0][0] as { name?: string }
    expect(updateArg.name).toBeUndefined()
  })

  it('does not promote when the parsed profile has no name', async () => {
    mockCurrentName('New Candidate')
    await markParseReady('cand-1', { skills: [] })
    const updateArg = setMock.mock.calls[0][0] as { name?: string }
    expect(updateArg.name).toBeUndefined()
  })

  it('trims whitespace from the parsed name before promoting', async () => {
    mockCurrentName('New Candidate')
    await markParseReady('cand-1', { name: '   Arijit Bhattacharya   ', skills: [] })
    expect(setMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Arijit Bhattacharya' }),
    )
  })
})
