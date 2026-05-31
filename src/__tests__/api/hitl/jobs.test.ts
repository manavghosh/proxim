import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/db', () => ({
  db: {
    select: vi.fn(),
  },
}))

vi.mock('@/db/schema', () => ({
  jobs: {
    id: 'id', candidateId: 'candidateId', grade: 'grade', status: 'status',
    title: 'title', company: 'company', location: 'location', source: 'source',
    sourceUrl: 'sourceUrl', postedAt: 'postedAt', score10d: 'score10d',
    reportMd: 'reportMd', archetype: 'archetype', archetypeConfidence: 'archetypeConfidence',
    createdAt: 'createdAt',
  },
  hitlCheckpoints: {
    jobId: 'jobId', status: 'status', snoozedUntil: 'snoozedUntil', createdAt: 'createdAt', id: 'id',
  },
  outreachTargets: {
    jobId: 'jobId', id: 'id', status: 'status', name: 'name', linkedinUrl: 'linkedinUrl',
    title: 'title', seniority: 'seniority', noteA: 'noteA', noteB: 'noteB',
    selectedNote: 'selectedNote', editedNote: 'editedNote',
    sentAt: 'sentAt', acceptedAt: 'acceptedAt', errorMessage: 'errorMessage',
  },
  emailCadences: {
    id: 'id', jobId: 'jobId', candidateId: 'candidateId', status: 'status',
    hiringManagerEmail: 'hiringManagerEmail', emailConfidence: 'emailConfidence',
    approvedAt: 'approvedAt', replyDetectedAt: 'replyDetectedAt', bounceDetectedAt: 'bounceDetectedAt',
  },
  emailDrafts: {
    id: 'id', cadenceId: 'cadenceId', candidateId: 'candidateId', dayNumber: 'dayNumber',
    subject: 'subject', bodyHtml: 'bodyHtml', originalBodyHtml: 'originalBodyHtml',
    isApproved: 'isApproved', status: 'status', scheduledSendAt: 'scheduledSendAt',
    sentAt: 'sentAt', openDetectedAt: 'openDetectedAt', clickDetectedAt: 'clickDetectedAt',
  },
}))

const makeJob = (overrides = {}) => ({
  id: 'job-1', title: 'VP AI', company: 'Acme', location: 'Remote',
  source: 'naukri', sourceUrl: 'http://naukri.com/1',
  postedAt: '2026-05-01T00:00:00Z', status: 'scored', grade: 'A',
  score10d: null, reportMd: null, archetype: null, archetypeConfidence: null,
  createdAt: '2026-05-01T00:00:00Z',
  hitlCheckpointId: null, hitlStatus: null, hitlSnoozedUntil: null, hitlCreatedAt: null,
  outreachId: null, outreachStatus: null, outreachName: null, outreachLinkedinUrl: null,
  outreachTitle: null, outreachSeniority: null, outreachNoteA: null, outreachNoteB: null,
  outreachSelectedNote: null, outreachEditedNote: null, outreachSentAt: null,
  outreachAcceptedAt: null, outreachErrorMessage: null,
  ...overrides,
})

