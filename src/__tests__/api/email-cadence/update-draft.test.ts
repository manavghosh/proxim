import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/db', () => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
  },
}))

vi.mock('@/db/schema', () => ({
  emailDrafts: {
    id: 'id', cadenceId: 'cadenceId', dayNumber: 'dayNumber',
    bodyHtml: 'bodyHtml', originalBodyHtml: 'originalBodyHtml', status: 'status',
  },
}))

const makeDraft = (overrides = {}) => ({
  id: 'draft-001',
  cadenceId: 'cad-001',
  dayNumber: 1,
  bodyHtml: '<p>Original</p>',
  originalBodyHtml: '<p>Original</p>',
  status: 'draft',
  ...overrides,
})

describe('PATCH /api/email-cadence/[cadenceId]/drafts/[draftId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('returns 200 with updated body_html', async () => {
    const { db } = await import('@/db')
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([makeDraft()]),
    } as never)
    vi.mocked(db.update).mockReturnValue({
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([{
        ...makeDraft(), bodyHtml: '<p>Updated</p>',
      }]),
    } as never)

    const { PATCH } = await import('@/app/api/email-cadence/[cadenceId]/drafts/[draftId]/route')
    const req = new Request('http://localhost/api/email-cadence/cad-001/drafts/draft-001?candidateId=cand-001', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bodyHtml: '<p>Updated</p>' }),
    })
    const res = await PATCH(req, { params: Promise.resolve({ cadenceId: 'cad-001', draftId: 'draft-001' }) })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.bodyHtml).toBe('<p>Updated</p>')
  })

  it('preserves original_body_html unchanged', async () => {
    const { db } = await import('@/db')
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([makeDraft()]),
    } as never)
    vi.mocked(db.update).mockReturnValue({
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([{
        ...makeDraft(), bodyHtml: '<p>Updated</p>',
      }]),
    } as never)

    const { PATCH } = await import('@/app/api/email-cadence/[cadenceId]/drafts/[draftId]/route')
    const req = new Request('http://localhost/api/email-cadence/cad-001/drafts/draft-001?candidateId=cand-001', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bodyHtml: '<p>Updated</p>' }),
    })
    const res = await PATCH(req, { params: Promise.resolve({ cadenceId: 'cad-001', draftId: 'draft-001' }) })

    const body = await res.json()
    expect(body.originalBodyHtml).toBe('<p>Original</p>')
  })

  it('returns 409 when draft already sent', async () => {
    const { db } = await import('@/db')
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([makeDraft({ status: 'sent' })]),
    } as never)

    const { PATCH } = await import('@/app/api/email-cadence/[cadenceId]/drafts/[draftId]/route')
    const req = new Request('http://localhost/api/email-cadence/cad-001/drafts/draft-001?candidateId=cand-001', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bodyHtml: '<p>New</p>' }),
    })
    const res = await PATCH(req, { params: Promise.resolve({ cadenceId: 'cad-001', draftId: 'draft-001' }) })

    expect(res.status).toBe(409)
  })

  it('returns 404 for unknown draft id', async () => {
    const { db } = await import('@/db')
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
    } as never)

    const { PATCH } = await import('@/app/api/email-cadence/[cadenceId]/drafts/[draftId]/route')
    const req = new Request('http://localhost/api/email-cadence/cad-001/drafts/unknown?candidateId=cand-001', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bodyHtml: '<p>New</p>' }),
    })
    const res = await PATCH(req, { params: Promise.resolve({ cadenceId: 'cad-001', draftId: 'unknown' }) })

    expect(res.status).toBe(404)
  })
})
