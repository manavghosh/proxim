import { extname } from 'path'

export class ConversionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConversionError'
  }
}

export async function convertToMarkdown(
  fileContent: Buffer,
  filename: string
): Promise<string> {
  const ext = extname(filename).toLowerCase()

  switch (ext) {
    case '.md':
      return fileContent.toString('utf8')

    case '.docx': {
      const mammoth = await import('mammoth')
      const result = await mammoth.extractRawText({ buffer: fileContent })
      if (!result.value.trim()) {
        throw new ConversionError('No text could be extracted from this DOCX file.')
      }
      return result.value
    }

    case '.pdf': {
      const pdfParse = (await import('pdf-parse')).default
      let result: { text: string }
      try {
        result = await pdfParse(fileContent)
      } catch {
        throw new ConversionError(
          'Failed to parse PDF. It may be corrupted or a scanned image.'
        )
      }
      if (!result.text.trim()) {
        throw new ConversionError(
          'No text could be extracted from this PDF. It may be a scanned image.'
        )
      }
      return result.text
    }

    default:
      throw new ConversionError(
        `Unsupported format: ${ext}. Accepted formats: .md, .docx, .pdf`
      )
  }
}
