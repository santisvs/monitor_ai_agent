import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { SyncStateManager } from '../src/core/sync-state.js'

const TEST_STATE_PATH = join(__dirname, '.tmp-sync-state.json')

describe('SyncStateManager', () => {
  let manager: SyncStateManager

  beforeEach(() => {
    manager = new SyncStateManager(TEST_STATE_PATH)
  })

  afterEach(() => {
    if (existsSync(TEST_STATE_PATH)) rmSync(TEST_STATE_PATH)
  })

  it('returns null lastSyncedAt when no state file exists', () => {
    expect(manager.getLastSyncedAt('claude-code')).toBeNull()
  })

  it('persists and retrieves lastSyncedAt per tool', () => {
    const date = new Date('2026-03-20T10:00:00.000Z')
    manager.setLastSyncedAt('claude-code', date)
    expect(manager.getLastSyncedAt('claude-code')).toEqual(date)
  })

  it('stores different dates for different tools', () => {
    const d1 = new Date('2026-03-20T10:00:00.000Z')
    const d2 = new Date('2026-03-20T08:00:00.000Z')
    manager.setLastSyncedAt('claude-code', d1)
    manager.setLastSyncedAt('cursor', d2)
    expect(manager.getLastSyncedAt('claude-code')).toEqual(d1)
    expect(manager.getLastSyncedAt('cursor')).toEqual(d2)
  })

  it('returns null for unknown tool even if state file exists', () => {
    manager.setLastSyncedAt('claude-code', new Date())
    expect(manager.getLastSyncedAt('gemini')).toBeNull()
  })

  it('survives corrupted state file with graceful fallback', () => {
    writeFileSync(TEST_STATE_PATH, 'not-valid-json')
    const m2 = new SyncStateManager(TEST_STATE_PATH)
    expect(m2.getLastSyncedAt('claude-code')).toBeNull()
  })
})
