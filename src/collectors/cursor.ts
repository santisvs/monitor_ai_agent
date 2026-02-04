import fs from 'fs'
import path from 'path'
import os from 'os'
import type {
  CollectorResult,
  ExtendedMetrics,
  ModelUsage,
  SessionDetail,
  TaskType,
} from '../types.js'
import { inferTaskType, detectsPlanMode } from '../task-inference.js'
import { encrypt, isValidEncryptionKey } from '../crypto.js'
import { loadConfig } from '../config.js'

/** Key en ItemTable de state.vscdb donde Cursor guarda el chat (formato puede variar entre versiones). */
const CHATDATA_KEY = 'workbench.panel.aichat.view.aichat.chatdata'

/** Con DEBUG_CURSOR=1 se muestra en consola por qué no se encuentran sesiones (sql.js, clave, claves existentes). */
const DEBUG_CURSOR = process.env.DEBUG_CURSOR === '1' || process.env.MONITOR_IA_AGENT_DEBUG_CURSOR === '1'

interface SQLiteDB {
  prepare(sql: string): { bind(params: unknown[]): void; step(): boolean; getAsObject(): Record<string, unknown>; free(): void }
  close(): void
}

/** Un bubble (mensaje) en un tab de Cursor */
interface CursorBubble {
  type?: 'user' | 'ai'
  text?: string
  rawText?: string
  initText?: string
  delegate?: { a?: string }
  modelType?: string
  selections?: Array<{ text?: string }>
  image?: { path?: string }
}

/**
 * Estructura conocida del JSON de Cursor (según cursor-chat-export y foros).
 * Valor de ItemTable[key] = CHATDATA_KEY.
 */
interface CursorChatData {
  tabs?: Array<{
    timestamp?: number
    bubbles?: CursorBubble[]
  }>
}

interface SessionAnalysis {
  sessionId: string
  turns: number
  tokens: number
  model: string
  toolsUsed: string[]
  summary: string
  firstPrompt: string
  taskType: TaskType
}

function getCursorWorkspaceStorageDir(): string {
  const platform = os.platform()
  let base: string
  if (platform === 'win32') {
    base = path.join(process.env.APPDATA || '', 'Cursor')
  } else if (platform === 'darwin') {
    base = path.join(os.homedir(), 'Library', 'Application Support', 'Cursor')
  } else {
    base = path.join(os.homedir(), '.config', 'Cursor')
  }
  return path.join(base, 'User', 'workspaceStorage')
}

