import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/db', () => ({
  db: {
    select: vi.fn(),
  },
}))

vi.mock('@/db/schema', () => ({
  emailCadences: {
    id: 'id', jobId: 'jobId', candidateId: 'candidateId', status: 'status',
    hiringManagerEmail: 'hiringManagerEmail', emailConfidence: 'emailConfidence',
    approvedAt: 'approvedAt', replyDetectedAt: 'replyDetectedAt', bounceDetectedAt: 'bounceDetectedAt',
  },
  emailDrafts: {
    id: 'id', cadenceId: 'cadenceId', dayNumber: 'dayNumber',
    subject: 'subject', bodyHtml: 'bodyHtml', originalBodyHtml: 'originalBodyHtml',
    isApproved: 'isApproved', status: 'status', scheduledSendAt: 'scheduledSendAt',
    sentAt: 'sentAt', openDetectedAt: 'openDetectedAt', clickDetectedAt: 'clickDetectedAt',
  },
}))

const makeCadence = (overrides = {}) => ({
  id: 'cad-001', jobId: 'job-001', candidateId: 'cand-001',
  status: 'pending_approval', hiringManagerEmail: 'sarah@acme.com',
  emailConfidence: 84, approvedAt: null, replyDetectedAt: null, bounceDetectedAt: null,
  ...overrides,
})

const makeDraft = (day: number) => ({
  id: `d-00${day}`, cadenceId: 'cad-001', dayNumber: day,
  subject: 'Re: Head of AI @ Acme', bodyHtml: `<p>Day ${day}</p>`,
  originalBodyHtml: `<p>Day ${day}</p>`, isApproved: false,
  status: 'draft', scheduledSendAt: null, sentAt: null,
  openDetectedAt: null, clickDetectedAt: null,
})

describe('GET /api/email-cadence/[cadenceId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('returns 200 with cadence and all three drafts', async () => {
    const { db } = await import('@/db')
    vi.mocked(db.select)
      .mockReturnValueOnce({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([makeCadence()]),
      } as never)
      .mockReturnValueOnce({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockResolvedValue([makeDraft(1), makeDraft(3), makeDraft(7)]),
      } as never)

    const { GET } = await import('@/app/api/email-cadence/[cadenceId]/route')
    const req = new Request('http://localhost/api/email-cadence/cad-001?candidateId=cand-001')
    const res = await GET(req, { params: Promise.resolve({ cadenceId: 'cad-001' }) })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('id', 'cad-001')
    expect(body).toHaveProperty('status', 'pending_approval')
    expect(Array.isArray(body.drafts)).toBe(true)
    expect(body.drafts).toHaveLength(3)
  })

  it('returns 404 for unknown cadence', async () => {
    const { db } = await import('@/db')
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
    } as never)

    const { GET } = await import('@/app/api/email-cadence/[cadenceId]/route')
    const req = new Request('http://localhost/api/email-cadence/unknown?candidateId=cand-001')
    const res = await GET(req, { params: Promise.resolve({ cadenceId: 'unknown' }) })

    expect(res.status).toBe(404)
  })

  it('returns 403 when candidate id mismatch', async () => {
    const { db } = await import('@/db')
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([makeCadence({ candidateId: 'cand-999' })]),
    } as never)

    const { GET } = await import('@/app/api/email-cadence/[cadenceId]/route')
    const req = new Request('http://localhost/api/email-cadence/cad-001?candidateId=cand-001')
    const res = await GET(req, { params: Promise.resolve({ cadenceId: 'cad-001' }) })

    expect(res.status).toBe(403)
  })
})
