import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import type { CollectorResult } from './types.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const { version: AGENT_VERSION } = JSON.parse(
  readFileSync(resolve(__dirname, '../../package.json'), 'utf-8'),
) as { version: string }

export async function sendMetrics(
  serverUrl: string,
  authToken: string,
  results: CollectorResult[],
): Promise<boolean> {
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
          agentVersion: AGENT_VERSION,
          metrics: results.map(r => {
            const { prompting, workflow, ...metricsOnly } = r.metrics
            return {
              tool: r.tool,
              metrics: metricsOnly,
              collectedAt: r.collectedAt,
              ...(prompting && Object.keys(prompting).length > 0 && { prompting }),
              ...(workflow && Object.keys(workflow).length > 0 && { workflow }),
            }
          }),
        }),
      })

      if (response.ok) {
        console.log(`Métricas enviadas correctamente (${results.length} collectors)`)
        return true
      }

      const error = await response.text()
      console.error(`Error del servidor (${response.status}): ${error}`)

      if (response.status === 401) {
        console.error('Token inválido. Ejecuta: monitor-ia-agent setup <token>')
        return false
      }
    } catch (err: any) {
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
