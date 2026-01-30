import type { CollectorResult } from './types.js'

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
        body: JSON.stringify({ metrics: results }),
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
