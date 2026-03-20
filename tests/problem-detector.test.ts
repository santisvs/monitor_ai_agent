import { describe, it, expect } from 'vitest'
import { detectProblematicPatterns, type SessionForDetection } from '../src/core/analyzers/problem-detector.js'

function makeSession(tool: string, overrides: Partial<SessionForDetection> = {}): SessionForDetection {
  return {
    tool,
    turns: 10,
    actions: ['plan', 'implement'],
    contextProvisionRate: 0.5,
    messages: [],
    ...overrides,
  }
}

describe('detectProblematicPatterns', () => {
  it('returns empty array when no problematic sessions', () => {
    const sessions = [makeSession('claude-code')]
    const result = detectProblematicPatterns(sessions)
    expect(result['claude-code']).toEqual([])
  })

  it('detects shallow sessions (turns <= 2)', () => {
    const sessions = [
      makeSession('claude-code', { turns: 1 }),
      makeSession('claude-code', { turns: 2 }),
      makeSession('claude-code', { turns: 10 }),
    ]
    const result = detectProblematicPatterns(sessions)
    const shallow = result['claude-code'].find(p => p.pattern === 'shallow')
    expect(shallow).toBeDefined()
    expect(shallow!.count).toBe(2)
  })

  it('detects no-context sessions (contextProvisionRate < 0.1)', () => {
    const sessions = [
      makeSession('cursor', { contextProvisionRate: 0.05 }),
      makeSession('cursor', { contextProvisionRate: 0.0 }),
      makeSession('cursor', { contextProvisionRate: 0.8 }),
    ]
    const result = detectProblematicPatterns(sessions)
    const noCtx = result['cursor'].find(p => p.pattern === 'no-context')
    expect(noCtx!.count).toBe(2)
  })

  it('detects no-plan sessions (implement without plan)', () => {
    const sessions = [
      makeSession('claude-code', { actions: ['implement'] }),
      makeSession('claude-code', { actions: ['plan', 'implement'] }),
      makeSession('claude-code', { actions: ['implement', 'verify'] }),
    ]
    const result = detectProblematicPatterns(sessions)
    const noPlan = result['claude-code'].find(p => p.pattern === 'no-plan')
    expect(noPlan!.count).toBe(2)
  })

  it('assigns severity based on count', () => {
    const sessions = Array.from({ length: 10 }, () =>
      makeSession('claude-code', { turns: 1 }),
    )
    const result = detectProblematicPatterns(sessions)
    const shallow = result['claude-code'].find(p => p.pattern === 'shallow')
    expect(shallow!.severity).toBe('medium') // 10 >= 5 pero < 15
  })

  it('separates patterns by tool', () => {
    const sessions = [
      makeSession('claude-code', { turns: 1 }),
      makeSession('cursor', { turns: 20 }),
    ]
    const result = detectProblematicPatterns(sessions)
    expect(result['claude-code'].find(p => p.pattern === 'shallow')).toBeDefined()
    expect(result['cursor'].find(p => p.pattern === 'shallow')).toBeUndefined()
  })
})
