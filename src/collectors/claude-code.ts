import fs from 'fs'
import path from 'path'
import os from 'os'
import type {
  CollectorResult,
  ExtendedMetrics,
  ClaudeMessage,
  SessionIndex,
  StatsCache,
  ModelUsage,
  SessionDetail,
  TaskType,
} from '../types.js'
import { inferTaskType, detectsPlanMode } from '../task-inference.js'
import { encrypt, isValidEncryptionKey } from '../crypto.js'
import { loadConfig } from '../config.js'

interface SessionAnalysis {
  sessionId: string
  turns: number
  tokens: number
  model: string
  toolsUsed: string[]
  usesExtendedThinking: boolean
  summary?: string
  firstPrompt?: string
  taskType: TaskType
}

/**
 * Collector para Claude Code.
 * Parsea ~/.claude/projects/ y stats-cache.json para extraer métricas detalladas.
 */
export function collectClaudeCode(): CollectorResult {
  const claudeDir = path.join(os.homedir(), '.claude')
  const projectsDir = path.join(claudeDir, 'projects')
  const statsCachePath = path.join(claudeDir, 'stats-cache.json')

  const metrics: ExtendedMetrics = {
    sessionsCount: 0,
    totalTokens: 0,
    lastUsed: null,
    timeSpentMinutes: 0,
    installed: false,
    projectsCount: 0,
    avgTurnsPerSession: 0,
    avgTokensPerSession: 0,
    toolsUsedPerSession: [],
    sessionFrequency: 0,
    inputOutputRatio: 0,
    usesPlanMode: false,
    usesExtendedThinking: false,
    modelsUsed: [],
    modelDiversity: 0,
  }

  if (!fs.existsSync(claudeDir)) {
    return { tool: 'claude-code', metrics, collectedAt: new Date().toISOString() }
  }

  metrics.installed = true

  // Obtener clave de encriptación si existe
  let encryptionKey: string | undefined
  try {
    const config = loadConfig()
    encryptionKey = config.encryptionKey
  } catch {
    // No hay config, continuar sin encriptación
  }

  // Analizar stats-cache.json para tokens totales
  let totalInputTokens = 0
  let totalOutputTokens = 0

  if (fs.existsSync(statsCachePath)) {
    try {
      const statsCache: StatsCache = JSON.parse(fs.readFileSync(statsCachePath, 'utf-8'))
      if (statsCache.dailyModelTokens) {
        for (const dayData of Object.values(statsCache.dailyModelTokens)) {
          for (const modelData of Object.values(dayData)) {
            totalInputTokens += modelData.input || 0
            totalOutputTokens += modelData.output || 0
          }
        }
      }
      metrics.totalTokens = totalInputTokens + totalOutputTokens
      metrics.inputOutputRatio = totalOutputTokens > 0
        ? Math.round((totalInputTokens / totalOutputTokens) * 100) / 100
        : 0
    } catch {
      // Error parseando stats-cache, continuar
    }
  }

  if (!fs.existsSync(projectsDir)) {
    return { tool: 'claude-code', metrics, collectedAt: new Date().toISOString() }
  }

  // Analizar proyectos y sesiones
  const sessionAnalyses: SessionAnalysis[] = []
  const modelUsageMap = new Map<string, { sessions: number, tokens: number, turns: number, taskTypes: Set<TaskType> }>()
  const allToolsUsed = new Set<string>()
  let latestTime = 0
  let totalTurns = 0
  let usesPlanMode = false
  let usesExtendedThinking = false
  let projectCount = 0
  const sessionDates: number[] = []

  try {
    const projects = fs.readdirSync(projectsDir)

    for (const project of projects) {
      const projectPath = path.join(projectsDir, project)
      const stat = fs.statSync(projectPath)
      if (!stat.isDirectory()) continue

      projectCount++

      // Buscar sessions-index.json
      const sessionsIndexPath = path.join(projectPath, 'sessions-index.json')
      let sessionIndex: SessionIndex = {}
      if (fs.existsSync(sessionsIndexPath)) {
        try {
          sessionIndex = JSON.parse(fs.readFileSync(sessionsIndexPath, 'utf-8'))
        } catch {
          // Error parseando sessions-index
        }
      }

      // Buscar archivos .jsonl de sesiones
      const sessionDir = path.join(projectPath, '.session')
      if (!fs.existsSync(sessionDir)) continue

      const sessionFiles = fs.readdirSync(sessionDir).filter(f => f.endsWith('.jsonl'))

      for (const sessionFile of sessionFiles) {
        const sessionPath = path.join(sessionDir, sessionFile)
        const sessionId = sessionFile.replace('.jsonl', '')

        try {
          const fileStat = fs.statSync(sessionPath)
          if (fileStat.mtimeMs > latestTime) {
            latestTime = fileStat.mtimeMs
          }
          sessionDates.push(fileStat.mtimeMs)

          // Analizar contenido de la sesión
          const analysis = analyzeSession(sessionPath, sessionId, sessionIndex)
          if (analysis) {
            sessionAnalyses.push(analysis)
            totalTurns += analysis.turns

            // Actualizar estadísticas por modelo
            const modelStats = modelUsageMap.get(analysis.model) || {
              sessions: 0,
              tokens: analysis.tokens,
              turns: 0,
              taskTypes: new Set<TaskType>(),
            }
            modelStats.sessions++
            modelStats.tokens += analysis.tokens
            modelStats.turns += analysis.turns
            modelStats.taskTypes.add(analysis.taskType)
            modelUsageMap.set(analysis.model, modelStats)

            // Acumular herramientas
            for (const tool of analysis.toolsUsed) {
              allToolsUsed.add(tool)
            }

            if (analysis.usesExtendedThinking) {
              usesExtendedThinking = true
            }

            if (detectsPlanMode(analysis.summary || '')) {
              usesPlanMode = true
            }
          }
        } catch {
          // Error analizando sesión
        }
      }
    }
  } catch {
    // Error leyendo proyectos
  }

  // Calcular métricas agregadas
  metrics.sessionsCount = sessionAnalyses.length
  metrics.projectsCount = projectCount

  if (latestTime > 0) {
    metrics.lastUsed = new Date(latestTime).toISOString()
  }

  if (sessionAnalyses.length > 0) {
    metrics.avgTurnsPerSession = Math.round((totalTurns / sessionAnalyses.length) * 10) / 10
    metrics.avgTokensPerSession = Math.round((metrics.totalTokens || 0) / sessionAnalyses.length)
  }

  metrics.toolsUsedPerSession = Array.from(allToolsUsed)
  metrics.usesPlanMode = usesPlanMode
  metrics.usesExtendedThinking = usesExtendedThinking

  // Calcular frecuencia de sesiones (sesiones por semana)
  if (sessionDates.length > 1) {
    const now = Date.now()
    const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000
    const recentSessions = sessionDates.filter(d => d > oneWeekAgo).length
    metrics.sessionFrequency = recentSessions
  }

  // Construir modelsUsed
  const modelsUsed: ModelUsage[] = []
  for (const [model, stats] of modelUsageMap) {
    modelsUsed.push({
      model,
      sessions: stats.sessions,
      tokens: stats.tokens,
      avgTurnsPerSession: stats.turns > 0 ? Math.round((stats.turns / stats.sessions) * 10) / 10 : 0,
      typicalTaskTypes: Array.from(stats.taskTypes),
    })
  }
  metrics.modelsUsed = modelsUsed.sort((a, b) => b.sessions - a.sessions)
  metrics.modelDiversity = modelsUsed.length

  // Encriptar datos sensibles si hay clave
  if (isValidEncryptionKey(encryptionKey) && sessionAnalyses.length > 0) {
    const sessionDetails: SessionDetail[] = sessionAnalyses.map(s => ({
      sessionId: s.sessionId,
      summary: sanitizeText(s.summary || ''),
      firstPrompt: sanitizeText(s.firstPrompt || ''),
      taskType: s.taskType,
    }))

    try {
      metrics.encrypted = encrypt(sessionDetails, encryptionKey!)
    } catch {
      // Error encriptando, continuar sin datos sensibles
    }
  }

  return { tool: 'claude-code', metrics, collectedAt: new Date().toISOString() }
}

