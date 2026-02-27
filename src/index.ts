#!/usr/bin/env node
import readline from 'readline'
import { loadConfig, saveConfig, configExists, type AgentConfig } from './config.js'
import { collectClaudeCode } from './collectors/claude-code.js'
import { collectCursor } from './collectors/cursor.js'
import { collectVSCodeCopilot } from './collectors/vscode-copilot.js'
import { sendMetrics } from './sender.js'
import { serviceInstall, serviceUninstall, serviceStatus } from './service.js'
import type { CollectorResult } from './types.js'

const collectors: Record<string, () => CollectorResult | Promise<CollectorResult>> = {
  'claude-code': collectClaudeCode,
  'cursor': collectCursor,
  'vscode-copilot': collectVSCodeCopilot,
}

const PRIVACY_NOTICE = `
╔══════════════════════════════════════════════════════════════════╗
║           Monitor IA Agent - Aviso de Privacidad                 ║
╠══════════════════════════════════════════════════════════════════╣
║                                                                  ║
║  Este agente recolecta métricas de uso de tus herramientas de    ║
║  IA para generar tu evaluación personalizada.                    ║
║                                                                  ║
║  DATOS RECOLECTADOS:                                             ║
║  • Número de sesiones, tokens y tiempo de uso                    ║
║  • Herramientas y modelos utilizados                             ║
║  • Tipos de tareas (inferidos localmente)                        ║
║  • Resúmenes de sesiones (encriptados antes de enviar)           ║
║                                                                  ║
║  NO SE RECOLECTA:                                                ║
║  • Contenido de tus conversaciones                               ║
║  • Código fuente                                                 ║
║  • Rutas de archivos o directorios de trabajo                    ║
║                                                                  ║
║  Los datos sensibles se encriptan localmente con AES-256-GCM     ║
║  antes de enviarse al servidor.                                  ║
║                                                                  ║
║  Puedes revocar tu consentimiento en cualquier momento desde     ║
║  la página de privacidad en el dashboard.                        ║
║                                                                  ║
╚══════════════════════════════════════════════════════════════════╝
`

async function askForConsent(): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  return new Promise((resolve) => {
    console.log(PRIVACY_NOTICE)
    rl.question('¿Deseas continuar? [s/N] ', (answer) => {
      rl.close()
      const accepted = answer.toLowerCase() === 's' || answer.toLowerCase() === 'si' || answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes'
      resolve(accepted)
    })
  })
}

async function setup(token: string, serverUrl?: string, skipConsent = false) {
  const url = serverUrl || 'https://jakite.tech'

  // Si ya existe config, preguntar si quiere reconfigurar
  if (configExists()) {
    console.log('El agente ya está configurado.')
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    })
    const answer = await new Promise<string>((resolve) => {
      rl.question('¿Deseas reconfigurar? [s/N] ', resolve)
    })
    rl.close()
    if (answer.toLowerCase() !== 's' && answer.toLowerCase() !== 'si') {
      console.log('Configuración cancelada.')
      return
    }
  }

  // Mostrar aviso de privacidad y pedir consentimiento
  if (!skipConsent) {
    const consent = await askForConsent()
    if (!consent) {
      console.log('\nConfiguración cancelada. No se instalará el agente.')
      return
    }
  }

  // Fetch config from server (incluye encryptionKey)
  let enabledCollectors = Object.keys(collectors)
  let encryptionKey: string | undefined

  try {
    const response = await fetch(`${url}/api/agent/config`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (response.ok) {
      const data = await response.json() as { enabledCollectors?: string[], encryptionKey?: string }
      if (data.enabledCollectors?.length) {
        enabledCollectors = data.enabledCollectors
      }
      if (data.encryptionKey) {
        encryptionKey = data.encryptionKey
      }
    }
  } catch {
    console.log('No se pudo conectar al servidor para obtener configuración.')
    console.log('Usando configuración por defecto.')
  }

  const config: AgentConfig = {
    serverUrl: url,
    authToken: token,
    syncIntervalHours: 6,
    enabledCollectors,
    consentGivenAt: new Date().toISOString(),
  }

  if (encryptionKey) {
    config.encryptionKey = encryptionKey
  }

  saveConfig(config)

  console.log('\n✓ Agente configurado correctamente')
  console.log(`  Servidor: ${url}`)
  console.log(`  Collectors: ${enabledCollectors.join(', ')}`)
  console.log(`  Intervalo: 6 horas`)
  console.log(`  Encriptación: ${encryptionKey ? 'habilitada' : 'deshabilitada'}`)
  console.log(`  Consentimiento: dado en ${new Date().toLocaleString()}`)
  console.log('\nSiguientes pasos:')
  console.log('  1. Ejecuta: monitor-ia-agent run-once    (para probar)')
  console.log('  2. Ejecuta: monitor-ia-agent service install  (para ejecución automática)')
}

