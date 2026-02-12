import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import os from 'os'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
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
 * Normaliza JSON parseado a la forma { tabs: [ { bubbles: [...] } ] } para distintas variantes de Cursor.
 */
function normalizeToCursorChatData(parsed: unknown): CursorChatData | null {
  if (!parsed || typeof parsed !== 'object') return null
  const o = parsed as Record<string, unknown>
  if (Array.isArray(o.tabs)) return { tabs: o.tabs as CursorChatData['tabs'] }
  if (Array.isArray((o.data as Record<string, unknown>)?.tabs)) {
    return { tabs: (o.data as { tabs: CursorChatData['tabs'] }).tabs }
  }
  if (Array.isArray(o.bubbles)) {
    return { tabs: [{ bubbles: o.bubbles as CursorBubble[] }] }
  }
  if (Array.isArray(o.conversations)) {
    const tabs: CursorChatData['tabs'] = []
    for (const c of o.conversations as Record<string, unknown>[]) {
      if (Array.isArray(c?.bubbles)) tabs.push({ bubbles: c.bubbles as CursorBubble[] })
      else if (Array.isArray(c?.messages)) {
        const bubbles = (c.messages as Array<{ role?: string; content?: string; rawText?: string }>).map(m => ({
          type: (m.role === 'user' ? 'user' : 'ai') as 'user' | 'ai',
          text: m.content ?? m.rawText ?? '',
          rawText: m.rawText ?? m.content ?? '',
        }))
        if (bubbles.length) tabs.push({ bubbles })
      }
    }
    if (tabs.length) return { tabs }
  }
  // composer.composerData: { allComposers: [ { type, composerId, name, bubbles?, conversation? } ] }
  if (Array.isArray(o.allComposers)) {
    const tabs: CursorChatData['tabs'] = []
    for (const comp of o.allComposers as Record<string, unknown>[]) {
      if (!comp || typeof comp !== 'object') continue
      let bubbles: CursorBubble[] | undefined
      if (Array.isArray(comp.bubbles)) bubbles = comp.bubbles as CursorBubble[]
      else if (Array.isArray(comp.messages)) {
        bubbles = (comp.messages as Array<{ role?: string; content?: string; text?: string }>).map(m => ({
          type: (m.role === 'user' ? 'user' : 'ai') as 'user' | 'ai',
          text: (m.content ?? m.text ?? '') as string,
          rawText: (m.content ?? m.text ?? '') as string,
        }))
      } else if (comp.conversation && typeof comp.conversation === 'object' && Array.isArray((comp.conversation as Record<string, unknown>).bubbles)) {
        bubbles = (comp.conversation as { bubbles: CursorBubble[] }).bubbles
      }
      if (bubbles?.length) {
        tabs.push({ bubbles })
      } else if (comp.name && typeof comp.name === 'string') {
        tabs.push({ bubbles: [{ type: 'user', text: comp.name, rawText: comp.name }] })
      }
    }
    if (tabs.length) return { tabs }
  }
  // aiService.prompts: [ { text, commandType } ] — un tab con un bubble user por prompt
  if (Array.isArray(o) && o.length > 0) {
    const first = o[0] as Record<string, unknown>
    if (Array.isArray(first?.bubbles)) return { tabs: o as CursorChatData['tabs'] }
    const withText = o.filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null && typeof (x as Record<string, unknown>).text === 'string')
    if (withText.length > 0) {
      const bubbles: CursorBubble[] = withText.map(p => ({
        type: 'user' as const,
        text: (p.text as string) || '',
        rawText: (p.text as string) || '',
      }))
      return { tabs: [{ bubbles }] }
    }
  }
  return null
}

/**
 * Parsea el JSON de chatdata y devuelve sesiones (una por tab) con turns, firstPrompt, model, etc.
 */
