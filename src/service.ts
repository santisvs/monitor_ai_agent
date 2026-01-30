import { execSync } from 'child_process'
import os from 'os'
import path from 'path'
import fs from 'fs'
import { loadConfig } from './config.js'

const TASK_NAME = 'MonitorIA-Agent'
const AGENT_DIR = path.join(os.homedir(), '.monitor-ia', 'agent')
const platform = os.platform()

function getNodePath(): string {
  try {
    const nodePath = execSync(platform === 'win32' ? 'where node' : 'which node', { encoding: 'utf-8' }).trim().split('\n')[0]
    return nodePath.trim()
  } catch {
    return 'node'
  }
}

export function serviceInstall(): void {
  const config = loadConfig()
  const intervalHours = config.syncIntervalHours || 6
  const nodePath = getNodePath()
  const scriptPath = path.join(AGENT_DIR, 'dist', 'index.js')

  if (!fs.existsSync(scriptPath)) {
    console.error(`Error: No se encuentra ${scriptPath}`)
    console.error('Ejecuta "npm run build" primero.')
    process.exit(1)
  }

  if (platform === 'win32') {
    installWindows(nodePath, scriptPath, intervalHours)
  } else if (platform === 'darwin') {
    installMac(nodePath, scriptPath, intervalHours)
  } else {
    installLinux(nodePath, scriptPath, intervalHours)
  }
}

export function serviceUninstall(): void {
  if (platform === 'win32') {
    uninstallWindows()
  } else if (platform === 'darwin') {
    uninstallMac()
  } else {
    uninstallLinux()
  }
}

export function serviceStatus(): void {
  if (platform === 'win32') {
    statusWindows()
  } else if (platform === 'darwin') {
    statusMac()
  } else {
    statusLinux()
  }
}

// === WINDOWS ===

function installWindows(nodePath: string, scriptPath: string, intervalHours: number) {
  // Remove existing task first
  try {
    execSync(`schtasks /Delete /TN "${TASK_NAME}" /F`, { stdio: 'ignore' })
  } catch {}

  const intervalMinutes = intervalHours * 60
  const cmd = `schtasks /Create /TN "${TASK_NAME}" /TR "\\"${nodePath}\\" \\"${scriptPath}\\" run-once" /SC MINUTE /MO ${intervalMinutes} /F`

  try {
    execSync(cmd, { stdio: 'ignore' })
    console.log('Servicio instalado correctamente (Task Scheduler)')
    console.log(`  Tarea: ${TASK_NAME}`)
    console.log(`  Intervalo: cada ${intervalHours}h`)
    console.log(`  Comando: node ${scriptPath} run-once`)
    console.log('\nPara verificar: npx tsx src/index.ts service status')
    console.log('Para desinstalar: npx tsx src/index.ts service uninstall')
  } catch (err: any) {
    console.error('Error al crear la tarea programada.')
    console.error('Puede que necesites ejecutar como administrador.')
    console.error(err.message)
  }
}

function uninstallWindows() {
  try {
    execSync(`schtasks /Delete /TN "${TASK_NAME}" /F`, { stdio: 'ignore' })
    console.log(`Tarea "${TASK_NAME}" eliminada correctamente.`)
  } catch {
    console.log(`No se encontró la tarea "${TASK_NAME}".`)
  }
}

function statusWindows() {
  try {
    const output = execSync(`schtasks /Query /TN "${TASK_NAME}" /FO LIST /V`, { encoding: 'utf-8' })
    const statusMatch = output.match(/Status:\s*(.+)/i) || output.match(/Estado:\s*(.+)/i)
    const lastRunMatch = output.match(/Last Run Time:\s*(.+)/i) || output.match(/Última vez que se ejecutó:\s*(.+)/i)
    const nextRunMatch = output.match(/Next Run Time:\s*(.+)/i) || output.match(/Próxima ejecución:\s*(.+)/i)

    console.log(`Servicio: ${TASK_NAME}`)
    console.log(`  Estado: ${statusMatch ? statusMatch[1].trim() : 'desconocido'}`)
    console.log(`  Última ejecución: ${lastRunMatch ? lastRunMatch[1].trim() : 'nunca'}`)
    console.log(`  Próxima ejecución: ${nextRunMatch ? nextRunMatch[1].trim() : 'desconocida'}`)
  } catch {
    console.log(`Servicio "${TASK_NAME}" no instalado.`)
    console.log('Instálalo con: npx tsx src/index.ts service install')
  }
}

// === LINUX ===