async function runCollectors(enabled: string[]): Promise<CollectorResult[]> {
  const results: CollectorResult[] = []

  for (const name of enabled) {
    const collector = collectors[name]
    if (!collector) {
      console.warn(`Collector desconocido: ${name}`)
      continue
    }
    try {
      console.log(`  Recolectando: ${name}...`)
      const result = await Promise.resolve(collector())
      results.push(result)

      // Mostrar resumen breve
      if (result.metrics.sessionsCount !== undefined) {
        console.log(`    → ${result.metrics.sessionsCount} sesiones`)
      }
      if (result.metrics.totalTokens !== undefined && result.metrics.totalTokens > 0) {
        console.log(`    → ${result.metrics.totalTokens.toLocaleString()} tokens`)
      }
      if (result.metrics.encrypted) {
        console.log(`    → datos sensibles encriptados`)
      }
      if (result.metrics.prompting?.totalPromptsAnalyzed !== undefined && result.metrics.prompting.totalPromptsAnalyzed > 0) {
        console.log(`    → prompting: ${result.metrics.prompting.totalPromptsAnalyzed} prompts analizados`)
      }
      if (result.metrics.workflow !== undefined) {
        const wf = result.metrics.workflow as any
        console.log(`    → workflow: ${wf.totalSessionsAnalyzed} sesiones (skills: ${wf.uniqueSkillsCount ?? 0}, @refs: ${wf.atReferencesCount ?? 0}, conPlan: ${wf.sessionsWithPlan ?? 0})`)
      } else {
        console.log(`    → workflow: sin datos`)
      }
    } catch (err: unknown) {
      const error = err as Error
      console.error(`  Error en ${name}: ${error.message}`)
    }
  }

  return results
}

const MIN_HOURS_BETWEEN_SENDS = 15

async function runOnce() {
  const config = loadConfig()

  // Guard: mínimo 15h entre envíos para evitar dobles envíos por reinicios rápidos
  if (config.lastSentAt) {
    const hoursSinceLast = (Date.now() - new Date(config.lastSentAt).getTime()) / 3600000
    if (hoursSinceLast < MIN_HOURS_BETWEEN_SENDS) {
      console.log(`[Monitor IA] Guard activo: último envío hace ${hoursSinceLast.toFixed(1)}h. Mínimo ${MIN_HOURS_BETWEEN_SENDS}h entre envíos.`)
      return
    }
  }

  console.log(`[${new Date().toLocaleString()}] Ejecutando recolección...`)
  const results = await runCollectors(config.enabledCollectors)
  console.log(`  ${results.length} resultados recolectados`)

  if (results.length > 0) {
    await sendMetrics(config.serverUrl, config.authToken, results)
    // Guardar timestamp de envío exitoso
    config.lastSentAt = new Date().toISOString()
    saveConfig(config)
  }
}

async function run() {
  const config = loadConfig()
  console.log('Monitor IA Agent iniciado')
  console.log(`  Servidor: ${config.serverUrl}`)
  console.log(`  Intervalo: ${config.syncIntervalHours}h`)
  console.log(`  Collectors: ${config.enabledCollectors.join(', ')}`)
  console.log(`  Encriptación: ${config.encryptionKey ? 'habilitada' : 'deshabilitada'}`)

  async function cycle() {
    console.log(`\n[${new Date().toLocaleString()}] Ejecutando recolección...`)
    const results = await runCollectors(config.enabledCollectors)
    console.log(`  ${results.length} resultados recolectados`)

    if (results.length > 0) {
      await sendMetrics(config.serverUrl, config.authToken, results)
    }
  }

  // Run immediately
  await cycle()

  // Schedule
  const intervalMs = config.syncIntervalHours * 60 * 60 * 1000
  setInterval(cycle, intervalMs)
  console.log(`\nPróxima ejecución en ${config.syncIntervalHours}h. Ctrl+C para detener.`)
}

