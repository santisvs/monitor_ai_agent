import type { ProblematicSession, Severity } from '../types.js'

export interface SessionForDetection {
  tool: string
  turns: number
  actions: string[]
  contextProvisionRate: number
  messages?: Array<{ role: string; content: string }>
}

function getSeverityByCount(count: number, low: number, high: number): Severity {
  if (count >= high) return 'high'
  if (count >= low) return 'medium'
  return 'low'
}

function detectRepetitiveCorrections(
  messages: Array<{ role: string; content: string }>,
): boolean {
  const userMessages = messages
    .filter(m => m.role === 'user')
    .map(m => m.content.toLowerCase().trim())

  let consecutiveSimilar = 0
  for (let i = 1; i < userMessages.length; i++) {
    const prev = userMessages[i - 1]
    const curr = userMessages[i]
    if (!prev || !curr) continue

    const prevWords = new Set(prev.split(/\s+/))
    const currWords = curr.split(/\s+/)
    const shared = currWords.filter(w => prevWords.has(w)).length
    const similarity = shared / Math.max(prevWords.size, currWords.length)

    if (similarity > 0.8) {
      consecutiveSimilar++
      if (consecutiveSimilar >= 3) return true
    }
    else {
      consecutiveSimilar = 0
    }
  }
  return false
}

export function detectProblematicPatterns(
  sessions: SessionForDetection[],
): Record<string, ProblematicSession[]> {
  const byTool = new Map<string, SessionForDetection[]>()
  for (const s of sessions) {
    const tool = s.tool ?? 'unknown'
    if (!byTool.has(tool)) byTool.set(tool, [])
    byTool.get(tool)!.push(s)
  }

  const result: Record<string, ProblematicSession[]> = {}

  for (const [tool, toolSessions] of byTool) {
    const patterns: ProblematicSession[] = []

    // shallow: turns <= 2
    const shallowCount = toolSessions.filter(s => s.turns <= 2).length
    if (shallowCount > 0) {
      patterns.push({
        pattern: 'shallow',
        count: shallowCount,
        severity: getSeverityByCount(shallowCount, 5, 15),
      })
    }

    // no-context: contextProvisionRate < 0.1
    const noCtxCount = toolSessions.filter(s => s.contextProvisionRate < 0.1).length
    if (noCtxCount > 0) {
      patterns.push({
        pattern: 'no-context',
        count: noCtxCount,
        severity: getSeverityByCount(noCtxCount, 5, 15),
      })
    }

    // no-plan: implement without plan action
    const noPlanCount = toolSessions.filter(
      s => s.actions.includes('implement') && !s.actions.includes('plan'),
    ).length
    if (noPlanCount > 0) {
      patterns.push({
        pattern: 'no-plan',
        count: noPlanCount,
        severity: getSeverityByCount(noPlanCount, 3, 8),
      })
    }

    // repetitive-corrections
    const repCount = toolSessions.filter(
      s => s.messages && s.messages.length > 0 && detectRepetitiveCorrections(s.messages),
    ).length
    if (repCount > 0) {
      patterns.push({
        pattern: 'repetitive-corrections',
        count: repCount,
        severity: getSeverityByCount(repCount, 3, 8),
      })
    }

    result[tool] = patterns
  }

  return result
}
