/**
 * Tipos de tareas inferidas localmente
 */
export type TaskType =
  | 'planning'
  | 'implementation'
  | 'debugging'
  | 'refactoring'
  | 'testing'
  | 'review'
  | 'documentation'
  | 'other'

/**
 * Uso de un modelo específico
 */
export interface ModelUsage {
  model: string
  sessions: number
  tokens: number
  avgTurnsPerSession?: number
  typicalTaskTypes?: TaskType[]
}

/**
 * Detalle de sesión (datos sensibles, se encriptan)
 */
export interface SessionDetail {
  sessionId: string
  summary: string
  firstPrompt: string
  taskType: TaskType
}

/**
 * Datos encriptados
 */
export interface EncryptedPayload {
  data: string
  iv: string
  tag: string
}

/**
 * Métricas extendidas de un collector
 */
export interface ExtendedMetrics {
  // Métricas básicas (retrocompatibles)
  sessionsCount?: number
  totalTokens?: number
  lastUsed?: string | null
  timeSpentMinutes?: number
  installed?: boolean
  projectsCount?: number

  // Métricas detalladas (nuevas)
  avgTurnsPerSession?: number
  avgTokensPerSession?: number
  toolsUsedPerSession?: string[]
  sessionFrequency?: number
  inputOutputRatio?: number
  usesPlanMode?: boolean
  usesExtendedThinking?: boolean

  // Selección de modelo
  modelsUsed?: ModelUsage[]
  modelDiversity?: number

  // Datos encriptados (solo si hay clave de encriptación)
  encrypted?: EncryptedPayload

  // Para otros collectors
  hasAiFeatures?: boolean
  extensionsCount?: number
  vscodeInstalled?: boolean
  copilotInstalled?: boolean
  copilotChatInstalled?: boolean
  aiExtensions?: string[]

  // Índice genérico para retrocompatibilidad
  [key: string]: unknown
}

/**
 * Resultado de un collector
 */
export interface CollectorResult {
  tool: string
  metrics: ExtendedMetrics
  collectedAt: string
}

/**
 * Mensaje de sesión de Claude Code
 */
export interface ClaudeMessage {
  type?: string
  message?: {
    role?: string
    content?: string | unknown[]
    model?: string
    tool_calls?: unknown[]
    tool_results?: unknown[]
  }
  thinkingMetadata?: {
    maxThinkingTokens?: number
  }
}

/**
 * Índice de sesiones de Claude Code
 */
export interface SessionIndex {
  sessions?: Array<{
    sessionId: string
    summary?: string
    firstPrompt?: string
    timestamp?: string
  }>
}

/**
 * Cache de estadísticas de Claude
 */
export interface StatsCache {
  dailyModelTokens?: Record<string, Record<string, { input: number, output: number }>>
}
