import type { PromptingMetrics } from '../types.js'

/** Bloque de contenido (ej. Claude API: { type: 'text', text: string }) */
export interface ContentBlock {
  type: string
  text?: string
}

export interface SessionMessage {
  role: 'human' | 'assistant'
  content: string | ContentBlock[]
}

export interface SessionPromptingData {
  promptLengths: number[]
  hasStructure: boolean
  hasCodeBlocks: boolean
  hasExamples: boolean
  hasFormatting: boolean
  hasFileRefs: boolean
  hasCodeRefs: boolean
  hasUrls: boolean
  hasRolePrompt: boolean
  hasConstraints: boolean
  hasStepByStep: boolean
  hasOutputFormat: boolean
  turnCount: number
  hasRefinement: boolean
  hasFollowUp: boolean
}

const ANALYSIS_VERSION = '1.0'

// --- Extracción de texto ---

function extractText(content: string | ContentBlock[]): string {
  if (typeof content === 'string') return content
  return content
    .filter((block): block is ContentBlock & { text: string } => block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join('\n')
}

// --- Dimensión 2: Estructura (bilingüe: listas, numeración, headers) ---

function hasStructure(text: string): boolean {
  return /^[\s]*[-*•]\s|^\d+\.\s|^#{1,3}\s/m.test(text)
}

function hasCodeBlocks(text: string): boolean {
  return /```[\s\S]*?```|^ {4}\S/m.test(text)
}

function hasExamples(text: string): boolean {
  return /ejemplo:|por ejemplo|e\.g\.|for example|like this:|such as:/i.test(text)
}

function hasFormatting(text: string): boolean {
  return /\*\*\w|\*\w|__\w|`\w.*`|\[.*\]\(/.test(text)
}

// --- Dimensión 3: Contexto ---

function hasFileReferences(text: string): boolean {
  return /[\/\\][\w.-]+\.\w{1,5}\b/.test(text)
}

function hasCodeReferences(text: string): boolean {
  return /`[^`]+`|```/.test(text)
}

function hasUrls(text: string): boolean {
  return /https?:\/\/\S+/.test(text)
}

// --- Dimensión 5: Técnicas avanzadas (ES + EN) ---

function hasRolePrompting(text: string): boolean {
  return /actúa como|eres un|compórtate como|act as|you are a|pretend|imagine you/i.test(text)
}

function hasConstraints(text: string): boolean {
  return /no uses|sin usar|evita|no modifiques|must not|don't use|avoid|without using/i.test(text)
}

function hasStepByStep(text: string): boolean {
  return /paso a paso|step by step|primero.*luego|first.*then/i.test(text)
}

function hasOutputFormat(text: string): boolean {
  return /formato:|devuelve.*json|en tabla|como lista|output as|return.*as|as a table|as a list|format:/i.test(text)
}

// --- Dimensión 4: Iteración ---

function isRefinement(text: string): boolean {
  return /^no[,.]|no quise|en realidad|cambia|en vez de|actually|I meant|instead of|change.*to/i.test(text)
}

function isFollowUp(text: string): boolean {
  return /también|y además|otra cosa|ahora|also|additionally|one more thing|now\s/i.test(text)
}

// --- Helpers de agregación ---

function pct<T>(arr: T[], predicate: (item: T) => boolean): number {
  if (arr.length === 0) return 0
  return Math.round((arr.filter(predicate).length / arr.length) * 100)
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10
}

function emptySessionData(): SessionPromptingData {
  return {
    promptLengths: [],
    hasStructure: false,
    hasCodeBlocks: false,
    hasExamples: false,
    hasFormatting: false,
    hasFileRefs: false,
    hasCodeRefs: false,
    hasUrls: false,
    hasRolePrompt: false,
    hasConstraints: false,
    hasStepByStep: false,
    hasOutputFormat: false,
    turnCount: 0,
    hasRefinement: false,
    hasFollowUp: false,
  }
}

function emptyPromptingMetrics(): PromptingMetrics {
  return {
    avgPromptLength: 0,
    maxPromptLength: 0,
    promptLengthDistribution: { short: 0, medium: 0, long: 0, detailed: 0 },
    structuredPromptRate: 0,
    usesCodeBlocks: false,
    usesExamples: false,
    usesFormatting: false,
    contextProvisionRate: 0,
    referencesFiles: false,
    referencesCode: false,
    referencesUrls: false,
    avgTurnsBeforeResolution: 0,
    refinementRate: 0,
    followUpRate: 0,
    usesRolePrompting: false,
    usesConstraints: false,
    usesStepByStep: false,
    specifiesOutputFormat: false,
    totalPromptsAnalyzed: 0,
    analysisVersion: ANALYSIS_VERSION,
  }
}

// --- API pública ---

/**
 * Analiza los prompts de una sesión (solo mensajes human).
 * Devuelve señales por sesión para luego agregar.
 */
export function analyzeSessionPrompts(messages: SessionMessage[]): SessionPromptingData {
  const userMessages = messages
    .filter(m => m.role === 'human')
    .map(m => extractText(m.content))
    .filter(text => text.trim().length > 0)

  if (userMessages.length === 0) {
    return emptySessionData()
  }

  return {
    promptLengths: userMessages.map(m => m.length),
    hasStructure: userMessages.some(hasStructure),
    hasCodeBlocks: userMessages.some(hasCodeBlocks),
    hasExamples: userMessages.some(hasExamples),
    hasFormatting: userMessages.some(hasFormatting),
    hasFileRefs: userMessages.some(hasFileReferences),
    hasCodeRefs: userMessages.some(hasCodeReferences),
    hasUrls: userMessages.some(hasUrls),
    hasRolePrompt: userMessages.some(hasRolePrompting),
    hasConstraints: userMessages.some(hasConstraints),
    hasStepByStep: userMessages.some(hasStepByStep),
    hasOutputFormat: userMessages.some(hasOutputFormat),
    turnCount: userMessages.length,
    hasRefinement: userMessages.some(isRefinement),
    hasFollowUp: userMessages.some(isFollowUp),
  }
}

/**
 * Agrega datos de varias sesiones en un único PromptingMetrics.
 * Sesiones vacías o sin prompts devuelven métricas por defecto.
 */
export function aggregatePromptingMetrics(sessions: SessionPromptingData[]): PromptingMetrics {
  if (sessions.length === 0) return emptyPromptingMetrics()

  const allLengths = sessions.flatMap(s => s.promptLengths)
  const totalPrompts = allLengths.length

  if (totalPrompts === 0) return emptyPromptingMetrics()

  const avgLength = allLengths.reduce((a, b) => a + b, 0) / totalPrompts
  const maxLength = Math.max(...allLengths)

  return {
    avgPromptLength: Math.round(avgLength),
    maxPromptLength: maxLength,
    promptLengthDistribution: {
      short: pct(allLengths, l => l < 100),
      medium: pct(allLengths, l => l >= 100 && l < 500),
      long: pct(allLengths, l => l >= 500 && l < 2000),
      detailed: pct(allLengths, l => l >= 2000),
    },
    structuredPromptRate: pct(sessions, s => s.hasStructure),
    usesCodeBlocks: sessions.some(s => s.hasCodeBlocks),
    usesExamples: sessions.some(s => s.hasExamples),
    usesFormatting: sessions.some(s => s.hasFormatting),
    contextProvisionRate: pct(sessions, s => s.hasFileRefs || s.hasCodeRefs || s.hasUrls),
    referencesFiles: sessions.some(s => s.hasFileRefs),
    referencesCode: sessions.some(s => s.hasCodeRefs),
    referencesUrls: sessions.some(s => s.hasUrls),
    avgTurnsBeforeResolution: avg(sessions.map(s => s.turnCount)),
    refinementRate: pct(sessions, s => s.hasRefinement),
    followUpRate: pct(sessions, s => s.hasFollowUp),
    usesRolePrompting: sessions.some(s => s.hasRolePrompt),
    usesConstraints: sessions.some(s => s.hasConstraints),
    usesStepByStep: sessions.some(s => s.hasStepByStep),
    specifiesOutputFormat: sessions.some(s => s.hasOutputFormat),
    totalPromptsAnalyzed: totalPrompts,
    analysisVersion: ANALYSIS_VERSION,
  }
}
