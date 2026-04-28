import { generateObject } from 'ai'
import { getModel } from '@/lib/llm'
import { ParsedProfileSchema, type ParsedProfile } from '@/lib/schemas/parsed-profile'

const PARSE_PROMPT = (cvMarkdown: string) => `\
You are a CV parsing assistant. Extract all information from the CV below into structured JSON.

RULES:
- Reframe and reorder existing proof points — do NOT fabricate, inflate, or invent any information.
- Job titles, company names, and employment dates MUST appear exactly as in the CV.
- Quantified outcomes (e.g. "$2B platform", "50M users") MUST NOT be altered.
- Patents, education, certifications, and awards MUST be unchanged.
- Prefer empty arrays over omitting fields.

CV:
${cvMarkdown}`

export async function parseCV(markdown: string): Promise<ParsedProfile> {
  const { object } = await generateObject({
    model: getModel(),
    schema: ParsedProfileSchema,
    prompt: PARSE_PROMPT(markdown),
  })
  return object
}
