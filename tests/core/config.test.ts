import { describe, it, expect } from 'vitest'
import { updateSendHistory } from '../../src/core/config.js'
import type { SendHistoryEntry } from '../../src/core/config.js'

describe('updateSendHistory', () => {
  it('adds new entry to empty history', () => {
    const result = updateSendHistory([], '2026-03-11T09:00:00Z', { 'claude-code': 5, 'cursor': 3 })
    expect(result).toHaveLength(1)
    expect(result[0].sessions['claude-code']).toBe(5)
    expect(result[0].sessions['cursor']).toBe(3)
    expect(result[0].sentAt).toBe('2026-03-11T09:00:00Z')
  })

  it('keeps maximum 5 entries, dropping the oldest', () => {
    const existing: SendHistoryEntry[] = Array.from({ length: 5 }, (_, i) => ({
      sentAt: `2026-03-0${i + 1}T09:00:00Z`,
      sessions: { 'claude-code': i }
    }))
    const result = updateSendHistory(existing, '2026-03-11T09:00:00Z', { 'claude-code': 99 })
    expect(result).toHaveLength(5)
    expect(result[4].sessions['claude-code']).toBe(99)
    expect(result[0].sessions['claude-code']).toBe(1) // oldest dropped
  })

  it('appends to existing history under 5 entries', () => {
    const existing: SendHistoryEntry[] = [
      { sentAt: '2026-03-10T09:00:00Z', sessions: { 'claude-code': 10 } }
    ]
    const result = updateSendHistory(existing, '2026-03-11T09:00:00Z', { 'claude-code': 7 })
    expect(result).toHaveLength(2)
  })
})