function sanitizeText(text: string): string {
  if (!text) return ''
  let sanitized = text.replace(/[A-Za-z]:\\[^\s"'<>|]+/g, '[PATH]')
  sanitized = sanitized.replace(/\/(?:home|Users)\/[^\s"'<>|/]+/g, '[HOME]')
  if (sanitized.length > 500) {
    sanitized = sanitized.slice(0, 500) + '...'
  }
  return sanitized
}

function extractUserBubbleText(bubble: CursorBubble): string {
  if (!bubble) return ''
  if (bubble.delegate?.a) return bubble.delegate.a
  if (bubble.text) return bubble.text
  if (bubble.rawText) return bubble.rawText
  if (bubble.initText) {
    try {
      const parsed = JSON.parse(bubble.initText) as { root?: { children?: Array<{ children?: Array<{ text?: string }> }> } }
      const text = parsed?.root?.children?.[0]?.children?.[0]?.text
      return typeof text === 'string' ? text : ''
    } catch {
      return ''
    }
  }
  return ''
}

/**
 * Parsea el JSON de chatdata y devuelve sesiones (una por tab) con turns, firstPrompt, model, etc.
 */
function parseChatDataToSessions(
  chatJson: string,
  workspaceId: string,
): SessionAnalysis[] {
  const sessions: SessionAnalysis[] = []
  let data: CursorChatData
  try {
    data = JSON.parse(chatJson) as CursorChatData
  } catch {
    return sessions
  }
  const tabs = data.tabs
  if (!Array.isArray(tabs)) return sessions

  for (let tabIndex = 0; tabIndex < tabs.length; tabIndex++) {
    const tab = tabs[tabIndex]
    const bubbles = tab?.bubbles
    if (!Array.isArray(bubbles) || bubbles.length === 0) continue

    let turns = 0
    let firstPrompt = ''
    let model = 'cursor'
    const toolsUsed: string[] = []

    for (const bubble of bubbles) {
      const type = bubble?.type
      if (type === 'user' || type === 'ai') {
        turns++
      }
      if (type === 'user' && !firstPrompt) {
        firstPrompt = extractUserBubbleText(bubble)
      }
      if (type === 'ai' && bubble?.modelType) {
        model = bubble.modelType
      }
    }

    const summary = firstPrompt ? firstPrompt.slice(0, 150).trim() + (firstPrompt.length > 150 ? '...' : '') : ''
    const taskType = inferTaskType(summary, firstPrompt)
    const sessionId = `${workspaceId}_tab_${tabIndex}`

    sessions.push({
      sessionId,
      turns,
      tokens: 0,
      model,
      toolsUsed,
      summary,
      firstPrompt,
      taskType,
    })
  }
  return sessions
}

/**
 * Lee state.vscdb (SQLite) y devuelve el valor de CHATDATA_KEY si existe.
 * Usa sql.js (WASM) para no depender de binarios nativos.
 * Si logKeysIfMissing y no hay valor, lista claves de ItemTable (solo una vez por ejecución para no repetir).
 */
async function readChatDataFromStateVscdb(dbPath: string, logKeysIfMissing = false): Promise<string | null> {
  let SQL: { Database: new (data?: BufferSource) => SQLiteDB }
  try {
    const init = (await import('sql.js')).default as (config?: unknown) => Promise<{ Database: new (data?: BufferSource) => SQLiteDB }>
    SQL = await init()
  } catch (e) {
    if (DEBUG_CURSOR) console.warn('[Cursor debug] sql.js no pudo cargar:', (e as Error).message)
    return null
  }
  let buffer: Uint8Array
  try {
    buffer = new Uint8Array(fs.readFileSync(dbPath))
  } catch (e) {
    if (DEBUG_CURSOR) console.warn('[Cursor debug] no se pudo leer archivo:', dbPath, (e as Error).message)
    return null
  }
  let db: SQLiteDB
  try {
    db = new SQL.Database(buffer as unknown as BufferSource)
  } catch (e) {
    if (DEBUG_CURSOR) console.warn('[Cursor debug] no se pudo abrir SQLite:', dbPath, (e as Error).message)
    return null
  }
  try {
    const stmt = db.prepare('SELECT value FROM ItemTable WHERE key = ?')
    stmt.bind([CHATDATA_KEY])
    if (stmt.step()) {
      const row = stmt.getAsObject() as { value?: string }
      const value = row?.value
      stmt.free()
      db.close()
      return typeof value === 'string' ? value : null
    }
    stmt.free()
    if (logKeysIfMissing) {
      const keysStmt = db.prepare('SELECT key FROM ItemTable')
      const keys: string[] = []
      while (keysStmt.step()) {
        const o = keysStmt.getAsObject() as { key?: string }
        if (o?.key) keys.push(o.key)
        if (keys.length >= 40) break
      }
      keysStmt.free()
      const chatKeys = keys.filter(k => /chat|aichat|ai\.service/i.test(k))
      console.warn('[Cursor debug] clave no encontrada:', CHATDATA_KEY)
      console.warn('[Cursor debug] claves en ItemTable (máx. 40, filtro chat/aichat):', chatKeys.length ? chatKeys : keys.slice(0, 20))
    }
  } catch (e) {
    if (DEBUG_CURSOR) console.warn('[Cursor debug] error al leer ItemTable:', (e as Error).message)
  }
  db.close()
  return null
}

export async function collectCursor(): Promise<CollectorResult> {
  const workspaceStorageDir = getCursorWorkspaceStorageDir()
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
    hasAiFeatures: false,
    extensionsCount: undefined,
  }

  if (!fs.existsSync(workspaceStorageDir)) {
    const cursorDir = path.dirname(path.dirname(workspaceStorageDir))
    if (fs.existsSync(cursorDir)) {
      metrics.installed = true
      try {
        const stat = fs.statSync(cursorDir)
        metrics.lastUsed = stat.mtime.toISOString()
      } catch {}
      const settingsPath = path.join(cursorDir, 'User', 'settings.json')
      if (fs.existsSync(settingsPath)) {
        try {
          const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))
          metrics.hasAiFeatures = !!(settings['cursor.ai'] || settings['cursor.chat'])
        } catch {}
      }
      const storagePath = path.join(cursorDir, 'User', 'globalStorage')
      if (fs.existsSync(storagePath)) {
        try {
          metrics.extensionsCount = fs.readdirSync(storagePath).length
        } catch {}
      }
    }
    return { tool: 'cursor', metrics, collectedAt: new Date().toISOString() }
  }

  metrics.installed = true
  let encryptionKey: string | undefined
  try {
    encryptionKey = loadConfig().encryptionKey
  } catch {}

  const sessionAnalyses: SessionAnalysis[] = []
  const modelUsageMap = new Map<string, { sessions: number, tokens: number, turns: number, taskTypes: Set<TaskType> }>()
  const allToolsUsed = new Set<string>()
  let latestTime = 0
  let totalTurns = 0
  let usesPlanMode = false
  const sessionDates: number[] = []
  let workspaceCount = 0

  let entries: string[] = []
  try {
    entries = fs.readdirSync(workspaceStorageDir)
  } catch {
    return { tool: 'cursor', metrics, collectedAt: new Date().toISOString() }
  }

  const dbPaths: string[] = []
  for (const workspaceId of entries) {
    const workspacePath = path.join(workspaceStorageDir, workspaceId)
    try {
      if (!fs.statSync(workspacePath).isDirectory()) continue
    } catch {
      continue
    }
    const p = path.join(workspacePath, 'state.vscdb')
    if (fs.existsSync(p)) dbPaths.push(p)
  }
  if (DEBUG_CURSOR) {
    console.warn('[Cursor debug] workspaceStorage:', workspaceStorageDir)
    console.warn('[Cursor debug] state.vscdb encontrados:', dbPaths.length)
  }

  let logKeysOnce = DEBUG_CURSOR
  for (const workspaceId of entries) {
    const workspacePath = path.join(workspaceStorageDir, workspaceId)
    let stat: fs.Stats
    try {
      stat = fs.statSync(workspacePath)
      if (!stat.isDirectory()) continue
    } catch {
      continue
    }
    workspaceCount++
    const dbPath = path.join(workspacePath, 'state.vscdb')
    if (!fs.existsSync(dbPath)) continue
    try {
      if (stat.mtimeMs > latestTime) latestTime = stat.mtimeMs
      sessionDates.push(stat.mtimeMs)
    } catch {}

    const chatJson = await readChatDataFromStateVscdb(dbPath, logKeysOnce)
    if (!chatJson) {
      if (logKeysOnce) logKeysOnce = false
      continue
    }

    const sessions = parseChatDataToSessions(chatJson, workspaceId)
    for (const s of sessions) {
      sessionAnalyses.push(s)
      totalTurns += s.turns
      for (const t of s.toolsUsed) allToolsUsed.add(t)
      if (detectsPlanMode(s.summary)) usesPlanMode = true
      const modelStats = modelUsageMap.get(s.model) || {
        sessions: 0,
        tokens: s.tokens,
        turns: 0,
        taskTypes: new Set<TaskType>(),
      }
      modelStats.sessions++
      modelStats.tokens += s.tokens
      modelStats.turns += s.turns
      modelStats.taskTypes.add(s.taskType)
      modelUsageMap.set(s.model, modelStats)
    }
  }

  metrics.sessionsCount = sessionAnalyses.length
  metrics.projectsCount = workspaceCount
  if (latestTime > 0) metrics.lastUsed = new Date(latestTime).toISOString()
  if (sessionAnalyses.length > 0) {
    metrics.avgTurnsPerSession = Math.round((totalTurns / sessionAnalyses.length) * 10) / 10
    metrics.avgTokensPerSession = 0
  }
  metrics.toolsUsedPerSession = Array.from(allToolsUsed)
  metrics.usesPlanMode = usesPlanMode
  metrics.usesExtendedThinking = false
  if (sessionDates.length > 1) {
    const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
    metrics.sessionFrequency = sessionDates.filter(d => d > oneWeekAgo).length
  }

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

  if (isValidEncryptionKey(encryptionKey) && sessionAnalyses.length > 0) {
    const sessionDetails: SessionDetail[] = sessionAnalyses.map(s => ({
      sessionId: s.sessionId,
      summary: sanitizeText(s.summary),
      firstPrompt: sanitizeText(s.firstPrompt),
      taskType: s.taskType,
    }))
    try {
      metrics.encrypted = encrypt(sessionDetails, encryptionKey!)
    } catch {}
  }

  const cursorDir = path.dirname(path.dirname(workspaceStorageDir))
  if (fs.existsSync(path.join(cursorDir, 'User', 'settings.json'))) {
    try {
      const settings = JSON.parse(fs.readFileSync(path.join(cursorDir, 'User', 'settings.json'), 'utf-8'))
      metrics.hasAiFeatures = !!(settings['cursor.ai'] || settings['cursor.chat'])
    } catch {}
  }
  const globalStoragePath = path.join(cursorDir, 'User', 'globalStorage')
  if (fs.existsSync(globalStoragePath)) {
    try {
      metrics.extensionsCount = fs.readdirSync(globalStoragePath).length
    } catch {}
  }

  return { tool: 'cursor', metrics, collectedAt: new Date().toISOString() }
}