/**
 * Analiza una sesión individual leyendo el archivo .jsonl
 */
function analyzeSession(
  sessionPath: string,
  sessionId: string,
  sessionIndex: SessionIndex,
): SessionAnalysis | null {
  try {
    const content = fs.readFileSync(sessionPath, 'utf-8')
    const lines = content.trim().split('\n').filter(l => l.trim())

    let turns = 0
    let tokens = 0
    let model = 'unknown'
    const toolsUsed = new Set<string>()
    let usesExtendedThinking = false
    let firstPrompt = ''

    for (const line of lines) {
      try {
        const msg: ClaudeMessage = JSON.parse(line)

        // Contar turnos (mensajes de usuario y asistente)
        if (msg.message?.role === 'user' || msg.message?.role === 'assistant') {
          turns++
        }

        // Capturar modelo
        if (msg.message?.model && msg.message.model !== 'unknown') {
          model = msg.message.model
        }

        // Detectar extended thinking
        if (msg.thinkingMetadata?.maxThinkingTokens && msg.thinkingMetadata.maxThinkingTokens > 0) {
          usesExtendedThinking = true
        }

        // Extraer herramientas usadas
        if (msg.message?.tool_calls && Array.isArray(msg.message.tool_calls)) {
          for (const call of msg.message.tool_calls) {
            if (typeof call === 'object' && call !== null && 'name' in call) {
              toolsUsed.add((call as { name: string }).name.toLowerCase())
            }
          }
        }

        // Capturar primer prompt del usuario (sin contenido sensible)
        if (msg.message?.role === 'user' && !firstPrompt) {
          const content = msg.message.content
          if (typeof content === 'string') {
            // Solo tomar las primeras palabras para clasificación
            firstPrompt = content.slice(0, 200)
          }
        }
      } catch {
        // Error parseando línea individual
      }
    }

    // Buscar summary en el índice
    let summary = ''
    if (sessionIndex.sessions) {
      const indexEntry = sessionIndex.sessions.find(s => s.sessionId === sessionId)
      if (indexEntry?.summary) {
        summary = indexEntry.summary
      }
      if (indexEntry?.firstPrompt && !firstPrompt) {
        firstPrompt = indexEntry.firstPrompt
      }
    }

    // Inferir tipo de tarea
    const taskType = inferTaskType(summary, firstPrompt)

    return {
      sessionId,
      turns,
      tokens, // Tokens se calculan desde stats-cache
      model,
      toolsUsed: Array.from(toolsUsed),
      usesExtendedThinking,
      summary,
      firstPrompt,
      taskType,
    }
  } catch {
    return null
  }
}

/**
 * Sanitiza texto para eliminar información potencialmente sensible
 * (rutas, nombres de usuario, etc.)
 */
function sanitizeText(text: string): string {
  if (!text) return ''

  // Eliminar rutas absolutas
  let sanitized = text.replace(/[A-Za-z]:\\[^\s"'<>|]+/g, '[PATH]')
  sanitized = sanitized.replace(/\/(?:home|Users)\/[^\s"'<>|/]+/g, '[HOME]')

  // Limitar longitud
  if (sanitized.length > 500) {
    sanitized = sanitized.slice(0, 500) + '...'
  }

  return sanitized
}
