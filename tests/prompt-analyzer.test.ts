import { describe, it, expect } from 'vitest'
import {
  analyzeSessionPrompts,
  aggregatePromptingMetrics,
  type SessionMessage,
} from '../src/analyzers/prompt-analyzer.js'

function sessionWithOnePrompt(content: string): SessionMessage[] {
  return [{ role: 'human', content }]
}

describe('PromptAnalyzer', () => {
  describe('signal detection', () => {
    it('detecta estructura con listas (ES)', () => {
      const data = analyzeSessionPrompts(
        sessionWithOnePrompt('1. Primero haz esto\n2. Segundo haz lo otro'),
      )
      expect(data.hasStructure).toBe(true)
    })

    it('detecta estructura con listas (EN)', () => {
      const data = analyzeSessionPrompts(
        sessionWithOnePrompt('1. First do this\n2. Second do that'),
      )
      expect(data.hasStructure).toBe(true)
    })

    it('detecta code blocks', () => {
      const data = analyzeSessionPrompts(
        sessionWithOnePrompt('```typescript\nconst x = 1\n```'),
      )
      expect(data.hasCodeBlocks).toBe(true)
    })

    it('detecta ejemplos (ES)', () => {
      const data = analyzeSessionPrompts(
        sessionWithOnePrompt('por ejemplo: input → output'),
      )
      expect(data.hasExamples).toBe(true)
    })

    it('detecta ejemplos (EN)', () => {
      const data = analyzeSessionPrompts(
        sessionWithOnePrompt('for example: input → output'),
      )
      expect(data.hasExamples).toBe(true)
    })

    it('detecta role prompting (ES)', () => {
      const data = analyzeSessionPrompts(
        sessionWithOnePrompt('Actúa como un experto en TypeScript'),
      )
      expect(data.hasRolePrompt).toBe(true)
    })

    it('detecta role prompting (EN)', () => {
      const data = analyzeSessionPrompts(
        sessionWithOnePrompt('Act as an expert in TypeScript'),
      )
      expect(data.hasRolePrompt).toBe(true)
    })

    it('detecta constraints (ES)', () => {
      const data = analyzeSessionPrompts(
        sessionWithOnePrompt('No uses jQuery en el código'),
      )
      expect(data.hasConstraints).toBe(true)
    })

    it('detecta constraints (EN)', () => {
      const data = analyzeSessionPrompts(
        sessionWithOnePrompt("Don't use jQuery in the code"),
      )
      expect(data.hasConstraints).toBe(true)
    })

    it('detecta step-by-step (ES)', () => {
      const data = analyzeSessionPrompts(
        sessionWithOnePrompt('Explícalo paso a paso'),
      )
      expect(data.hasStepByStep).toBe(true)
    })

    it('detecta step-by-step (EN)', () => {
      const data = analyzeSessionPrompts(
        sessionWithOnePrompt('Explain it step by step'),
      )
      expect(data.hasStepByStep).toBe(true)
    })

    it('detecta output format (ES)', () => {
      const data = analyzeSessionPrompts(
        sessionWithOnePrompt('devuelve el resultado en JSON'),
      )
      expect(data.hasOutputFormat).toBe(true)
    })

    it('detecta output format (EN)', () => {
      const data = analyzeSessionPrompts(
        sessionWithOnePrompt('return the result as JSON'),
      )
      expect(data.hasOutputFormat).toBe(true)
    })

    it('detecta file references', () => {
      const data = analyzeSessionPrompts(
        sessionWithOnePrompt('Mira el archivo src/utils/auth.ts'),
      )
      expect(data.hasFileRefs).toBe(true)
    })

    it('detecta URLs', () => {
      const data = analyzeSessionPrompts(
        sessionWithOnePrompt('Ver docs en https://docs.example.com'),
      )
      expect(data.hasUrls).toBe(true)
    })

    it('detecta refinamiento (ES)', () => {
      const data = analyzeSessionPrompts(
        sessionWithOnePrompt('no, quise decir otra cosa'),
      )
      expect(data.hasRefinement).toBe(true)
    })

    it('detecta refinamiento (EN)', () => {
      const data = analyzeSessionPrompts(
        sessionWithOnePrompt('actually, I meant something else'),
      )
      expect(data.hasRefinement).toBe(true)
    })
  })

  describe('aggregation', () => {
    it('agrega múltiples sesiones correctamente', () => {
      const sessions: SessionMessage[][] = [
        sessionWithOnePrompt('1. First\n2. Second'),
        sessionWithOnePrompt('```\ncode\n```'),
        sessionWithOnePrompt('Act as an expert'),
      ]
      const data = sessions.map(msgs => analyzeSessionPrompts(msgs))
      const metrics = aggregatePromptingMetrics(data)
      expect(metrics.totalPromptsAnalyzed).toBe(3)
      expect(metrics.usesCodeBlocks).toBe(true)
      expect(metrics.usesRolePrompting).toBe(true)
      expect(metrics.structuredPromptRate).toBeGreaterThan(0)
    })

    it('maneja sesiones vacías', () => {
      const metrics = aggregatePromptingMetrics([])
      expect(metrics.totalPromptsAnalyzed).toBe(0)
      expect(metrics.avgPromptLength).toBe(0)
      expect(metrics.analysisVersion).toBeDefined()
    })

    it('calcula distribución de longitudes', () => {
      const short = sessionWithOnePrompt('hi')
      const detailed = sessionWithOnePrompt('x'.repeat(2500))
      const data = [
        analyzeSessionPrompts(short),
        analyzeSessionPrompts(detailed),
      ]
      const metrics = aggregatePromptingMetrics(data)
      expect(metrics.promptLengthDistribution.short).toBe(50)
      expect(metrics.promptLengthDistribution.detailed).toBe(50)
    })

    it('calcula rates como porcentajes (0-100)', () => {
      const sessions: SessionMessage[][] = [
        sessionWithOnePrompt('1. A\n2. B'),
        sessionWithOnePrompt('solo texto'),
      ]
      const data = sessions.map(msgs => analyzeSessionPrompts(msgs))
      const metrics = aggregatePromptingMetrics(data)
      expect(metrics.structuredPromptRate).toBe(50)
      expect(metrics.structuredPromptRate).toBeGreaterThanOrEqual(0)
      expect(metrics.structuredPromptRate).toBeLessThanOrEqual(100)
    })
  })

  describe('performance', () => {
    it('analiza 50 sesiones en < 2 segundos', () => {
      const sessions: SessionMessage[][] = Array.from({ length: 50 }, (_, i) =>
        sessionWithOnePrompt(
          `Prompt ${i}: 1. Item\n2. Item\n\`\`\`code\`\`\``,
        ),
      )
      const start = performance.now()
      const data = sessions.map(msgs => analyzeSessionPrompts(msgs))
      aggregatePromptingMetrics(data)
      const elapsed = performance.now() - start
      expect(elapsed).toBeLessThan(2000)
    })
  })
})
