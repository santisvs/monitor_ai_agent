import fs from 'fs'
import path from 'path'
import os from 'os'
import type { CollectorResult, ExtendedMetrics } from '../types.js'

export function collectVSCodeCopilot(): CollectorResult {
  const extensionsDir = path.join(os.homedir(), '.vscode', 'extensions')

  const metrics: ExtendedMetrics = {
    vscodeInstalled: false,
    copilotInstalled: false,
    copilotChatInstalled: false,
    aiExtensions: [],
  }

  if (!fs.existsSync(extensionsDir)) {
    return { tool: 'vscode-copilot', metrics, collectedAt: new Date().toISOString() }
  }

  metrics.vscodeInstalled = true
  const aiExtensions: string[] = []

  try {
    const extensions = fs.readdirSync(extensionsDir)

    for (const ext of extensions) {
      const lower = ext.toLowerCase()
      if (lower.startsWith('github.copilot-') && !lower.includes('chat')) {
        metrics.copilotInstalled = true
        aiExtensions.push('GitHub Copilot')
      }
      if (lower.includes('copilot-chat')) {
        metrics.copilotChatInstalled = true
        aiExtensions.push('GitHub Copilot Chat')
      }
      if (lower.includes('codeium')) {
        aiExtensions.push('Codeium')
      }
      if (lower.includes('tabnine')) {
        aiExtensions.push('Tabnine')
      }
      if (lower.includes('continue')) {
        aiExtensions.push('Continue')
      }
    }

    metrics.aiExtensions = [...new Set(aiExtensions)]
  } catch {}

  return { tool: 'vscode-copilot', metrics, collectedAt: new Date().toISOString() }
}
