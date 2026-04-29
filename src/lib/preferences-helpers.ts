export function parseSeniorityText(text: string): string[] {
  return text
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
}

export function sidebarRoleLabel(levels: string[]): string {
  if (levels.length === 0) return 'Candidate'
  if (levels.length === 1) return levels[0]
  return `${levels[0]} +${levels.length - 1}`
}
