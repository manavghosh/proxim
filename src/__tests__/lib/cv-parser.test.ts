import { describe, it, expect, vi } from 'vitest'

const mockProfile = {
  name: 'Manav Ghosh',
  contact: { email: 'manav@example.com' },
  summary: 'Senior AI leader',
  roles: [{ title: 'Head of AI', company: 'Acme', dates: '2020-present', bullets: [] }],
  skills: ['Python', 'LangGraph'],
  patents: [],
  projects: [],
  education: [],
  certifications: [],
  awards: [],
}

vi.mock('ai', () => ({
  generateObject: vi.fn().mockResolvedValue({ object: mockProfile }),
}))

vi.mock('@/lib/llm', () => ({
  getModel: vi.fn().mockReturnValue('mock-model'),
}))

describe('parseCV', () => {
  it('returns a ParsedProfile from CV markdown', async () => {
    const { parseCV } = await import('@/lib/cv-parser')
    const result = await parseCV('# Manav Ghosh\n\nSenior AI leader')
    expect(result.name).toBe('Manav Ghosh')
    expect(result.skills).toContain('Python')
  })

  it('calls generateObject with the CV markdown in the prompt', async () => {
    const { generateObject } = await import('ai')
    const { parseCV } = await import('@/lib/cv-parser')
    await parseCV('# Test CV content')
    const call = vi.mocked(generateObject).mock.lastCall![0] as { prompt: string }
    expect(call.prompt).toContain('# Test CV content')
  })

  it('propagates errors from generateObject', async () => {
    const { generateObject } = await import('ai')
    vi.mocked(generateObject).mockRejectedValueOnce(new Error('API error'))
    const { parseCV } = await import('@/lib/cv-parser')
    await expect(parseCV('# CV')).rejects.toThrow('API error')
  })
})
