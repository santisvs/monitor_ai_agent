import { describe, it, expect } from 'vitest'
import {
  detectSkills,
  detectSkillsFromToolCalls,
  detectAtReferences,
  detectActions,
  detectFlowPattern,
  detectMetaInstructions,
  analyzeSessionWorkflow,
  aggregateWorkflowMetrics,
  type ToolCall,
} from '../src/analyzers/workflow-analyzer.js'
import type { SessionMessage } from '../src/analyzers/prompt-analyzer.js'

function sessionWithOnePrompt(content: string): SessionMessage[] {
  return [{ role: 'human', content }]
}

describe('WorkflowAnalyzer', () => {
  describe('detectSkills', () => {
    it('detecta slash commands correctamente', () => {
      expect(detectSkills('/executing-plans implementa el step 02')).toEqual(['executing-plans'])
      expect(detectSkills('/verification-before-completion')).toEqual(['verification-before-completion'])
      expect(detectSkills('Hola\n/writing-plans\n/brainstorm')).toEqual(['writing-plans', 'brainstorm'])
    })
    it('ignora texto sin slash al inicio de línea', () => {
      expect(detectSkills('usa el comando /executing-plans')).toEqual([])
    })
  })

  describe('detectSkillsFromToolCalls', () => {
    it('extrae skills de tool_calls tipo Skill', () => {
      const calls: ToolCall[] = [
        { name: 'Skill', input: { skill: 'executing-plans' } },
        { name: 'Skill', input: { skill: 'verification-before-completion' } },
        { name: 'Other', input: {} },
      ]
      expect(detectSkillsFromToolCalls(calls)).toEqual(['executing-plans', 'verification-before-completion'])
    })
    it('devuelve array vacío si no hay Skill', () => {
      expect(detectSkillsFromToolCalls([{ name: 'Read', input: {} }])).toEqual([])
    })
  })

  describe('detectAtReferences', () => {
    it('cuenta @refs y paths (bilingüe)', () => {
      const r = detectAtReferences('Mira @src/utils/auth.ts y lee el archivo package.json')
      expect(r.count).toBeGreaterThanOrEqual(1)
      expect(r.uniqueFiles.some(f => f.includes('auth') || f.includes('package'))).toBe(true)
    })
    it('detecta plan files (ES+EN)', () => {
      const rPlan = detectAtReferences('Sigue @plan/TODO/feature_workflow/PLAN.md')
      expect(rPlan.hasPlanFiles).toBe(true)
      const rProgress = detectAtReferences('Check progress/step-01.md')
      expect(rProgress.hasPlanFiles).toBe(true)
    })
    it('detecta config files', () => {
      const r = detectAtReferences('Lee el archivo package.json y config.ts')
      expect(r.hasConfigFiles).toBe(true)
    })
    it('detecta paths explícitos en español (lee el archivo...)', () => {
      const r = detectAtReferences('Lee el archivo src/utils/auth.ts y mira package.json')
      expect(r.explicitPathsCount).toBeGreaterThanOrEqual(1)
      expect(r.uniqueFiles.some(f => f.includes('auth') || f.includes('package'))).toBe(true)
    })
    it('detecta paths explícitos en inglés (read the file...)', () => {
      const r = detectAtReferences('Read the file src/main.ts and check config.json')
      expect(r.explicitPathsCount).toBeGreaterThanOrEqual(1)
      expect(r.uniqueFiles.some(f => f.includes('main') || f.includes('config'))).toBe(true)
    })
  })

  describe('detectFlowPattern', () => {
    it('identifica full-cycle', () => {
      expect(detectFlowPattern(['plan', 'implement', 'verify', 'review'])).toBe('full-cycle')
    })
    it('identifica plan-and-verify', () => {
      expect(detectFlowPattern(['plan', 'implement', 'verify'])).toBe('plan-and-verify')
    })
    it('identifica implement-only', () => {
      expect(detectFlowPattern(['implement'])).toBe('implement-only')
    })
    it('identifica explore-only', () => {
      expect(detectFlowPattern(['explore'])).toBe('explore-only')
    })
    it('identifica unknown cuando no hay patrón conocido', () => {
      expect(detectFlowPattern([])).toBe('unknown')
    })
  })

  describe('detectMetaInstructions (bilingüe)', () => {
    it('detecta define proceso en español', () => {
      const m = detectMetaInstructions(['Primero lee el plan, luego implementa, finalmente verifica'])
      expect(m.definesProcess).toBe(true)
    })
    it('detecta define proceso en inglés', () => {
      const m = detectMetaInstructions(['First read the plan, then implement, finally verify'])
      expect(m.definesProcess).toBe(true)
    })
    it('detecta restricciones (ES)', () => {
      const m = detectMetaInstructions(['No hagas commit sin mi aprobación'])
      expect(m.setsConstraints).toBe(true)
    })
    it('detecta restricciones (EN)', () => {
      const m = detectMetaInstructions(["Don't commit, read only"])
      expect(m.setsConstraints).toBe(true)
    })
    it('detecta pide verificación (ES)', () => {
      const m = detectMetaInstructions(['Verifica que los tests pasen antes de terminar'])
      expect(m.requestsVerification).toBe(true)
    })
    it('detecta criterios de aceptación (EN)', () => {
      const m = detectMetaInstructions(['Done when acceptance criteria are met'])
      expect(m.definesAcceptance).toBe(true)
    })
  })

  describe('analyzeSessionWorkflow', () => {
    it('sesión sin señales de workflow devuelve todo a 0/false/unknown', () => {
      const messages = sessionWithOnePrompt('ok')
      const data = analyzeSessionWorkflow(messages)
      expect(data.skills).toEqual([])
      expect(data.atReferences.count).toBe(0)
      expect(data.atReferences.hasPlanFiles).toBe(false)
      expect(data.atReferences.hasConfigFiles).toBe(false)
      expect(data.actions).toEqual([])
      expect(data.flowPattern).toBe('unknown')
      expect(data.metaCognition.definesProcess).toBe(false)
      expect(data.metaCognition.setsConstraints).toBe(false)
      expect(data.metaCognition.requestsVerification).toBe(false)
      expect(data.metaCognition.definesAcceptance).toBe(false)
    })
    it('combina skills, @refs, acciones y meta por sesión', () => {
      const messages = sessionWithOnePrompt(
        '/executing-plans Implementa el step 02. Primero lee el plan, luego implementa, finalmente verifica que los tests pasen.'
      )
      const data = analyzeSessionWorkflow(messages)
      expect(data.skills).toContain('executing-plans')
      expect(data.actions).toContain('implement')
      expect(['implement-only', 'tdd-flow']).toContain(data.flowPattern)
      expect(data.metaCognition.definesProcess).toBe(true)
      expect(data.metaCognition.requestsVerification).toBe(true)
    })
  })

  describe('aggregateWorkflowMetrics', () => {
    it('agrega múltiples sesiones correctamente', () => {
      const sessions = [
        analyzeSessionWorkflow(sessionWithOnePrompt('/writing-plans y /executing implementa')),
        analyzeSessionWorkflow(sessionWithOnePrompt('/verification verifica que todo pase')),
      ]
      const m = aggregateWorkflowMetrics(sessions)
      expect(m.totalSessionsAnalyzed).toBe(2)
      expect(m.uniqueSkillsCount).toBeGreaterThanOrEqual(1)
      expect(m.skillsUsed.length).toBeGreaterThanOrEqual(1)
      expect(m.analysisVersion).toBe('1.0')
    })
    it('limita a últimas 50 sesiones', () => {
      const sessions = Array.from({ length: 60 }, (_, i) =>
        analyzeSessionWorkflow(sessionWithOnePrompt(`/skill-${i} mensaje`))
      )
      const m = aggregateWorkflowMetrics(sessions)
      expect(m.totalSessionsAnalyzed).toBe(50)
    })
    it('devuelve métricas vacías para 0 sesiones', () => {
      const m = aggregateWorkflowMetrics([])
      expect(m.totalSessionsAnalyzed).toBe(0)
      expect(m.skillsUsed).toEqual([])
      expect(m.skillUsageCount).toBe(0)
    })
    it('sesiones sin señales agregan totalSessionsAnalyzed pero métricas en 0/false', () => {
      const sessions = [
        analyzeSessionWorkflow(sessionWithOnePrompt('ok')),
        analyzeSessionWorkflow(sessionWithOnePrompt('nada que detectar')),
      ]
      const m = aggregateWorkflowMetrics(sessions)
      expect(m.totalSessionsAnalyzed).toBe(2)
      expect(m.skillsUsed).toEqual([])
      expect(m.skillUsageCount).toBe(0)
      expect(m.atReferencesCount).toBe(0)
      expect(m.sessionsWithPlan).toBe(0)
      expect(m.definesProcess).toBe(false)
    })
    it('performance: 50 sesiones en < 2s', () => {
      const sessions = Array.from({ length: 50 }, (_, i) =>
        analyzeSessionWorkflow(sessionWithOnePrompt(
          `/executing-plans Implementa step ${i}. Primero lee @plan/PLAN.md, luego implementa, finalmente verifica.`
        ))
      )
      const start = performance.now()
      const m = aggregateWorkflowMetrics(sessions)
      const elapsed = performance.now() - start
      expect(m.totalSessionsAnalyzed).toBe(50)
      expect(elapsed).toBeLessThan(2000)
    })
  })
})
