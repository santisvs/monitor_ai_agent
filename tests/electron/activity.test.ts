import { describe, it, expect } from 'vitest'
import { calculateActivityLevel } from '../../src/electron/activity.js'
import type { SendHistoryEntry } from '../../src/core/config.js'

describe('calculateActivityLevel', () => {
  it('returns none for 0 sessions', () => {
    const result = calculateActivityLevel(0, [])
    expect(result.level).toBe('none')
    expect(result.percentage).toBe(0)
  })

  describe('fixed thresholds (no history)', () => {
    it('returns low for < 3 sessions', () => {
      expect(calculateActivityLevel(2, []).level).toBe('low')
    })

    it('returns normal for 3–10 sessions', () => {
      expect(calculateActivityLevel(3, []).level).toBe('normal')
      expect(calculateActivityLevel(10, []).level).toBe('normal')
    })

    it('returns high for > 10 sessions', () => {
      expect(calculateActivityLevel(11, []).level).toBe('high')
    })
  })

  describe('personal baseline (with history)', () => {
    const history: SendHistoryEntry[] = [
      { sentAt: '2026-03-10T00:00:00Z', sessions: { 'claude-code': 10 } },
      { sentAt: '2026-03-09T00:00:00Z', sessions: { 'claude-code': 10 } },
    ]

    it('returns low when current is < 50% of avg', () => {
      // avg = 10, current = 4 (40%) → low
      expect(calculateActivityLevel(4, history, 'claude-code').level).toBe('low')
    })

    it('returns normal when current is 50–150% of avg', () => {
      // avg = 10, current = 10 (100%) → normal
      expect(calculateActivityLevel(10, history, 'claude-code').level).toBe('normal')
    })

    it('returns high when current is > 150% of avg', () => {
      // avg = 10, current = 16 (160%) → high
      expect(calculateActivityLevel(16, history, 'claude-code').level).toBe('high')
    })

    it('percentage is capped at 100', () => {
      expect(calculateActivityLevel(100, history, 'claude-code').percentage).toBeLessThanOrEqual(100)
    })

    it('returns normal at exactly 50% of avg (boundary)', () => {
      // avg = 10, current = 5 (50%) → normal
      const history: SendHistoryEntry[] = [
        { sentAt: '2026-03-10T00:00:00Z', sessions: { 'claude-code': 10 } },
      ]
      expect(calculateActivityLevel(5, history, 'claude-code').level).toBe('normal')
    })
    it('returns normal at exactly 150% of avg (boundary)', () => {
      // avg = 10, current = 15 (150%) → normal
      const history: SendHistoryEntry[] = [
        { sentAt: '2026-03-10T00:00:00Z', sessions: { 'claude-code': 10 } },
      ]
      expect(calculateActivityLevel(15, history, 'claude-code').level).toBe('normal')
    })
  })

  describe('aggregate baseline (history, no tool specified)', () => {
    const history: SendHistoryEntry[] = [
      { sentAt: '2026-03-10T00:00:00Z', sessions: { 'claude-code': 6, cursor: 4 } },
      { sentAt: '2026-03-09T00:00:00Z', sessions: { 'claude-code': 4, cursor: 6 } },
    ]
    // avg total = 10 per cycle
    it('returns normal when aggregate sessions match avg', () => {
      expect(calculateActivityLevel(10, history).level).toBe('normal')
    })
    it('returns low when aggregate sessions are below 50% of avg', () => {
      expect(calculateActivityLevel(4, history).level).toBe('low')
    })
  })
})
