import { NextResponse } from 'next/server'
import { convertToMarkdown, ConversionError } from '@/lib/cv-converter'

const MAX_BYTES = 10 * 1024 * 1024 // 10 MB

export async function POST(request: Request) {
  const formData = await request.formData()
  const fileEntry = formData.get('file')
  if (!(fileEntry instanceof File)) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  }
  const file = fileEntry

  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'File exceeds 10 MB limit' }, { status: 413 })
  }

  const bytes = await file.arrayBuffer()
  const buffer = Buffer.from(bytes)

  try {
    const markdown = await convertToMarkdown(buffer, file.name)
    return NextResponse.json({ markdown })
  } catch (err) {
    if (err instanceof ConversionError) {
      return NextResponse.json({ error: err.message }, { status: 400 })
    }
    return NextResponse.json({ error: 'Conversion failed' }, { status: 500 })
  }
}
