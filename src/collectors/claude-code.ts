import fs from 'fs'
import path from 'path'
import os from 'os'
import type { CollectorResult } from '../types.js'

export function collectClaudeCode(): CollectorResult {
  const claudeDir = path.join(os.homedir(), '.claude')
  const projectsDir = path.join(claudeDir, 'projects')

  const metrics: CollectorResult['metrics'] = {
    sessionsCount: 0,
    lastUsed: null,
    installed: false,
  }

  if (!fs.existsSync(claudeDir)) {
    return { tool: 'claude-code', metrics, collectedAt: new Date().toISOString() }
  }

  metrics.installed = true

  if (fs.existsSync(projectsDir)) {
    try {
      const projects = fs.readdirSync(projectsDir)
      let totalSessions = 0
      let latestTime = 0

      for (const project of projects) {
        const projectPath = path.join(projectsDir, project)
        const stat = fs.statSync(projectPath)
        if (!stat.isDirectory()) continue

        const files = fs.readdirSync(projectPath)
        const sessionFiles = files.filter(f => f.endsWith('.jsonl'))
        totalSessions += sessionFiles.length

        for (const file of sessionFiles) {
          const fileStat = fs.statSync(path.join(projectPath, file))
          if (fileStat.mtimeMs > latestTime) {
            latestTime = fileStat.mtimeMs
          }
        }
      }

      metrics.sessionsCount = totalSessions
      if (latestTime > 0) {
        metrics.lastUsed = new Date(latestTime).toISOString()
      }
      metrics.projectsCount = projects.filter(p =>
        fs.statSync(path.join(projectsDir, p)).isDirectory(),
      ).length
    } catch {}
  }

  return { tool: 'claude-code', metrics, collectedAt: new Date().toISOString() }
}
