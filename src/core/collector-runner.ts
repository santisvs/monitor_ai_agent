import { collectClaudeCode } from './collectors/claude-code.js'
import { collectVSCodeCopilot } from './collectors/vscode-copilot.js'
import type { AgentConfig } from './config.js'
import type { CollectorResult } from './types.js'
import { SyncStateManager, DEFAULT_SYNC_STATE_PATH } from './sync-state.js'

// Note: cursor collector uses sql.js (WASM) and is compiled separately via esbuild
// (electron:bundle:cursor) to handle import.meta.url → __dirname conversion.
// Loaded via require() at runtime so Electron's asar patching applies.
const SYNC_COLLECTORS: Record<string, () => CollectorResult | Promise<CollectorResult>> = {
  'vscode-copilot': collectVSCodeCopilot,
}

export async function collectAll(config: AgentConfig): Promise<CollectorResult[]> {
  const syncState = new SyncStateManager(DEFAULT_SYNC_STATE_PATH)
  const results: CollectorResult[] = []

  for (const tool of config.enabledCollectors ?? []) {
    if (tool === 'claude-code') {
      try {
        results.push(await Promise.resolve(collectClaudeCode(syncState)))
      }
      catch {
        // non-fatal — skip failed collector
      }
      continue
    }

    if (tool === 'cursor') {
      // cursor.js is compiled separately via esbuild and loaded synchronously.
      // require() is patched by Electron to support asar virtual filesystem.
      try {
        const cursorPath = require('path').join(__dirname, 'collectors', 'cursor')
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const mod = require(cursorPath) as { collectCursor: (s: SyncStateManager) => Promise<CollectorResult> }
        results.push(await mod.collectCursor(syncState))
      }
      catch {
        // non-fatal — skip failed collector
      }
      continue
    }

    const collector = SYNC_COLLECTORS[tool]
    if (collector) {
      try {
        results.push(await Promise.resolve(collector()))
      }
      catch {
        // non-fatal — skip failed collector
      }
    }
  }

  return results
}
