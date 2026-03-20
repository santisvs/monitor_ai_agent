import type { CollectorResult } from './types.js'
import { aggregatePromptingMetricsByTool } from './analyzers/prompt-analyzer.js'
import { aggregateWorkflowMetricsByTool } from './analyzers/workflow-analyzer.js'
import { detectProblematicPatterns } from './analyzers/problem-detector.js'
import type { SyncStateManager } from './sync-state.js'

export async function sendMetrics(
  serverUrl: string,
  authToken: string,
  results: CollectorResult[],
  agentVersion: string = '1.0.0',
  syncState?: SyncStateManager,
): Promise<boolean> {
  // Recoger todas las sesiones etiquetadas para análisis per-tool
  const allPromptingSessions = results.flatMap(r => r.promptingSessions ?? [])
  const allWorkflowSessions = results.flatMap(r => r.workflowSessions ?? [])

  const promptingByTool = aggregatePromptingMetricsByTool(allPromptingSessions)
  const workflowByTool = aggregateWorkflowMetricsByTool(allWorkflowSessions)
  const problematicByTool = detectProblematicPatterns(
    allWorkflowSessions.map(s => ({
      tool: s.tool ?? 'unknown',
      turns: s.skills.length + 1, // proxy: más skills = más turns
      actions: s.actions,
      contextProvisionRate: s.atReferences.count > 0 ? 1 : 0,
      messages: [],
    })),
  )

  const maxRetries = 3

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(`${serverUrl}/api/agent/metrics`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          agentVersion,
          metrics: results.map(r => {
            const { prompting, workflow, ...metricsOnly } = r.metrics
            return {
              tool: r.tool,
              metrics: metricsOnly,
              collectedAt: r.collectedAt,
              ...(prompting && Object.keys(prompting).length > 0 && { prompting }),
              ...(workflow && Object.keys(workflow).length > 0 && { workflow }),
              ...(promptingByTool[r.tool] && { promptingPerTool: promptingByTool[r.tool] }),
              ...(workflowByTool[r.tool] && { workflowPerTool: workflowByTool[r.tool] }),
              problematicSessions: problematicByTool[r.tool] ?? [],
            }
          }),
        }),
      })

      if (response.ok) {
        console.log(`Métricas enviadas correctamente (${results.length} collectors)`)

        // Persistir lastSyncedAt de la respuesta del servidor
        if (syncState) {
          const data = await response.json() as { syncedAt?: string }
          const syncedAt = data.syncedAt ? new Date(data.syncedAt) : new Date()
          for (const result of results) {
            syncState.setLastSyncedAt(result.tool, syncedAt)
          }
        }

        return true
      }

      const error = await response.text()
      console.error(`Error del servidor (${response.status}): ${error}`)

      if (response.status === 401) {
        console.error('Token inválido. Ejecuta: monitor-ia-agent setup <token>')
        return false
      }
    }
    catch (err: any) {
      console.error(`Intento ${attempt}/${maxRetries} falló: ${err.message}`)
    }

    if (attempt < maxRetries) {
      const delay = attempt * 2000
      console.log(`Reintentando en ${delay / 1000}s...`)
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }

  console.error('No se pudieron enviar las métricas después de todos los intentos')
  return false
}
