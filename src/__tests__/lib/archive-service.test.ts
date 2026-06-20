import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the DB module so the module-level driver init doesn't require a real
// DATABASE_URL in the unit test environment.
vi.mock('@/db', () => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
  },
}))

import {
  isAgedArchivable,
  cutoffDate,
  isValidArchiveAge,
  ARCHIVE_PROTECTED_STATUSES,
  archiveJob,
  unarchiveJob,
  archiveAgedJobs,
} from '@/lib/archive-service'
import { db } from '@/db'

const NOW = new Date('2026-06-20T00:00:00.000Z')
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000)

function makeAgedJob(overrides: Partial<{
  status: string
  postedAt: Date | string | null
  interviewCallbackAt: Date | string | null
  archived: boolean
}> = {}) {
  return {
    status: 'scored',
    postedAt: daysAgo(45),
    interviewCallbackAt: null,
    archived: false,
    ...overrides,
  }
}

describe('cutoffDate', () => {
  it('subtracts the given number of days from now', () => {
    expect(cutoffDate(NOW, 30).toISOString()).toBe(daysAgo(30).toISOString())
  })
})

describe('isValidArchiveAge', () => {
  it('accepts 30, 60, 90', () => {
    expect(isValidArchiveAge(30)).toBe(true)
    expect(isValidArchiveAge(60)).toBe(true)
    expect(isValidArchiveAge(90)).toBe(true)
  })
  it('rejects anything else', () => {
    expect(isValidArchiveAge(45)).toBe(false)
    expect(isValidArchiveAge(0)).toBe(false)
    expect(isValidArchiveAge(-30)).toBe(false)
    expect(isValidArchiveAge(NaN)).toBe(false)
  })
})

describe('isAgedArchivable', () => {
  it('archives an inactive job whose posting is older than the cutoff', () => {
    expect(isAgedArchivable(makeAgedJob({ status: 'scored', postedAt: daysAgo(45) }), 30, NOW)).toBe(true)
  })

  it.each(['discovered', 'scored', 'awaiting', 'snoozed', 'rejected', 'score_failed', 'resume_failed'])(
    'sweeps inactive status %s when aged',
    (status) => {
      expect(isAgedArchivable(makeAgedJob({ status, postedAt: daysAgo(100) }), 90, NOW)).toBe(true)
    },
  )

  it.each([...ARCHIVE_PROTECTED_STATUSES])('protects active status %s even when aged', (status) => {
    expect(isAgedArchivable(makeAgedJob({ status, postedAt: daysAgo(200) }), 30, NOW)).toBe(false)
  })

  it('protects a job with an interview callback even when aged', () => {
    expect(isAgedArchivable(makeAgedJob({ interviewCallbackAt: daysAgo(1), postedAt: daysAgo(200) }), 30, NOW)).toBe(false)
  })

  it('excludes a job whose posting date is within the window', () => {
    expect(isAgedArchivable(makeAgedJob({ postedAt: daysAgo(10) }), 30, NOW)).toBe(false)
  })

  it('excludes a job with a NULL posting date (the bulk sweep skips these)', () => {
    expect(isAgedArchivable(makeAgedJob({ postedAt: null }), 30, NOW)).toBe(false)
  })

  it('excludes an already-archived job', () => {
    expect(isAgedArchivable(makeAgedJob({ archived: true, postedAt: daysAgo(200) }), 30, NOW)).toBe(false)
  })

  it('handles a string posting date', () => {
    expect(isAgedArchivable(makeAgedJob({ postedAt: daysAgo(45).toISOString() }), 30, NOW)).toBe(true)
  })

  it('excludes an unparseable posting date', () => {
    expect(isAgedArchivable(makeAgedJob({ postedAt: 'not-a-date' }), 30, NOW)).toBe(false)
  })
})

describe('archiveJob', () => {
  let setMock: ReturnType<typeof vi.fn>
  let whereMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    whereMock = vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: 'job-1', archived: true }]) })
    setMock = vi.fn().mockReturnValue({ where: whereMock })
    vi.mocked(db.update).mockReturnValue({ set: setMock } as never)
  })

  it('sets archived=true and a timestamp', async () => {
    const result = await archiveJob('job-1', 'cand-1')
    expect(setMock).toHaveBeenCalledWith(
      expect.objectContaining({ archived: true, archivedAt: expect.any(String) }),
    )
    expect(result).toEqual({ id: 'job-1', archived: true })
  })

  it('returns null when no row matched (wrong candidate or already archived)', async () => {
    whereMock.mockReturnValue({ returning: vi.fn().mockResolvedValue([]) })
    const result = await archiveJob('job-x', 'cand-1')
    expect(result).toBeNull()
  })
})

describe('unarchiveJob', () => {
  let setMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    setMock = vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: 'job-1', status: 'scored', archived: false }]),
      }),
    })
    vi.mocked(db.update).mockReturnValue({ set: setMock } as never)
  })

  it('clears the archived flag and timestamp', async () => {
    const result = await unarchiveJob('job-1', 'cand-1')
    expect(setMock).toHaveBeenCalledWith(
      expect.objectContaining({ archived: false, archivedAt: null }),
    )
    expect(result).toEqual({ id: 'job-1', status: 'scored', archived: false })
  })
})

describe('archiveAgedJobs', () => {
  let updateSetWhere: ReturnType<typeof vi.fn>

  function mockCandidateJobs(rows: unknown[]) {
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(rows) }),
    } as never)
  }

  beforeEach(() => {
    vi.clearAllMocks()
    updateSetWhere = vi.fn().mockResolvedValue(undefined)
    vi.mocked(db.update).mockReturnValue({
      set: vi.fn().mockReturnValue({ where: updateSetWhere }),
    } as never)
  })

  it('counts only eligible jobs and performs the update', async () => {
    mockCandidateJobs([
      { id: 'a', status: 'scored', postedAt: daysAgo(45), interviewCallbackAt: null, archived: false }, // eligible
      { id: 'b', status: 'approved', postedAt: daysAgo(45), interviewCallbackAt: null, archived: false }, // protected
      { id: 'c', status: 'scored', postedAt: daysAgo(10), interviewCallbackAt: null, archived: false }, // too recent
      { id: 'd', status: 'rejected', postedAt: null, interviewCallbackAt: null, archived: false }, // no postedAt
    ])
    const result = await archiveAgedJobs('cand-1', 30, { now: NOW })
    expect(result.count).toBe(1)
    expect(updateSetWhere).toHaveBeenCalledTimes(1)
  })

  it('dryRun returns the count without writing', async () => {
    mockCandidateJobs([
      { id: 'a', status: 'scored', postedAt: daysAgo(45), interviewCallbackAt: null, archived: false },
      { id: 'b', status: 'snoozed', postedAt: daysAgo(99), interviewCallbackAt: null, archived: false },
    ])
    const result = await archiveAgedJobs('cand-1', 30, { now: NOW, dryRun: true })
    expect(result.count).toBe(2)
    expect(updateSetWhere).not.toHaveBeenCalled()
  })

  it('does not call update when nothing is eligible', async () => {
    mockCandidateJobs([
      { id: 'a', status: 'approved', postedAt: daysAgo(200), interviewCallbackAt: null, archived: false },
    ])
    const result = await archiveAgedJobs('cand-1', 30, { now: NOW })
    expect(result.count).toBe(0)
    expect(updateSetWhere).not.toHaveBeenCalled()
  })
})