describe('GET /api/candidates/[id]/jobs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('returns 200 with scored and awaiting jobs', async () => {
    const { db } = await import('@/db')
    const mockChain = {
      from: vi.fn().mockReturnThis(),
      leftJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockResolvedValue([makeJob()]),
    }
    vi.mocked(db.select).mockReturnValue(mockChain as never)

    const { GET } = await import('@/app/api/candidates/[id]/jobs/route')
    const req = new Request('http://localhost/api/candidates/cand-1/jobs')
    const res = await GET(req, { params: Promise.resolve({ id: 'cand-1' }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toHaveProperty('jobs')
    expect(body).toHaveProperty('total')
    expect(Array.isArray(body.jobs)).toBe(true)
  })

  it('includes F-grade jobs by default (shown read-only for improvement insight)', async () => {
    const { db } = await import('@/db')
    const mockChain = {
      from: vi.fn().mockReturnThis(),
      leftJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockResolvedValue([makeJob({ grade: 'F' }), makeJob({ id: 'j2', grade: 'A' })]),
    }
    vi.mocked(db.select).mockReturnValue(mockChain as never)

    const { GET } = await import('@/app/api/candidates/[id]/jobs/route')
    const req = new Request('http://localhost/api/candidates/cand-1/jobs') // no filter → all grades incl F
    const res = await GET(req, { params: Promise.resolve({ id: 'cand-1' }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.jobs.filter((j: { grade: string }) => j.grade === 'F').length).toBeGreaterThan(0)
  })

  it('excludes F when the grade filter omits it', async () => {
    const { db } = await import('@/db')
    const mockChain = {
      from: vi.fn().mockReturnThis(),
      leftJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockResolvedValue([makeJob({ grade: 'F' }), makeJob({ id: 'j2', grade: 'A' })]),
    }
    vi.mocked(db.select).mockReturnValue(mockChain as never)

    const { GET } = await import('@/app/api/candidates/[id]/jobs/route')
    const req = new Request('http://localhost/api/candidates/cand-1/jobs?grades=A,B,C,D,E')
    const res = await GET(req, { params: Promise.resolve({ id: 'cand-1' }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.jobs.filter((j: { grade: string }) => j.grade === 'F')).toHaveLength(0)
  })

  it('applies grade filter A only', async () => {
    const { db } = await import('@/db')
    const mockChain = {
      from: vi.fn().mockReturnThis(),
      leftJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockResolvedValue([
        makeJob({ id: 'j1', grade: 'A' }),
        makeJob({ id: 'j2', grade: 'B' }),
      ]),
    }
    vi.mocked(db.select).mockReturnValue(mockChain as never)

    const { GET } = await import('@/app/api/candidates/[id]/jobs/route')
    const req = new Request('http://localhost/api/candidates/cand-1/jobs?filter=A')
    const res = await GET(req, { params: Promise.resolve({ id: 'cand-1' }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    const grades = body.jobs.map((j: { grade: string }) => j.grade)
    expect(grades.every((g: string) => g === 'A')).toBe(true)
  })

  it('includes A and B when filter=A+B', async () => {
    const { db } = await import('@/db')
    const mockChain = {
      from: vi.fn().mockReturnThis(),
      leftJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockResolvedValue([
        makeJob({ id: 'j1', grade: 'A' }),
        makeJob({ id: 'j2', grade: 'B' }),
        makeJob({ id: 'j3', grade: 'C' }),
      ]),
    }
    vi.mocked(db.select).mockReturnValue(mockChain as never)

    const { GET } = await import('@/app/api/candidates/[id]/jobs/route')
    const req = new Request('http://localhost/api/candidates/cand-1/jobs?filter=A%2BB')
    const res = await GET(req, { params: Promise.resolve({ id: 'cand-1' }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    const grades = body.jobs.map((j: { grade: string }) => j.grade)
    expect(grades).not.toContain('C')
  })

  it('awaiting jobs visible after service restart', async () => {
    const { db } = await import('@/db')
    const mockChain = {
      from: vi.fn().mockReturnThis(),
      leftJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockResolvedValue([
        makeJob({ status: 'awaiting', hitlStatus: 'awaiting' }),
      ]),
    }
    vi.mocked(db.select).mockReturnValue(mockChain as never)

    const { GET } = await import('@/app/api/candidates/[id]/jobs/route')
    const req = new Request('http://localhost/api/candidates/cand-1/jobs')
    const res = await GET(req, { params: Promise.resolve({ id: 'cand-1' }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    const awaiting = body.jobs.filter((j: { status: string }) => j.status === 'awaiting')
    expect(awaiting.length).toBeGreaterThan(0)
  })
})
