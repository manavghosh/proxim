type DimensionScore = { score: number; reasoning: string }

type Score10D = {
  gate: {
    roleLevelMatch: DimensionScore
    aiStackAlignment: DimensionScore
  }
  weighted: {
    compensation: DimensionScore
    companyStage: DimensionScore
    interviewProbability: DimensionScore
    thoughtLeadership: DimensionScore
    geography: DimensionScore
    growthTrajectory: DimensionScore
    domainResonance: DimensionScore
    hiringUrgency: DimensionScore
  }
}

export const DIMENSION_LABELS: Record<string, string> = {
  roleLevelMatch: 'Role Level Match',
  aiStackAlignment: 'AI Stack Alignment',
  compensation: 'Compensation',
  companyStage: 'Company Stage',
  interviewProbability: 'Interview Probability',
  thoughtLeadership: 'Thought Leadership',
  geography: 'Geography',
  growthTrajectory: 'Growth Trajectory',
  domainResonance: 'Domain Resonance',
  hiringUrgency: 'Hiring Urgency',
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

  const gate = score10d.gate ?? {}
  const weighted = score10d.weighted ?? {}

  const candidates: Array<{ key: string; score: number | null; isGate: boolean }> = [
    { key: 'roleLevelMatch', score: safeScore(gate.roleLevelMatch), isGate: true },
    { key: 'aiStackAlignment', score: safeScore(gate.aiStackAlignment), isGate: true },
    { key: 'compensation', score: safeScore(weighted.compensation), isGate: false },
    { key: 'companyStage', score: safeScore(weighted.companyStage), isGate: false },
    { key: 'interviewProbability', score: safeScore(weighted.interviewProbability), isGate: false },
    { key: 'thoughtLeadership', score: safeScore(weighted.thoughtLeadership), isGate: false },
    { key: 'geography', score: safeScore(weighted.geography), isGate: false },
    { key: 'growthTrajectory', score: safeScore(weighted.growthTrajectory), isGate: false },
    { key: 'domainResonance', score: safeScore(weighted.domainResonance), isGate: false },
    { key: 'hiringUrgency', score: safeScore(weighted.hiringUrgency), isGate: false },
  ]

  // Drop any dimension whose score couldn't be read
  const all = candidates.filter((d): d is { key: string; score: number; isGate: boolean } =>
    d.score !== null
  )

  const sorted = [...all].sort((a, b) => b.score - a.score)
  const strengths = sorted.slice(0, 3).map(d => ({
    name: DIMENSION_LABELS[d.key] ?? d.key,
    score: d.score,
  }))

  const lowScored = all.filter((d: { key: string; score: number; isGate: boolean }) => !d.isGate).sort((a, b) => a.score - b.score)
  const risks = lowScored.slice(0, 2).map((d: { key: string; score: number }) => ({
    name: DIMENSION_LABELS[d.key] ?? d.key,
    score: d.score,
  }))

  return { strengths, risks }
}
