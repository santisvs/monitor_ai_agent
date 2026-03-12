import type { TaskType } from './types.js'

/**
 * Infiere el tipo de tarea a partir del resumen y primer prompt.
 * La inferencia se hace localmente, sin enviar el texto al servidor.
 */
export function inferTaskType(summary: string, firstPrompt: string): TaskType {
  const text = `${summary || ''} ${firstPrompt || ''}`.toLowerCase()

  // Planning / Architecture
  if (/\b(plan|architect|design|structure|scaffold|outline|strategy)\b/.test(text)) {
    return 'planning'
  }

  // Debugging
  if (/\b(fix|bug|error|debug|issue|crash|broken|fail|exception)\b/.test(text)) {
    return 'debugging'
  }

  // Refactoring
  if (/\b(refactor|clean|improve|simplify|optimize|reorganize|restructure)\b/.test(text)) {
    return 'refactoring'
  }

  // Testing
  if (/\b(test|spec|coverage|jest|vitest|mocha|pytest|unittest|e2e|integration)\b/.test(text)) {
    return 'testing'
  }

  // Code review
  if (/\b(review|check|verify|audit|examine|inspect|analyze)\b/.test(text)) {
    return 'review'
  }

  // Documentation
  if (/\b(doc|readme|comment|explain|document|jsdoc|tsdoc|api doc)\b/.test(text)) {
    return 'documentation'
  }

  // Implementation (default for code-related tasks)
  if (/\b(implement|create|build|add|feature|develop|write|make|new)\b/.test(text)) {
    return 'implementation'
  }

  return 'other'
}

/**
 * Detecta si una sesión usó plan mode basándose en el summary
 */
export function detectsPlanMode(summary: string): boolean {
  if (!summary) return false
  const text = summary.toLowerCase()
  return /\b(plan|planning|architecture|design|strategy|outline)\b/.test(text)
}
