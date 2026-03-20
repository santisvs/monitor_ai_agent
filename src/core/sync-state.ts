import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { homedir } from 'os'

export const DEFAULT_SYNC_STATE_PATH = join(homedir(), '.jakite', 'sync-state.json')

interface SyncState {
  perTool: Record<string, { lastSyncedAt: string }>
}

export class SyncStateManager {
  private state: SyncState
  private filePath: string

  constructor(filePath: string = DEFAULT_SYNC_STATE_PATH) {
    this.filePath = filePath
    this.state = this._load()
  }

  getLastSyncedAt(tool: string): Date | null {
    const entry = this.state.perTool[tool]
    if (!entry) return null
    return new Date(entry.lastSyncedAt)
  }

  setLastSyncedAt(tool: string, date: Date): void {
    this.state.perTool[tool] = { lastSyncedAt: date.toISOString() }
    this._save()
  }

  private _load(): SyncState {
    try {
      const raw = readFileSync(this.filePath, 'utf-8')
      return JSON.parse(raw) as SyncState
    }
    catch {
      return { perTool: {} }
    }
  }

  private _save(): void {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true })
      writeFileSync(this.filePath, JSON.stringify(this.state, null, 2), 'utf-8')
    }
    catch (err) {
      console.warn('[SyncState] Could not save state:', err)
    }
  }
}
