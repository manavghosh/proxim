import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/db', () => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
  },
}))

vi.mock('@/db/schema', () => ({
  emailDrafts: {
    id: 'id', openDetectedAt: 'openDetectedAt',
  },
}))

describe('GET /api/track/open/[draftId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('returns 1x1 gif with correct content type', async () => {
    const { db } = await import('@/db')
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([{ id: 'draft-001', openDetectedAt: null }]),
    } as never)
    vi.mocked(db.update).mockReturnValue({
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
    } as never)

    const { GET } = await import('@/app/api/track/open/[draftId]/route')
    const req = new Request('http://localhost/api/track/open/draft-001')
    const res = await GET(req, { params: Promise.resolve({ draftId: 'draft-001' }) })

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/gif')
    expect(res.headers.get('Cache-Control')).toContain('no-store')
  })

  it('sets open_detected_at on first call', async () => {
    const { db } = await import('@/db')
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([{ id: 'draft-001', openDetectedAt: null }]),
    } as never)
    const mockUpdate = vi.fn().mockReturnValue({
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([{ id: 'draft-001' }]),
    })
    vi.mocked(db.update).mockImplementation(mockUpdate as never)

    const { GET } = await import('@/app/api/track/open/[draftId]/route')
    const req = new Request('http://localhost/api/track/open/draft-001')
    await GET(req, { params: Promise.resolve({ draftId: 'draft-001' }) })

    expect(mockUpdate).toHaveBeenCalled()
  })

  it('is idempotent - does not overwrite first open_detected_at', async () => {
    const { db } = await import('@/db')
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([{ id: 'draft-001', openDetectedAt: '2026-05-17T10:00:00Z' }]),
    } as never)
    const mockUpdate = vi.fn()
    vi.mocked(db.update).mockImplementation(mockUpdate as never)

    const { GET } = await import('@/app/api/track/open/[draftId]/route')
    const req = new Request('http://localhost/api/track/open/draft-001')
    await GET(req, { params: Promise.resolve({ draftId: 'draft-001' }) })

    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('returns gif even for unknown draft id (silent fail)', async () => {
    const { db } = await import('@/db')
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
    } as never)

    const { GET } = await import('@/app/api/track/open/[draftId]/route')
    const req = new Request('http://localhost/api/track/open/unknown-draft')
    const res = await GET(req, { params: Promise.resolve({ draftId: 'unknown-draft' }) })

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/gif')
  })
})
