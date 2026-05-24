import { anthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import type { LanguageModel } from 'ai'

export function getModel(): LanguageModel {
  const provider = process.env.LLM_PROVIDER ?? 'anthropic'
  const model = process.env.LLM_MODEL

  if (provider === 'anthropic') {
    return anthropic(model ?? 'claude-sonnet-4-6')   // legacy — prefer gemini provider
  }

  if (provider === 'gemini' || provider === 'google') {
    // Match the Python agent's convention: read GEMINI_API_KEY first, fall back
    // to the SDK's default GOOGLE_GENERATIVE_AI_API_KEY so existing setups keep working.
    const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY
    if (!apiKey) {
      throw new Error(
        'GEMINI_API_KEY (or GOOGLE_GENERATIVE_AI_API_KEY) must be set when LLM_PROVIDER=gemini.'
      )
    }
    const google = createGoogleGenerativeAI({ apiKey })
    return google(model ?? 'gemini-2.0-flash')
  }

  throw new Error(
    `Provider "${provider}" is not supported. Use "anthropic" or "gemini".`
  )
}
