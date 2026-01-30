#!/usr/bin/env node
import { loadConfig, saveConfig, configExists } from './config.js'
import { collectClaudeCode } from './collectors/claude-code.js'
import { collectCursor } from './collectors/cursor.js'
import { collectVSCodeCopilot } from './collectors/vscode-copilot.js'
import { sendMetrics } from './sender.js'
import { serviceInstall, serviceUninstall, serviceStatus } from './service.js'
import type { CollectorResult } from './types.js'

const collectors: Record<string, () => CollectorResult> = {
  'claude-code': collectClaudeCode,
  'cursor': collectCursor,
  'vscode-copilot': collectVSCodeCopilot,
}

async function setup(token: string, serverUrl?: string) {
  const url = serverUrl || 'http://localhost:3000'

  // Fetch config from server
  let enabledCollectors = Object.keys(collectors)
  try {
    const response = await fetch(`${url}/api/agent/config`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (response.ok) {
      const data = await response.json() as any
      if (data.enabledCollectors?.length) {
        enabledCollectors = data.enabledCollectors
      }
    }
  } catch {
    console.log('No se pudo conectar al servidor, usando configuración por defecto')
  }

  saveConfig({
    serverUrl: url,
    authToken: token,
    syncIntervalHours: 6,
    enabledCollectors,
  })

  console.log('Agente configurado correctamente')
  console.log(`  Servidor: ${url}`)
  console.log(`  Collectors: ${enabledCollectors.join(', ')}`)
  console.log(`  Intervalo: 6 horas`)
  console.log('\nEjecuta: monitor-ia-agent run')
}

function runCollectors(enabled: string[]): CollectorResult[] {
  const results: CollectorResult[] = []

  for (const name of enabled) {
    const collector = collectors[name]
    if (!collector) {
      console.warn(`Collector desconocido: ${name}`)
      continue
    }
    try {
      console.log(`  Recolectando: ${name}...`)
      results.push(collector())
    } catch (err: any) {
      console.error(`  Error en ${name}: ${err.message}`)
    }
  }

  return results
}

async function runOnce() {
  const config = loadConfig()
  console.log(`[${new Date().toLocaleString()}] Ejecutando recolección...`)
  const results = runCollectors(config.enabledCollectors)
  console.log(`  ${results.length} resultados recolectados`)

  if (results.length > 0) {
    await sendMetrics(config.serverUrl, config.authToken, results)
  }
}

async function run() {
  const config = loadConfig()
  console.log('Monitor IA Agent iniciado')
  console.log(`  Servidor: ${config.serverUrl}`)
  console.log(`  Intervalo: ${config.syncIntervalHours}h`)
  console.log(`  Collectors: ${config.enabledCollectors.join(', ')}`)

  async function cycle() {
    console.log(`\n[${new Date().toLocaleString()}] Ejecutando recolección...`)
    const results = runCollectors(config.enabledCollectors)
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
  console.log('  npx tsx src/index.ts service install')
}

function status() {
  if (!configExists()) {
    console.log('Agente no configurado. Ejecuta: monitor-ia-agent setup <token>')
    return
  }

  const config = loadConfig()
  console.log('Estado del agente:')
  console.log(`  Servidor: ${config.serverUrl}`)
  console.log(`  Collectors: ${config.enabledCollectors.join(', ')}`)
  console.log(`  Intervalo: ${config.syncIntervalHours}h`)

  // Run collectors once to show current data
  console.log('\nDatos actuales:')
  const results = runCollectors(config.enabledCollectors)
  for (const r of results) {
    console.log(`\n  ${r.tool}:`)
    for (const [key, value] of Object.entries(r.metrics)) {
      console.log(`    ${key}: ${JSON.stringify(value)}`)
    }
  }
}

// CLI
const args = process.argv.slice(2)
const command = args[0]

switch (command) {
  case 'setup':
    if (!args[1]) {
      console.error('Uso: monitor-ia-agent setup <token> [serverUrl]')
      process.exit(1)
    }
    setup(args[1], args[2])
    break
  case 'run':
    run()
    break
  case 'run-once':
    runOnce()
    break
  case 'status':
    status()
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
  default:
    console.log('Monitor IA Agent')
    console.log('\nComandos:')
    console.log('  setup <token> [serverUrl]  - Configurar el agente')
    console.log('  run                        - Iniciar recolección continua')
    console.log('  run-once                   - Ejecutar una sola recolección')
    console.log('  status                     - Ver estado actual')
    console.log('  service install            - Instalar como servicio del sistema')
    console.log('  service uninstall          - Desinstalar servicio')
    console.log('  service status             - Ver estado del servicio')
    console.log('  config interval <horas>    - Cambiar intervalo de recolección')
}
