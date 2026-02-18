/**
 * Analizador de workflow: skills, @references, flujos y meta-instrucciones.
 * Todas las regex son bilingües (ES + EN).
 * Uso: últimas 50 sesiones para mantener rendimiento.
 */
import type { WorkflowMetrics } from '../types.js'
import type { SessionMessage, ContentBlock } from './prompt-analyzer.js'

export interface AtReferenceData {
  count: number
  uniqueFiles: string[]
  hasPlanFiles: boolean
  hasConfigFiles: boolean
  /** Paths explícitos en prompts (para pathsInPrompts) */
  explicitPathsCount: number
}

export interface MetaCognitionData {
  definesProcess: boolean
  setsConstraints: boolean
  requestsVerification: boolean
  definesAcceptance: boolean
}

export interface SessionWorkflowData {
  skills: string[]
  atReferences: AtReferenceData
  actions: string[]
  flowPattern: string
  metaCognition: MetaCognitionData
}

/** Tool call del asistente (para detectar skills invocadas) */
export interface ToolCall {
  name?: string
  input?: { skill?: string }
}

const ANALYSIS_VERSION = '1.0'

/** Extrae texto de un mensaje (string o bloques tipo Claude API) */
function extractText(content: string | ContentBlock[]): string {
  if (typeof content === 'string') return content
  return (content as ContentBlock[])
    .filter((block): block is ContentBlock & { text: string } => block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join('\n')
}

/** Obtiene solo los textos de mensajes de usuario para análisis */
function getUserTexts(messages: SessionMessage[]): string[] {
  return messages
    .filter(m => m.role === 'human')
    .map(m => extractText(m.content))
    .filter(t => t.trim().length > 0)
}

// --- Skills / Slash Commands ---

/**
 * Detecta skills en el prompt del usuario (slash commands: /executing-plans, etc.).
 */
export function detectSkills(userMessage: string): string[] {
  const skills: string[] = []
  // Solo detecta slash commands reales: deben contener guion o dos puntos
  // (executing-plans, superpowers:brainstorming) para evitar capturar rutas
  // de archivo como /var/log → "var" o /ajax/handler → "ajax"
  const regex = /^\/([\w][\w:-]*(?:[-:][\w:-]+)+)(?![/\w])/gm
  for (const m of userMessage.matchAll(regex)) {
    skills.push(m[1])
  }
  return skills
}

/**
 * Detecta skills invocadas en tool_calls del asistente (si disponibles en .jsonl).
 */
export function detectSkillsFromToolCalls(toolCalls: ToolCall[]): string[] {
  return (toolCalls || [])
    .filter(tc => tc.name === 'Skill' && tc.input?.skill)
    .map(tc => tc.input!.skill as string)
}

// --- @References y paths (bilingüe) ---

/**
 * Detecta @mentions, paths explícitos y referencias a plan/config.
 */
export function detectAtReferences(userMessage: string): AtReferenceData {
  const atRefs = userMessage.match(/@[\w\/\\.-]+\.\w{1,5}\b/g) || []

  const explicitPathRegex = /(?:en|lee|mira|sigue|ver|read|see|follow|check)\s+(?:el\s+)?(?:archivo\s+)?[`"']?([\w\/\\.-]+\.\w{1,5})/gi
  const explicitMatches = [...userMessage.matchAll(explicitPathRegex)]
  const explicitPaths = explicitMatches.map(m => m[1]).filter(Boolean)

  const allRefs = [...new Set([...atRefs, ...explicitPaths])]

  const hasPlanFiles = allRefs.some(r => /plan\/|progreso\/|progress\/|PLAN\.md|step-\d+|README\.md/i.test(r))
  const hasConfigFiles = allRefs.some(r => /\.env|config\.|tsconfig|package\.json|schema\.prisma/i.test(r))

  return {
    count: allRefs.length,
    uniqueFiles: [...new Set(allRefs)],
    hasPlanFiles,
    hasConfigFiles,
    explicitPathsCount: explicitPaths.length,
  }
}

// --- Acciones y flujos (bilingüe) ---

const actionDetection: Record<string, RegExp> = {
  plan: /\/writing-plans|\/brainstorm|planifica|diseña|plan:|approach|design/i,
  implement: /\/executing|implementa|crea|añade|modifica|create|add|build|implement/i,
  verify: /\/verification|verifica|comprueba|test|check|asegúrate|make sure/i,
  review: /\/requesting-code-review|\/code-review|revisa|review|examina|examine/i,
  test: /\/test-driven|test|spec|vitest|jest|pytest/i,
  debug: /\/systematic-debugging|debug|error|fix|bug|arregla|soluciona/i,
  explore: /explica|cómo funciona|qué es|qué hace|explain|what is|how does|how to/i,
}

export function detectActions(userMessage: string): string[] {
  const actions: string[] = []
  for (const [action, regex] of Object.entries(actionDetection)) {
    if (regex.test(userMessage)) actions.push(action)
  }
  return actions
}

export function detectFlowPattern(actions: string[]): string {
  const unique = [...new Set(actions)]
  if (['plan', 'implement', 'verify', 'review'].every(a => unique.includes(a))) return 'full-cycle'
  if (['plan', 'implement', 'verify'].every(a => unique.includes(a))) return 'plan-and-verify'
  if (['test', 'implement', 'verify'].every(a => unique.includes(a))) return 'tdd-flow'
  if (['implement', 'review'].every(a => unique.includes(a))) return 'implement-and-review'
  if (unique.includes('implement')) return 'implement-only'
  if (unique.includes('explore')) return 'explore-only'
  return 'unknown'
}

// --- Meta-instrucciones (bilingüe) ---

export function detectMetaInstructions(messages: string[]): MetaCognitionData {
  const allText = messages.join(' ')
  return {
    definesProcess: /primero.*(?:luego|después).*(?:finalmente|por último)|first.*then.*finally|paso 1.*paso 2|step 1.*step 2/is.test(allText),
    setsConstraints: /no hagas commit|no modifiques otros|solo lee|no pushes|don't commit|read only|just research|no toques/i.test(allText),
    requestsVerification: /verifica (?:el|que|antes)|comprueba (?:el|que)|asegúrate de|confirm that|make sure|double.?check/i.test(allText),
    definesAcceptance: /considéralo listo cuando|terminado cuando|done when|acceptance criteria|el checklist|cumple con/i.test(allText),
  }
}

/** Número máximo de sesiones a analizar (rendimiento) */
export const MAX_SESSIONS_TO_ANALYZE = 50

/**
 * Analiza una sesión y devuelve señales de workflow.
 * Opcionalmente se pueden pasar skills detectadas desde tool_calls (paso 03).
 */
export function analyzeSessionWorkflow(
  messages: SessionMessage[],
  skillsFromToolCalls: string[] = [],
): SessionWorkflowData {
  const userTexts = getUserTexts(messages)
  if (userTexts.length === 0) {
    return {
      skills: [...skillsFromToolCalls],
      atReferences: {
        count: 0,
        uniqueFiles: [],
        hasPlanFiles: false,
        hasConfigFiles: false,
        explicitPathsCount: 0,
      },
      actions: [],
      flowPattern: 'unknown',
      metaCognition: {
        definesProcess: false,
        setsConstraints: false,
        requestsVerification: false,
        definesAcceptance: false,
      },
    }
  }

  const allSkills = new Set<string>()
  for (const text of userTexts) {
    detectSkills(text).forEach(s => allSkills.add(s))
  }
  skillsFromToolCalls.forEach(s => allSkills.add(s))

  let atRefsAgg: AtReferenceData = {
    count: 0,
    uniqueFiles: [],
    hasPlanFiles: false,
    hasConfigFiles: false,
    explicitPathsCount: 0,
  }
  const allActions: string[] = []
  for (const text of userTexts) {
    const at = detectAtReferences(text)
    atRefsAgg = {
      count: atRefsAgg.count + at.count,
      uniqueFiles: [...new Set([...atRefsAgg.uniqueFiles, ...at.uniqueFiles])],
      hasPlanFiles: atRefsAgg.hasPlanFiles || at.hasPlanFiles,
      hasConfigFiles: atRefsAgg.hasConfigFiles || at.hasConfigFiles,
      explicitPathsCount: atRefsAgg.explicitPathsCount + at.explicitPathsCount,
    }
    allActions.push(...detectActions(text))
  }

  const flowPattern = detectFlowPattern(allActions)
  const metaCognition = detectMetaInstructions(userTexts)

  return {
    skills: Array.from(allSkills),
    atReferences: atRefsAgg,
    actions: [...new Set(allActions)],
    flowPattern,
    metaCognition,
  }
}

/**
 * Agrega datos de varias sesiones en un único WorkflowMetrics.
 * Si se pasan más de MAX_SESSIONS_TO_ANALYZE, se usan solo las últimas 50.
 */
export function aggregateWorkflowMetrics(sessions: SessionWorkflowData[]): WorkflowMetrics {
  const limited = sessions.length > MAX_SESSIONS_TO_ANALYZE
    ? sessions.slice(-MAX_SESSIONS_TO_ANALYZE)
    : sessions
  const total = limited.length
  if (total === 0) {
    return {
      skillsUsed: [],
      skillUsageCount: 0,
      uniqueSkillsCount: 0,
      skillsPerSession: 0,
      atReferencesCount: 0,
      atReferencesPerSession: 0,
      uniqueFilesReferenced: 0,
      usesPlanFiles: false,
      usesConfigFiles: false,
      pathsInPrompts: 0,
      sessionsWithPlan: 0,
      sessionsWithVerification: 0,
      sessionsWithReview: 0,
      fullFlowSessions: 0,
      avgActionsPerSession: 0,
      definesProcess: false,
      setsConstraints: false,
      requestsVerification: false,
      definesAcceptanceCriteria: false,
      directiveRate: 0,
      totalSessionsAnalyzed: 0,
      analysisVersion: ANALYSIS_VERSION,
    }
  }

  const allSkills: string[] = []
  let atRefsTotal = 0
  let uniqueFilesSet = new Set<string>()
  let pathsInPromptsTotal = 0
  let usesPlanFiles = false
  let usesConfigFiles = false
  let sessionsWithPlan = 0
  let sessionsWithVerification = 0
  let sessionsWithReview = 0
  let fullFlowSessions = 0
  let actionsTotal = 0
  let definesProcess = false
  let setsConstraints = false
  let requestsVerification = false
  let definesAcceptanceCriteria = false
  let directiveSessions = 0

  for (const s of limited) {
    allSkills.push(...s.skills)
    atRefsTotal += s.atReferences.count
    s.atReferences.uniqueFiles.forEach(f => uniqueFilesSet.add(f))
    pathsInPromptsTotal += s.atReferences.explicitPathsCount
    if (s.atReferences.hasPlanFiles) usesPlanFiles = true
    if (s.atReferences.hasConfigFiles) usesConfigFiles = true
    if (s.actions.includes('plan')) sessionsWithPlan++
    if (s.actions.includes('verify')) sessionsWithVerification++
    if (s.actions.includes('review')) sessionsWithReview++
    if (s.flowPattern === 'full-cycle') fullFlowSessions++
    actionsTotal += s.actions.length
    if (s.metaCognition.definesProcess) definesProcess = true
    if (s.metaCognition.setsConstraints) setsConstraints = true
    if (s.metaCognition.requestsVerification) requestsVerification = true
    if (s.metaCognition.definesAcceptance) definesAcceptanceCriteria = true
    if (s.skills.length > 0 || s.metaCognition.definesProcess || s.metaCognition.setsConstraints) directiveSessions++
  }

  const uniqueSkills = [...new Set(allSkills)]
  const skillUsageCount = allSkills.length

  return {
    skillsUsed: uniqueSkills,
    skillUsageCount,
    uniqueSkillsCount: uniqueSkills.length,
    skillsPerSession: Math.round((skillUsageCount / total) * 10) / 10,
    atReferencesCount: atRefsTotal,
    atReferencesPerSession: Math.round((atRefsTotal / total) * 10) / 10,
    uniqueFilesReferenced: uniqueFilesSet.size,
    usesPlanFiles,
    usesConfigFiles,
    pathsInPrompts: pathsInPromptsTotal,
    sessionsWithPlan,
    sessionsWithVerification,
    sessionsWithReview,
    fullFlowSessions,
    avgActionsPerSession: Math.round((actionsTotal / total) * 10) / 10,
    definesProcess,
    setsConstraints,
    requestsVerification,
    definesAcceptanceCriteria,
    directiveRate: total > 0 ? Math.round((directiveSessions / total) * 100) / 100 : 0,
    totalSessionsAnalyzed: total,
    analysisVersion: ANALYSIS_VERSION,
  }
}
