/**
 * Métricas de prompting (compartidas con servidor y plugin)
 */
export interface PromptingMetrics {
  avgPromptLength: number
  maxPromptLength: number
  promptLengthDistribution: {
    short: number
    medium: number
    long: number
    detailed: number
  }
  structuredPromptRate: number
  usesCodeBlocks: boolean
  usesExamples: boolean
  usesFormatting: boolean
  contextProvisionRate: number
  referencesFiles: boolean
  referencesCode: boolean
  referencesUrls: boolean
  avgTurnsBeforeResolution: number
  refinementRate: number
  followUpRate: number
  usesRolePrompting: boolean
  usesConstraints: boolean
  usesStepByStep: boolean
  specifiesOutputFormat: boolean
  totalPromptsAnalyzed: number
  analysisVersion: string
}

/**
 * Métricas de workflow (orquestación del trabajo con IA). Compartidas con servidor.
 */
export interface WorkflowMetrics {
  skillsUsed: string[]
  skillUsageCount: number
  uniqueSkillsCount: number
  skillsPerSession: number
  atReferencesCount: number
  atReferencesPerSession: number
  uniqueFilesReferenced: number
  usesPlanFiles: boolean
  usesConfigFiles: boolean
  pathsInPrompts: number
  sessionsWithPlan: number
  sessionsWithVerification: number
  sessionsWithReview: number
  fullFlowSessions: number
  avgActionsPerSession: number
  definesProcess: boolean
  setsConstraints: boolean
  requestsVerification: boolean
  definesAcceptanceCriteria: boolean
  directiveRate: number
  totalSessionsAnalyzed: number
  analysisVersion: string
}

export interface DetectedFlow {
  name: string
  count: number
}

export interface WorkflowScore {
  overall: number
  level: 'ad-hoc' | 'básico' | 'estructurado' | 'optimizado'
  dimensions: {
    skillAdoption: number
    fileOrchestration: number
    processMaturity: number
    metaCognition: number
  }
  detectedFlows: DetectedFlow[]
  totalAnalyzed: number
  recommendations: string[]
}

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

  // Métricas de prompting (análisis local de calidad de prompts)
  prompting?: PromptingMetrics

  // Métricas de workflow (orquestación: skills, @refs, flujos)
  workflow?: WorkflowMetrics

  /** Sesiones nuevas desde el último sync (para mostrar en la UI del agente) */
  sessionsSinceLastSync?: number

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

// Nota: tipo duplicado desde monitor_ai/server/utils/agent-metrics.ts — mantener sincronizados
export type ProblematicPattern =
  | 'shallow'
  | 'no-context'
  | 'no-plan'
  | 'repetitive-corrections'

export type Severity = 'low' | 'medium' | 'high'

export interface ProblematicSession {
  pattern: ProblematicPattern
  count: number
  severity: Severity
}

/**
 * Resultado de un collector
 */
export interface CollectorResult {
  tool: string
  metrics: ExtendedMetrics
  collectedAt: string
  promptingSessions?: import('./analyzers/prompt-analyzer.js').SessionPromptingData[]
  workflowSessions?: import('./analyzers/workflow-analyzer.js').SessionWorkflowData[]
  problematicSessions?: ProblematicSession[]
}

/**
 * Mensaje de sesión de Claude Code
 */
export interface ClaudeMessage {
  type?: string
  timestamp?: string  // ISO 8601 — presente en todos los mensajes del JSONL
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
