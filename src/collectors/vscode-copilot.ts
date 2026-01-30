import fs from 'fs'
import path from 'path'
import os from 'os'
import type { CollectorResult } from '../types.js'

export function collectVSCodeCopilot(): CollectorResult {
  const extensionsDir = path.join(os.homedir(), '.vscode', 'extensions')

  const metrics: CollectorResult['metrics'] = {
    vscodeInstalled: false,
    copilotInstalled: false,
    copilotChatInstalled: false,
    aiExtensions: [] as string[],
  }

  if (!fs.existsSync(extensionsDir)) {
    return { tool: 'vscode-copilot', metrics, collectedAt: new Date().toISOString() }
  }

  metrics.vscodeInstalled = true

  try {
    const extensions = fs.readdirSync(extensionsDir)

    for (const ext of extensions) {
      const lower = ext.toLowerCase()
      if (lower.startsWith('github.copilot-') && !lower.includes('chat')) {
        metrics.copilotInstalled = true
        metrics.aiExtensions.push('GitHub Copilot')
      }
      if (lower.includes('copilot-chat')) {
        metrics.copilotChatInstalled = true
        metrics.aiExtensions.push('GitHub Copilot Chat')
      }
      if (lower.includes('codeium')) {
        metrics.aiExtensions.push('Codeium')
      }
      if (lower.includes('tabnine')) {
        metrics.aiExtensions.push('Tabnine')
      }
      if (lower.includes('continue')) {
        metrics.aiExtensions.push('Continue')
      }
    }

    metrics.aiExtensions = [...new Set(metrics.aiExtensions)]
  } catch {}

  return { tool: 'vscode-copilot', metrics, collectedAt: new Date().toISOString() }
}
