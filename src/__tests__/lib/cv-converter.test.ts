import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'
import { convertToMarkdown, ConversionError } from '@/lib/cv-converter'

const FIXTURES = path.join(__dirname, '../fixtures')

describe('convertToMarkdown — Markdown passthrough', () => {
  it('returns the file content as a string', async () => {
    const buf = readFileSync(path.join(FIXTURES, 'sample.md'))
    const result = await convertToMarkdown(buf, 'sample.md')
    expect(result).toContain('Manav Ghosh')
    expect(result).toContain('LangGraph')
  })

  it('returns a non-empty trimmed string', async () => {
    const buf = readFileSync(path.join(FIXTURES, 'sample.md'))
    expect((await convertToMarkdown(buf, 'cv.md')).trim().length).toBeGreaterThan(0)
  })
})

describe('convertToMarkdown — unsupported formats', () => {
  it('throws ConversionError for .xlsx', async () => {
    await expect(
      convertToMarkdown(Buffer.from('data'), 'resume.xlsx')
    ).rejects.toBeInstanceOf(ConversionError)
  })

  it('error message includes the unsupported extension', async () => {
    await expect(
      convertToMarkdown(Buffer.from('data'), 'resume.xlsx')
    ).rejects.toThrow('.xlsx')
  })
})

describe('convertToMarkdown — PDF with no extractable text', () => {
  it('throws ConversionError for a minimal empty PDF', async () => {
    const emptyPdf = Buffer.from('%PDF-1.4\n%%EOF\n')
    await expect(
      convertToMarkdown(emptyPdf, 'scan.pdf')
    ).rejects.toBeInstanceOf(ConversionError)
  })
})