function configInterval(hours: number) {
  if (hours < 1 || hours > 24) {
    console.error('El intervalo debe estar entre 1 y 24 horas.')
    process.exit(1)
  }
  const config = loadConfig()
  config.syncIntervalHours = hours
  saveConfig(config)
  console.log(`Intervalo actualizado a ${hours}h`)
  console.log('Si tienes el servicio instalado, reinstálalo para aplicar el cambio:')
  console.log('  monitor-ia-agent service install')
}

async function status() {
  if (!configExists()) {
    console.log('Agente no configurado. Ejecuta: monitor-ia-agent setup <token>')
    return
  }

  const config = loadConfig()
  console.log('Estado del agente:')
  console.log(`  Servidor: ${config.serverUrl}`)
  console.log(`  Collectors: ${config.enabledCollectors.join(', ')}`)
  console.log(`  Intervalo: ${config.syncIntervalHours}h`)
  console.log(`  Encriptación: ${config.encryptionKey ? 'habilitada' : 'deshabilitada'}`)
  if (config.consentGivenAt) {
    console.log(`  Consentimiento: dado en ${new Date(config.consentGivenAt).toLocaleString()}`)
  }

  // Run collectors once to show current data
  console.log('\nDatos actuales:')
  const results = await runCollectors(config.enabledCollectors)
  for (const r of results) {
    console.log(`\n  ${r.tool}:`)
    for (const [key, value] of Object.entries(r.metrics)) {
      if (key === 'encrypted') {
        console.log(`    ${key}: [datos encriptados]`)
      } else if (Array.isArray(value)) {
        console.log(`    ${key}: [${value.length} elementos]`)
      } else if (typeof value === 'object' && value !== null) {
        console.log(`    ${key}: ${JSON.stringify(value)}`)
      } else {
        console.log(`    ${key}: ${value}`)
      }
    }
  }
}

function showHelp() {
  console.log('Monitor IA Agent v1.6.2')
  console.log('')
  console.log('Recolecta métricas de uso de herramientas de IA para tu evaluación personalizada.')
  console.log('')
  console.log('Comandos:')
  console.log('  setup <token> [serverUrl]  - Configurar el agente (incluye aviso de privacidad)')
  console.log('  run                        - Iniciar recolección continua')
  console.log('  run-once                   - Ejecutar una sola recolección')
  console.log('  status                     - Ver estado actual y datos recolectados')
  console.log('  service install            - Instalar como servicio del sistema')
  console.log('  service uninstall          - Desinstalar servicio')
  console.log('  service status             - Ver estado del servicio')
  console.log('  config interval <horas>    - Cambiar intervalo de recolección (1-24h)')
  console.log('')
  console.log('Ejemplo de uso:')
  console.log('  1. monitor-ia-agent setup mia_tu_token_aqui https://tu-servidor.com')
  console.log('  2. monitor-ia-agent run-once')
  console.log('  3. monitor-ia-agent service install')
  console.log('')
  console.log('Privacidad:')
  console.log('  Los datos sensibles se encriptan localmente antes de enviarse.')
  console.log('  Puedes revocar tu consentimiento desde el dashboard en cualquier momento.')
}

// CLI
const args = process.argv.slice(2)
const command = args[0]

async function main() {
  switch (command) {
    case 'setup':
      if (!args[1]) {
        console.error('Uso: monitor-ia-agent setup <token> [serverUrl]')
        process.exit(1)
      }
      await setup(args[1], args[2])
      break
    case 'run':
      await run()
      break
    case 'run-once':
      await runOnce()
      break
    case 'status':
      await status()
      break
    case 'service':
      switch (args[1]) {
        case 'install':
          serviceInstall()
          break
        case 'uninstall':
          serviceUninstall()
          break
        case 'status':
          serviceStatus()
          break
        default:
          console.log('Uso: monitor-ia-agent service <install|uninstall|status>')
      }
      break
    case 'config':
      if (args[1] === 'interval' && args[2]) {
        configInterval(parseInt(args[2], 10))
      } else {
        console.log('Uso: monitor-ia-agent config interval <horas>')
      }
      break
    case '--help':
    case '-h':
    case 'help':
      showHelp()
      break
    default:
      showHelp()
  }
}

main().catch((err: Error) => {
  console.error(err)
  process.exit(1)
})
