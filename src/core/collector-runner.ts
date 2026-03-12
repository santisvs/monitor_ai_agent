import { collectClaudeCode } from './collectors/claude-code.js'
import { collectVSCodeCopilot } from './collectors/vscode-copilot.js'
import type { AgentConfig } from './config.js'
import type { CollectorResult } from './types.js'

// Note: cursor collector is async and uses sql.js (WASM); it is excluded from the electron
// tsconfig to avoid bundling issues. It can be imported dynamically if needed.
const SYNC_COLLECTORS: Record<string, () => CollectorResult | Promise<CollectorResult>> = {
  'claude-code': collectClaudeCode,
  'vscode-copilot': collectVSCodeCopilot,
}

export async function collectAll(config: AgentConfig): Promise<CollectorResult[]> {
  const results: CollectorResult[] = []
  for (const tool of config.enabledCollectors ?? []) {
    if (tool === 'cursor') {
      // cursor uses sql.js (WASM) — import dynamically so the electron build
      // can exclude it from the static bundle if needed.
      // Use Function constructor to prevent TypeScript from statically analysing the import path.
      try {
        const cursorPath = require('path').join(__dirname, 'collectors', 'cursor.js')
        // eslint-disable-next-line @typescript-eslint/no-implied-eval
        const mod = await (new Function('p', 'return import(p)')(cursorPath)) as { collectCursor: () => Promise<import('./types.js').CollectorResult> }
        results.push(await mod.collectCursor())
      } catch {
        // non-fatal — skip failed collector
      }
      continue
    }
    const collector = SYNC_COLLECTORS[tool]
    if (collector) {
      try {
        results.push(await Promise.resolve(collector()))
      } catch {
        // non-fatal — skip failed collector
      }
    }
  }
  return results
}
