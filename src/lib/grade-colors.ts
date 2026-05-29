// Canonical grade colour scale (A best → F reject). Single source of truth for
// every grade visualisation — charts, filter pills, badges. This is a domain
// data-viz palette (a deliberate green→red ramp), so it lives here as explicit
// values rather than being flattened onto the 4 semantic status tokens.

export const GRADE_COLOR: Record<string, string> = {
  A: '#10b981', // emerald
  B: '#06b6d4', // cyan
  C: '#f59e0b', // amber
  D: '#f97316', // orange
  E: '#f43f5e', // rose
  F: '#ef4444', // red
}

/** Translucent tint of each grade colour, for badge/pill backgrounds. */
export const GRADE_BG: Record<string, string> = {
  A: 'rgba(16,185,129,0.12)',
  B: 'rgba(6,182,212,0.12)',
  C: 'rgba(245,158,11,0.12)',
  D: 'rgba(249,115,22,0.12)',
  E: 'rgba(244,63,94,0.12)',
  F: 'rgba(239,68,68,0.12)',
}
