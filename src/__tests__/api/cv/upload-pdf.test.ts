import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/db', () => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
  },
}))

vi.mock('fs/promises', () => ({
  default: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
  },
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}))

describe('POST /api/cv/upload-pdf', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  function makeReq(formDataOverride: FormData | null, candidateId = 'cand-1') {
    const url = `http://localhost/api/cv/upload-pdf?candidateId=${candidateId}`
    const req = new Request(url, { method: 'POST' })
    if (formDataOverride !== null) {
      req.formData = vi.fn().mockResolvedValue(formDataOverride)
    } else {
      req.formData = vi.fn().mockResolvedValue(new FormData())
    }
    return req
  }

  function setupDbMock(candidate: { name: string } | null = { name: 'Test User' }) {
    return import('@/db').then(({ db }) => {
      vi.mocked(db.select).mockReturnValue({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue(candidate ? [candidate] : []),
      } as never)
      vi.mocked(db.update).mockReturnValue({
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue(undefined),
      } as never)
    })
  }

  it('returns 400 when candidateId is missing', async () => {
    await setupDbMock()
    const { POST } = await import('@/app/api/cv/upload-pdf/route')
    const fd = new FormData()
    const file = new File(['%PDF'], 'r.pdf', { type: 'application/pdf' })
    fd.append('file', file)
    const req = new Request('http://localhost/api/cv/upload-pdf', { method: 'POST' })
    req.formData = vi.fn().mockResolvedValue(fd)
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 400 when no file provided', async () => {
    await setupDbMock()
    const { POST } = await import('@/app/api/cv/upload-pdf/route')
    const fd = new FormData() // no file
    const req = makeReq(fd)
    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/file/i)
  })

  it('returns 400 for non-PDF file', async () => {
    await setupDbMock()
    const { POST } = await import('@/app/api/cv/upload-pdf/route')
    const fd = new FormData()
    fd.append('file', new File(['hello'], 'r.txt', { type: 'text/plain' }))
    const req = makeReq(fd)
    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/pdf/i)
  })

  it('returns 200 with path and filename for valid PDF', async () => {
    await setupDbMock()
    const { POST } = await import('@/app/api/cv/upload-pdf/route')
    const fd = new FormData()
    const file = new File(['%PDF-1.4'], 'my_resume.pdf', { type: 'application/pdf' })
    // jsdom File doesn't implement arrayBuffer(); polyfill it for the test
    file.arrayBuffer = vi.fn().mockResolvedValue(new ArrayBuffer(8))
    fd.append('file', file)
    const req = makeReq(fd)
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('path')
    expect(body).toHaveProperty('filename', 'my_resume.pdf')
  })
})
