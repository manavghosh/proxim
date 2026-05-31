type DimensionScore = { score: number; reasoning: string }

// score10d is persisted by the scoring engine with snake_case dimension keys —
// these MUST match the stored shape or dimensions get dropped as unreadable.
type Score10D = {
  gate: {
    role_level_match: DimensionScore
    ai_stack_alignment: DimensionScore
  }
  weighted: {
    compensation: DimensionScore
    company_stage: DimensionScore
    interview_probability: DimensionScore
    thought_leadership: DimensionScore
    geography: DimensionScore
    growth_trajectory: DimensionScore
    domain_resonance: DimensionScore
    hiring_urgency: DimensionScore
  }
}

export const DIMENSION_LABELS: Record<string, string> = {
  role_level_match: 'Role Level Match',
  ai_stack_alignment: 'AI Stack Alignment',
  compensation: 'Compensation',
  company_stage: 'Company Stage',
  interview_probability: 'Interview Probability',
  thought_leadership: 'Thought Leadership',
  geography: 'Geography',
  growth_trajectory: 'Growth Trajectory',
  domain_resonance: 'Domain Resonance',
  hiring_urgency: 'Hiring Urgency',
}

function safeScore(obj: unknown): number | null {
  if (obj && typeof obj === 'object' && 'score' in obj && typeof (obj as { score: unknown }).score === 'number') {
    return (obj as { score: number }).score
  }
  return null
}

export function extractStrengthsAndRisks(score10d: Score10D | null): {
  strengths: Array<{ name: string; score: number }>
  risks: Array<{ name: string; score: number }>
} {
  if (!score10d) return { strengths: [], risks: [] }

  const gate = score10d.gate ?? ({} as Score10D['gate'])
  const weighted = score10d.weighted ?? ({} as Score10D['weighted'])

  const candidates: Array<{ key: string; score: number | null; isGate: boolean }> = [
    { key: 'role_level_match', score: safeScore(gate.role_level_match), isGate: true },
    { key: 'ai_stack_alignment', score: safeScore(gate.ai_stack_alignment), isGate: true },
    { key: 'compensation', score: safeScore(weighted.compensation), isGate: false },
    { key: 'company_stage', score: safeScore(weighted.company_stage), isGate: false },
    { key: 'interview_probability', score: safeScore(weighted.interview_probability), isGate: false },
    { key: 'thought_leadership', score: safeScore(weighted.thought_leadership), isGate: false },
    { key: 'geography', score: safeScore(weighted.geography), isGate: false },
    { key: 'growth_trajectory', score: safeScore(weighted.growth_trajectory), isGate: false },
    { key: 'domain_resonance', score: safeScore(weighted.domain_resonance), isGate: false },
    { key: 'hiring_urgency', score: safeScore(weighted.hiring_urgency), isGate: false },
  ]

  // Drop any dimension whose score couldn't be read
  const all = candidates.filter((d): d is { key: string; score: number; isGate: boolean } =>
    d.score !== null
  )

  const sorted = [...all].sort((a, b) => b.score - a.score)
  const topThree = sorted.slice(0, 3)
  const strengths = topThree.map(d => ({
    name: DIMENSION_LABELS[d.key] ?? d.key,
    score: d.score,
  }))

  // Risks: lowest-scoring weighted dimensions, excluding anything already shown
  // as a strength so no dimension can appear twice.
  const strengthKeys = new Set(topThree.map(d => d.key))
  const lowScored = all
    .filter(d => !d.isGate && !strengthKeys.has(d.key))
    .sort((a, b) => a.score - b.score)
  const risks = lowScored.slice(0, 2).map(d => ({
    name: DIMENSION_LABELS[d.key] ?? d.key,
    score: d.score,
  }))

  return { strengths, risks }
}
