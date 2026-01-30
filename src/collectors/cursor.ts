import fs from 'fs'
import path from 'path'
import os from 'os'
import type { CollectorResult } from '../types.js'

export function collectCursor(): CollectorResult {
  const platform = os.platform()
  let cursorDir: string

  if (platform === 'win32') {
    cursorDir = path.join(process.env.APPDATA || '', 'Cursor')
  } else if (platform === 'darwin') {
    cursorDir = path.join(os.homedir(), 'Library', 'Application Support', 'Cursor')
  } else {
    cursorDir = path.join(os.homedir(), '.config', 'Cursor')
  }

  const metrics: CollectorResult['metrics'] = {
    installed: false,
    lastUsed: null,
  }

  if (!fs.existsSync(cursorDir)) {
    return { tool: 'cursor', metrics, collectedAt: new Date().toISOString() }
  }

  metrics.installed = true

  try {
    const stat = fs.statSync(cursorDir)
    metrics.lastUsed = stat.mtime.toISOString()
  } catch {}

  // Check for User settings
  const settingsPath = path.join(cursorDir, 'User', 'settings.json')
  if (fs.existsSync(settingsPath)) {
    try {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))
      metrics.hasAiFeatures = !!(settings['cursor.ai'] || settings['cursor.chat'])
    } catch {}
  }

  // Check storage for usage data
  const storagePath = path.join(cursorDir, 'User', 'globalStorage')
  if (fs.existsSync(storagePath)) {
    try {
      const items = fs.readdirSync(storagePath)
      metrics.extensionsCount = items.length
    } catch {}
  }

  return { tool: 'cursor', metrics, collectedAt: new Date().toISOString() }
}
