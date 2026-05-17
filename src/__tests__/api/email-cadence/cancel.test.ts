import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/db', () => ({ db: { select: vi.fn(), update: vi.fn() } }))
vi.mock('@/db/schema', () => ({
  emailCadences: { id: 'id', candidateId: 'candidateId', status: 'status' },
  emailDrafts: { id: 'id', cadenceId: 'cadenceId', status: 'status' },
}))

describe('POST /api/email-cadence/[cadenceId]/cancel', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules() })

  it('returns 200 with cancelled status', async () => {
    const { db } = await import('@/db')
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([{ id: 'cad-1', candidateId: 'cand-1', status: 'active' }]),
    } as never)
    vi.mocked(db.update).mockReturnValue({
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
    } as never)
    const { POST } = await import('@/app/api/email-cadence/[cadenceId]/cancel/route')
    const req = new Request('http://localhost/api/email-cadence/cad-1/cancel?candidateId=cand-1', { method: 'POST' })
    const res = await POST(req, { params: Promise.resolve({ cadenceId: 'cad-1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('cancelled')
  })

  it('returns 409 when cadence already terminal', async () => {
    const { db } = await import('@/db')
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([{ id: 'cad-1', candidateId: 'cand-1', status: 'cancelled' }]),
    } as never)
    const { POST } = await import('@/app/api/email-cadence/[cadenceId]/cancel/route')
    const req = new Request('http://localhost/api/email-cadence/cad-1/cancel?candidateId=cand-1', { method: 'POST' })
    const res = await POST(req, { params: Promise.resolve({ cadenceId: 'cad-1' }) })
    expect(res.status).toBe(409)
  })
})
