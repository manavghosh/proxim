import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/db', () => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
    insert: vi.fn(),
  },
}))

vi.mock('@/db/schema', () => ({
  emailCadences: {
    id: 'id', jobId: 'jobId', candidateId: 'candidateId', status: 'status',
    hiringManagerEmail: 'hiringManagerEmail', emailSource: 'emailSource',
  },
  pipelineJobs: {
    id: 'id', jobType: 'jobType', candidateId: 'candidateId', payload: 'payload',
  },
}))

const makeCadence = (overrides = {}) => ({
  id: 'cad-001', jobId: 'job-001', candidateId: 'cand-001',
  status: 'low_confidence', hiringManagerEmail: 's@acme.com', emailSource: 'domain_search',
  ...overrides,
})

describe('POST /api/email-cadence/[cadenceId]/override-email', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('returns 200 and sets status to generating', async () => {
    const { db } = await import('@/db')
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([makeCadence()]),
    } as never)
    vi.mocked(db.update).mockReturnValue({
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([{ ...makeCadence(), status: 'generating', hiringManagerEmail: 'sarah@acme.com', emailSource: 'manual_override' }]),
    } as never)
    vi.mocked(db.insert).mockReturnValue({
      values: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([{ id: 'pj-001' }]),
    } as never)

    const { POST } = await import('@/app/api/email-cadence/[cadenceId]/override-email/route')
    const req = new Request('http://localhost/api/email-cadence/cad-001/override-email?candidateId=cand-001', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmedEmail: 'sarah@acme.com' }),
    })
    const res = await POST(req, { params: Promise.resolve({ cadenceId: 'cad-001' }) })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('status', 'generating')
  })

  it('sets email_source to manual_override', async () => {
    const { db } = await import('@/db')
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([makeCadence()]),
    } as never)
    vi.mocked(db.update).mockReturnValue({
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([{ ...makeCadence(), status: 'generating', hiringManagerEmail: 'sarah@acme.com', emailSource: 'manual_override' }]),
    } as never)
    vi.mocked(db.insert).mockReturnValue({
      values: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([{ id: 'pj-001' }]),
    } as never)

    const { POST } = await import('@/app/api/email-cadence/[cadenceId]/override-email/route')
    const req = new Request('http://localhost/api/email-cadence/cad-001/override-email?candidateId=cand-001', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmedEmail: 'sarah@acme.com' }),
    })
    const res = await POST(req, { params: Promise.resolve({ cadenceId: 'cad-001' }) })

    const body = await res.json()
    expect(body).toHaveProperty('emailSource', 'manual_override')
  })

  it('inserts outreach_mailer_generate pipeline job', async () => {
    const { db } = await import('@/db')
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([makeCadence()]),
    } as never)
    vi.mocked(db.update).mockReturnValue({
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([{ ...makeCadence(), status: 'generating' }]),
    } as never)
    const mockInsert = vi.fn().mockReturnValue({
      values: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([{ id: 'pj-001' }]),
    })
    vi.mocked(db.insert).mockImplementation(mockInsert as never)

    const { POST } = await import('@/app/api/email-cadence/[cadenceId]/override-email/route')
    const req = new Request('http://localhost/api/email-cadence/cad-001/override-email?candidateId=cand-001', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmedEmail: 'sarah@acme.com' }),
    })
    await POST(req, { params: Promise.resolve({ cadenceId: 'cad-001' }) })

    expect(mockInsert).toHaveBeenCalled()
  })

  it('returns 422 when cadence not in low_confidence status', async () => {
    const { db } = await import('@/db')
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([makeCadence({ status: 'generating' })]),
    } as never)

    const { POST } = await import('@/app/api/email-cadence/[cadenceId]/override-email/route')
    const req = new Request('http://localhost/api/email-cadence/cad-001/override-email?candidateId=cand-001', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmedEmail: 'sarah@acme.com' }),
    })
    const res = await POST(req, { params: Promise.resolve({ cadenceId: 'cad-001' }) })

    expect(res.status).toBe(422)
  })
})