function installLinux(nodePath: string, scriptPath: string, intervalHours: number) {
  const cronLine = `0 */${intervalHours} * * * cd ${AGENT_DIR} && ${nodePath} ${scriptPath} run-once >> ${path.join(os.homedir(), '.monitor-ia', 'agent.log')} 2>&1`

  try {
    // Remove existing entry
    let existing = ''
    try {
      existing = execSync('crontab -l 2>/dev/null', { encoding: 'utf-8' })
    } catch {}
    const filtered = existing.split('\n').filter(l => !l.includes(TASK_NAME) && !l.includes('monitor-ia')).join('\n')
    const newCrontab = (filtered.trim() ? filtered.trim() + '\n' : '') + `# ${TASK_NAME}\n${cronLine}\n`

    execSync(`echo "${newCrontab}" | crontab -`, { encoding: 'utf-8' })
    console.log('Servicio instalado correctamente (cron)')
    console.log(`  Intervalo: cada ${intervalHours}h`)
    console.log(`  Log: ~/.monitor-ia/agent.log`)
    console.log('\nPara verificar: crontab -l')
    console.log('Para desinstalar: npx tsx src/index.ts service uninstall')
  } catch (err: any) {
    console.error('Error al configurar cron:', err.message)
  }
}

function uninstallLinux() {
  try {
    const existing = execSync('crontab -l 2>/dev/null', { encoding: 'utf-8' })
    const filtered = existing.split('\n').filter(l => !l.includes(TASK_NAME) && !l.includes('monitor-ia')).join('\n')
    execSync(`echo "${filtered}" | crontab -`, { encoding: 'utf-8' })
    console.log('Entrada de cron eliminada correctamente.')
  } catch {
    console.log('No se encontró entrada de cron.')
  }
}

function statusLinux() {
  try {
    const crontab = execSync('crontab -l 2>/dev/null', { encoding: 'utf-8' })
    if (crontab.includes('monitor-ia')) {
      console.log(`Servicio: ${TASK_NAME} (cron)`)
      console.log('  Estado: activo')
      const logPath = path.join(os.homedir(), '.monitor-ia', 'agent.log')
      if (fs.existsSync(logPath)) {
        const lines = fs.readFileSync(logPath, 'utf-8').trim().split('\n')
        console.log(`  Última línea de log: ${lines[lines.length - 1]}`)
      }
    } else {
      console.log(`Servicio "${TASK_NAME}" no instalado.`)
    }
  } catch {
    console.log(`Servicio "${TASK_NAME}" no instalado.`)
  }
}

// === MAC ===

const PLIST_PATH = path.join(os.homedir(), 'Library', 'LaunchAgents', 'com.monitor-ia.agent.plist')

function installMac(nodePath: string, scriptPath: string, intervalHours: number) {
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.monitor-ia.agent</string>
    <key>ProgramArguments</key>
    <array>
        <string>${nodePath}</string>
        <string>${scriptPath}</string>
        <string>run-once</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${AGENT_DIR}</string>
    <key>StartInterval</key>
    <integer>${intervalHours * 3600}</integer>
    <key>RunAtLoad</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${path.join(os.homedir(), '.monitor-ia', 'agent.log')}</string>
    <key>StandardErrorPath</key>
    <string>${path.join(os.homedir(), '.monitor-ia', 'agent-error.log')}</string>
</dict>
</plist>`

  try {
    // Unload existing
    try { execSync(`launchctl unload ${PLIST_PATH}`, { stdio: 'ignore' }) } catch {}

    const dir = path.dirname(PLIST_PATH)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(PLIST_PATH, plist)
    execSync(`launchctl load ${PLIST_PATH}`)

    console.log('Servicio instalado correctamente (launchd)')
    console.log(`  Intervalo: cada ${intervalHours}h`)
    console.log(`  Log: ~/.monitor-ia/agent.log`)
    console.log('\nPara verificar: npx tsx src/index.ts service status')
    console.log('Para desinstalar: npx tsx src/index.ts service uninstall')
  } catch (err: any) {
    console.error('Error al configurar launchd:', err.message)
  }
}

function uninstallMac() {
  try {
    execSync(`launchctl unload ${PLIST_PATH}`, { stdio: 'ignore' })
  } catch {}
  if (fs.existsSync(PLIST_PATH)) {
    fs.unlinkSync(PLIST_PATH)
    console.log('Servicio launchd eliminado correctamente.')
  } else {
    console.log('No se encontró el servicio.')
  }
}

function statusMac() {
  try {
    const output = execSync('launchctl list', { encoding: 'utf-8' })
    if (output.includes('com.monitor-ia.agent')) {
      console.log(`Servicio: com.monitor-ia.agent (launchd)`)
      console.log('  Estado: activo')
      const logPath = path.join(os.homedir(), '.monitor-ia', 'agent.log')
      if (fs.existsSync(logPath)) {
        const lines = fs.readFileSync(logPath, 'utf-8').trim().split('\n')
        console.log(`  Última línea de log: ${lines[lines.length - 1]}`)
      }
    } else {
      console.log(`Servicio "com.monitor-ia.agent" no instalado.`)
    }
  } catch {
    console.log(`Servicio "com.monitor-ia.agent" no instalado.`)
  }
}
