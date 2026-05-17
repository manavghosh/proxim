import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/db', () => ({ db: { select: vi.fn(), update: vi.fn() } }))
vi.mock('@/db/schema', () => ({
  emailDrafts: { id: 'id', cadenceId: 'cadenceId', dayNumber: 'dayNumber', status: 'status', sentAt: 'sentAt' },
  emailCadences: { id: 'id', candidateId: 'candidateId' },
}))

describe('POST /api/email-cadence/[cadenceId]/mark-sent', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules() })

  it('returns 200 with manually_sent status', async () => {
    const { db } = await import('@/db')
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([{ id: 'draft-1', cadenceId: 'cad-1', dayNumber: 1, status: 'approved' }]),
    } as never)
    vi.mocked(db.update).mockReturnValue({
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([{ id: 'draft-1', dayNumber: 1, status: 'manually_sent', sentAt: new Date().toISOString() }]),
    } as never)

    const { POST } = await import('@/app/api/email-cadence/[cadenceId]/mark-sent/route')
    const req = new Request('http://localhost/api/email-cadence/cad-1/mark-sent?candidateId=cand-1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ draftId: 'draft-1' }),
    })
    const res = await POST(req, { params: Promise.resolve({ cadenceId: 'cad-1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('manually_sent')
  })

  it('returns 409 when draft already sent', async () => {
    const { db } = await import('@/db')
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([{ id: 'draft-1', cadenceId: 'cad-1', dayNumber: 1, status: 'sent' }]),
    } as never)
    const { POST } = await import('@/app/api/email-cadence/[cadenceId]/mark-sent/route')
    const req = new Request('http://localhost/api/email-cadence/cad-1/mark-sent?candidateId=cand-1', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ draftId: 'draft-1' }),
    })
    const res = await POST(req, { params: Promise.resolve({ cadenceId: 'cad-1' }) })
    expect(res.status).toBe(409)
  })
})
