import { anthropic } from '@ai-sdk/anthropic'
import type { LanguageModel } from 'ai'

export function getModel(): LanguageModel {
  const provider = process.env.LLM_PROVIDER ?? 'anthropic'
  const model = process.env.LLM_MODEL ?? 'claude-sonnet-4-6'

  if (provider !== 'anthropic') {
    throw new Error(
      `Provider "${provider}" is not configured. Only "anthropic" is supported in Phase 1.`
    )
  }

  return anthropic(model)
}