function parseChatDataToSessions(
  chatJson: string,
  workspaceId: string,
): SessionAnalysis[] {
  const sessions: SessionAnalysis[] = []
  let data: CursorChatData | null
  try {
    const parsed = JSON.parse(chatJson) as unknown
    data = normalizeToCursorChatData(parsed)
    if (!data) data = (parsed as CursorChatData)?.tabs ? (parsed as CursorChatData) : null
  } catch {
    return sessions
  }
  if (!data) return sessions
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
// Cache para evitar cargar sql.js múltiples veces
let sqlJsModule: { Database: new (data?: BufferSource) => SQLiteDB } | null = null
let sqlJsLoadFailed = false

// Detecta si estamos corriendo dentro de un ejecutable de pkg
const isPackaged = !!(process as unknown as { pkg?: unknown }).pkg

async function loadSqlJs(): Promise<{ Database: new (data?: BufferSource) => SQLiteDB } | null> {
  if (sqlJsLoadFailed) return null
  if (sqlJsModule) return sqlJsModule

  // Si estamos en un ejecutable empaquetado, buscar el wasm primero
  // y si no existe, no intentar cargar sql.js (evita crash)
  const possiblePaths = [
    path.join(__dirname, 'sql-wasm.wasm'),
    path.join(process.cwd(), 'sql-wasm.wasm'),
    path.join(process.cwd(), 'bundle', 'sql-wasm.wasm'),
    path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
    path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
  ]

  let wasmBinary: Buffer | undefined
  for (const p of possiblePaths) {
    try {
      if (fs.existsSync(p)) {
        wasmBinary = fs.readFileSync(p)
        if (DEBUG_CURSOR) console.warn('[Cursor debug] wasm encontrado en:', p)
        break
      }
    } catch {}
  }

  // Si estamos empaquetados y no hay wasm, saltar sql.js para evitar crash
  if (isPackaged && !wasmBinary) {
    if (DEBUG_CURSOR) console.warn('[Cursor debug] Ejecutable empaquetado sin wasm, saltando sql.js')
    sqlJsLoadFailed = true
    return null
  }

  try {
    const init = (await import('sql.js')).default as (config?: unknown) => Promise<{ Database: new (data?: BufferSource) => SQLiteDB }>

    if (wasmBinary) {
      sqlJsModule = await init({ wasmBinary })
    } else {
      sqlJsModule = await init()
    }
    return sqlJsModule
  } catch (e) {
    if (DEBUG_CURSOR) console.warn('[Cursor debug] sql.js no pudo cargar:', (e as Error).message)
    sqlJsLoadFailed = true
    return null
  }
}

async function readChatDataFromStateVscdb(dbPath: string, logKeysIfMissing = false): Promise<string | null> {
  const SQL = await loadSqlJs()
  if (!SQL) {
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

    // Fallback: buscar cualquier clave que parezca chat (por si Cursor cambió el nombre)
    const keysStmt = db.prepare('SELECT key FROM ItemTable')
    const allKeys: string[] = []
    while (keysStmt.step()) {
      const o = keysStmt.getAsObject() as { key?: string }
      if (o?.key) allKeys.push(o.key)
    }
    keysStmt.free()
    const chatLikeKeys = allKeys.filter(k =>
      /aichat|chatdata|ai\.?service\.?prompts|composer.*chat|panel.*aichat|composer\.composerData|workbench\.panel\.composerChatViewPane\./i.test(k),
    )
    const composerDataKey = chatLikeKeys.find(k => k === 'composer.composerData')
    const composerPaneKeys = chatLikeKeys.filter(k => k.startsWith('workbench.panel.composerChatViewPane.'))
    const otherKeys = chatLikeKeys.filter(k => k !== 'composer.composerData' && !k.startsWith('workbench.panel.composerChatViewPane.'))

    const keysToTry = [composerDataKey, ...composerPaneKeys, ...otherKeys].filter(Boolean) as string[]

    const debugSample = (obj: unknown, maxLen: number): string => {
      if (obj == null) return String(obj)
      if (typeof obj !== 'object') return String(obj).slice(0, maxLen)
      const keys = Object.keys(obj as object)
      const preview = JSON.stringify(obj).slice(0, maxLen)
      return `{ keys: [${keys.join(', ')}], preview: ${preview}... }`
    }

    for (const key of keysToTry) {
      const valueStmt = db.prepare('SELECT value FROM ItemTable WHERE key = ?')
      valueStmt.bind([key])
      if (valueStmt.step()) {
        const row = valueStmt.getAsObject() as { value?: string }
        const value = row?.value
        valueStmt.free()
        if (typeof value === 'string') {
          try {
            const parsed = JSON.parse(value) as unknown
            const normalized = normalizeToCursorChatData(parsed)
            if (normalized?.tabs?.length) {
              if (DEBUG_CURSOR) console.warn('[Cursor debug] datos de chat encontrados con clave:', key)
              db.close()
              return JSON.stringify(normalized)
            }
            if (DEBUG_CURSOR && logKeysIfMissing) {
              console.warn('[Cursor debug] clave candidata sin estructura reconocida:', key, debugSample(parsed, 300))
            }
          } catch (e) {
            if (DEBUG_CURSOR && logKeysIfMissing) {
              console.warn('[Cursor debug] clave candidata JSON inválido:', key, (e as Error).message)
            }
          }
        }
      } else {
        valueStmt.free()
      }
    }

    const collectedTabs: CursorChatData['tabs'] = []
    for (const key of composerPaneKeys) {
      const valueStmt = db.prepare('SELECT value FROM ItemTable WHERE key = ?')
      valueStmt.bind([key])
      if (valueStmt.step()) {
        const row = valueStmt.getAsObject() as { value?: string }
        const value = row?.value
        valueStmt.free()
        if (typeof value === 'string') {
          try {
            const parsed = JSON.parse(value) as unknown
            const normalized = normalizeToCursorChatData(parsed)
            if (normalized?.tabs?.length) {
              for (const tab of normalized.tabs) {
                if (tab?.bubbles?.length) collectedTabs.push(tab)
              }
            }
          } catch {
            // ignore
          }
        }
      } else {
        valueStmt.free()
      }
    }
    if (collectedTabs.length > 0) {
      if (DEBUG_CURSOR) console.warn('[Cursor debug] datos de chat reunidos desde', collectedTabs.length, 'composerChatViewPane')
      db.close()
      return JSON.stringify({ tabs: collectedTabs })
    }

    if (logKeysIfMissing) {
      const broadMatch = allKeys.filter(k => /workbench|panel|view|chat|ai|composer|prompt/i.test(k))
      console.warn('[Cursor debug] clave no encontrada:', CHATDATA_KEY)
      console.warn('[Cursor debug] claves que parecen chat (aichat/chatdata/prompts):', chatLikeKeys.length ? chatLikeKeys : '(ninguna)')
      console.warn('[Cursor debug] claves con workbench/panel/view/chat/ai/composer/prompt:', broadMatch.length ? broadMatch : '(ninguna)')
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

  const workspaceEntries: { id: string; path: string; mtime: number }[] = []
  for (const workspaceId of entries) {
    const workspacePath = path.join(workspaceStorageDir, workspaceId)
    let stat: fs.Stats
    try {
      stat = fs.statSync(workspacePath)
      if (!stat.isDirectory()) continue
    } catch {
      continue
    }
    const dbPath = path.join(workspacePath, 'state.vscdb')
    if (!fs.existsSync(dbPath)) continue
    workspaceEntries.push({ id: workspaceId, path: dbPath, mtime: stat.mtimeMs })
  }
  workspaceEntries.sort((a, b) => b.mtime - a.mtime)
  if (DEBUG_CURSOR) {
    console.warn('[Cursor debug] workspaceStorage:', workspaceStorageDir)
    console.warn('[Cursor debug] state.vscdb encontrados:', workspaceEntries.length, '(ordenados por más reciente primero)')
  }

  let logKeysOnce = DEBUG_CURSOR
  for (const { id: workspaceId, path: dbPath, mtime } of workspaceEntries) {
    const workspacePath = path.dirname(dbPath)
    let stat: fs.Stats
    try {
      stat = fs.statSync(workspacePath)
    } catch {
      continue
    }
    workspaceCount++
    if (stat.mtimeMs > latestTime) latestTime = stat.mtimeMs
    sessionDates.push(stat.mtimeMs)

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
