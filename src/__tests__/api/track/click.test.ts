import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/db', () => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
  },
}))

vi.mock('@/db/schema', () => ({
  emailDrafts: {
    id: 'id', clickDetectedAt: 'clickDetectedAt',
  },
}))

describe('GET /api/track/click/[draftId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('returns 301 redirect to decoded url', async () => {
    const { db } = await import('@/db')
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([{ id: 'draft-001', clickDetectedAt: null }]),
    } as never)
    vi.mocked(db.update).mockReturnValue({
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
    } as never)

    const { GET } = await import('@/app/api/track/click/[draftId]/route')
    const encodedUrl = encodeURIComponent('https://acme.com/careers')
    const req = new Request(`http://localhost/api/track/click/draft-001?url=${encodedUrl}`)
    const res = await GET(req, { params: Promise.resolve({ draftId: 'draft-001' }) })

    expect(res.status).toBe(301)
    expect(res.headers.get('Location')).toBe('https://acme.com/careers')
  })

  it('sets click_detected_at on first call', async () => {
    const { db } = await import('@/db')
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([{ id: 'draft-001', clickDetectedAt: null }]),
    } as never)
    const mockUpdate = vi.fn().mockReturnValue({
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
    })
    vi.mocked(db.update).mockImplementation(mockUpdate as never)

    const { GET } = await import('@/app/api/track/click/[draftId]/route')
    const encodedUrl = encodeURIComponent('https://acme.com/careers')
    const req = new Request(`http://localhost/api/track/click/draft-001?url=${encodedUrl}`)
    await GET(req, { params: Promise.resolve({ draftId: 'draft-001' }) })

    expect(mockUpdate).toHaveBeenCalled()
  })

  it('is idempotent on subsequent clicks', async () => {
    const { db } = await import('@/db')
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([{ id: 'draft-001', clickDetectedAt: '2026-05-17T10:00:00Z' }]),
    } as never)
    const mockUpdate = vi.fn()
    vi.mocked(db.update).mockImplementation(mockUpdate as never)

    const { GET } = await import('@/app/api/track/click/[draftId]/route')
    const encodedUrl = encodeURIComponent('https://acme.com/careers')
    const req = new Request(`http://localhost/api/track/click/draft-001?url=${encodedUrl}`)
    await GET(req, { params: Promise.resolve({ draftId: 'draft-001' }) })

    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('returns 400 when url param missing', async () => {
    const { GET } = await import('@/app/api/track/click/[draftId]/route')
    const req = new Request('http://localhost/api/track/click/draft-001')
    const res = await GET(req, { params: Promise.resolve({ draftId: 'draft-001' }) })

    expect(res.status).toBe(400)
  })
})
