import type { SendHistoryEntry } from '../core/config.js'

export interface ActivityLevel {
  level: 'high' | 'normal' | 'low' | 'none'
  percentage: number
}

export function calculateActivityLevel(
  currentSessions: number,
  history: SendHistoryEntry[],
  tool?: string
): ActivityLevel {
  if (currentSessions === 0) return { level: 'none', percentage: 0 }

  const relevant = tool
    ? history.filter(h => h.sessions[tool] !== undefined)
    : history

  if (relevant.length === 0) {
    // Fixed thresholds: <3 low, 3-10 normal, >10 high
    if (currentSessions < 3) return { level: 'low', percentage: Math.round((currentSessions / 3) * 50) }
    if (currentSessions <= 10) return { level: 'normal', percentage: Math.round(50 + ((currentSessions - 3) / 7) * 50) }
    return { level: 'high', percentage: 100 }
  }

  const avg = relevant.reduce((sum, h) => {
    const val = tool ? (h.sessions[tool] ?? 0) : Object.values(h.sessions).reduce((a, b) => a + b, 0)
    return sum + val
  }, 0) / relevant.length

  if (avg === 0) return { level: 'none', percentage: 0 }

  const ratio = currentSessions / avg
  const percentage = Math.min(100, Math.round(ratio * 100))

  if (ratio < 0.5) return { level: 'low', percentage }
  if (ratio <= 1.5) return { level: 'normal', percentage }
  return { level: 'high', percentage }
}
