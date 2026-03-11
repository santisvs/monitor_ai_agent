import { execSync } from 'child_process'
import os from 'os'
import path from 'path'
import fs from 'fs'
import { loadConfig } from './config.js'

const TASK_NAME = 'MonitorIA-Agent'
const AGENT_DIR = path.join(os.homedir(), '.monitor-ia', 'agent')
const platform = os.platform()

// Detecta si estamos corriendo como ejecutable empaquetado con pkg
const isPackaged = !!(process as unknown as { pkg?: unknown }).pkg

function getNodePath(): string {
  try {
    const nodePath = execSync(platform === 'win32' ? 'where node' : 'which node', { encoding: 'utf-8' }).trim().split('\n')[0]
    return nodePath.trim()
  } catch {
    return 'node'
  }
}

function getExecutablePath(): { exePath: string; needsNode: boolean } {
  if (isPackaged) {
    // Estamos corriendo como ejecutable empaquetado
    return { exePath: process.execPath, needsNode: false }
  }
  // Estamos corriendo con node
  const scriptPath = path.join(AGENT_DIR, 'dist', 'index.js')
  return { exePath: scriptPath, needsNode: true }
}

export function serviceInstall(): void {
  const config = loadConfig()
  const intervalHours = config.syncIntervalHours || 6
  const { exePath, needsNode } = getExecutablePath()
  const nodePath = needsNode ? getNodePath() : ''

  if (needsNode && !fs.existsSync(exePath)) {
    console.error(`Error: No se encuentra ${exePath}`)
    console.error('Ejecuta "npm run build" primero.')
    process.exit(1)
  }

  if (platform === 'win32') {
    installWindows(nodePath, exePath, intervalHours)
  } else if (platform === 'darwin') {
    installMac(nodePath, exePath, intervalHours)
  } else {
    installLinux(nodePath, exePath, intervalHours)
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
  // Eliminar tareas existentes (periodic y startup)
  try { execSync(`schtasks /Delete /TN "${TASK_NAME}-periodic" /F`, { stdio: 'ignore' }) } catch {}
  try { execSync(`schtasks /Delete /TN "${TASK_NAME}-startup" /F`, { stdio: 'ignore' }) } catch {}
  // Compatibilidad con instalaciones anteriores que usaban el nombre sin sufijo
  try { execSync(`schtasks /Delete /TN "${TASK_NAME}" /F`, { stdio: 'ignore' }) } catch {}

  const intervalMinutes = intervalHours * 60
  // Si nodePath está vacío, scriptPath es un ejecutable standalone
  const taskCommand = nodePath
    ? `\\"${nodePath}\\" \\"${scriptPath}\\" run-once`
    : `\\"${scriptPath}\\" run-once`

  // Tarea periódica (cada N horas)
  const cmdPeriodic = `schtasks /Create /TN "${TASK_NAME}-periodic" /TR "${taskCommand}" /SC MINUTE /MO ${intervalMinutes} /F`
  // Tarea de startup (al iniciar sesión)
  const cmdStartup = `schtasks /Create /TN "${TASK_NAME}-startup" /TR "${taskCommand}" /SC ONLOGON /F`

  try {
    execSync(cmdPeriodic, { stdio: 'ignore' })
    execSync(cmdStartup, { stdio: 'ignore' })
    console.log('Servicio instalado correctamente (Task Scheduler)')
    console.log(`  Tarea periódica: ${TASK_NAME}-periodic (cada ${intervalHours}h)`)
    console.log(`  Tarea de inicio: ${TASK_NAME}-startup (al iniciar sesión)`)
    console.log(`  Comando: ${nodePath ? 'node ' + scriptPath : scriptPath} run-once`)
    console.log('\nPara verificar: monitor-ia-agent service status')
    console.log('Para desinstalar: monitor-ia-agent service uninstall')
  } catch (err: any) {
    console.error('Error al crear la tarea programada.')
    console.error('Puede que necesites ejecutar como administrador.')
    console.error(err.message)
  }
}

function uninstallWindows() {
  let found = false
  for (const suffix of ['-periodic', '-startup', '']) {
    try {
      execSync(`schtasks /Delete /TN "${TASK_NAME}${suffix}" /F`, { stdio: 'ignore' })
      console.log(`Tarea "${TASK_NAME}${suffix}" eliminada correctamente.`)
      found = true
    } catch {}
  }
  if (!found) {
    console.log(`No se encontraron tareas de "${TASK_NAME}".`)
  }
}

function statusWindows() {
  let anyFound = false
  for (const suffix of ['-periodic', '-startup']) {
    try {
      const output = execSync(`schtasks /Query /TN "${TASK_NAME}${suffix}" /FO LIST /V`, { encoding: 'utf-8' })
      const statusMatch = output.match(/Status:\s*(.+)/i) || output.match(/Estado:\s*(.+)/i)
      const lastRunMatch = output.match(/Last Run Time:\s*(.+)/i) || output.match(/Última vez que se ejecutó:\s*(.+)/i)
      const nextRunMatch = output.match(/Next Run Time:\s*(.+)/i) || output.match(/Próxima ejecución:\s*(.+)/i)

      console.log(`Tarea: ${TASK_NAME}${suffix}`)
      console.log(`  Estado: ${statusMatch ? statusMatch[1].trim() : 'desconocido'}`)
      console.log(`  Última ejecución: ${lastRunMatch ? lastRunMatch[1].trim() : 'nunca'}`)
      if (suffix === '-periodic') {
        console.log(`  Próxima ejecución: ${nextRunMatch ? nextRunMatch[1].trim() : 'desconocida'}`)
      }
      anyFound = true
    } catch {}
  }
  if (!anyFound) {
    console.log(`Servicio "${TASK_NAME}" no instalado.`)
    console.log('Instálalo con: monitor-ia-agent service install')
  }
}

// === LINUX ===

function installLinux(nodePath: string, scriptPath: string, intervalHours: number) {
  const execCommand = nodePath ? `${nodePath} ${scriptPath}` : scriptPath
  const logPath = path.join(os.homedir(), '.monitor-ia', 'agent.log')
  const cronLine = `0 */${intervalHours} * * * ${execCommand} run-once >> ${logPath} 2>&1`
  const rebootLine = `@reboot ${execCommand} run-once >> ${logPath} 2>&1 # ${TASK_NAME}-startup`

  try {
    // Remove existing entries
    let existing = ''
    try {
      existing = execSync('crontab -l 2>/dev/null', { encoding: 'utf-8' })
    } catch {}
    const filtered = existing.split('\n').filter(l => !l.includes(TASK_NAME) && !l.includes('monitor-ia')).join('\n')
    const newCrontab = (filtered.trim() ? filtered.trim() + '\n' : '')
      + `# ${TASK_NAME}\n${cronLine}\n${rebootLine}\n`

    execSync(`echo "${newCrontab}" | crontab -`, { encoding: 'utf-8' })
    console.log('Servicio instalado correctamente (cron)')
    console.log(`  Intervalo periódico: cada ${intervalHours}h`)
    console.log(`  Inicio de sesión: @reboot`)
    console.log(`  Log: ~/.monitor-ia/agent.log`)
    console.log('\nPara verificar: crontab -l')
    console.log('Para desinstalar: monitor-ia-agent service uninstall')
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

function installMac(nodePath: string, exePath: string, intervalHours: number) {
  // Build ProgramArguments based on whether we need node or not
  const programArgs = nodePath
    ? `        <string>${nodePath}</string>
        <string>${exePath}</string>
        <string>run-once</string>`
    : `        <string>${exePath}</string>
        <string>run-once</string>`

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.monitor-ia.agent</string>
    <key>ProgramArguments</key>
    <array>
${programArgs}
    </array>
    <key>WorkingDirectory</key>
    <string>${path.join(os.homedir(), '.monitor-ia')}</string>
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

  const uid = os.userInfo().uid
  try {
    // Bootout existing (replaces deprecated launchctl unload, removed in macOS 14+)
    try { execSync(`launchctl bootout gui/${uid}/com.monitor-ia.agent`, { stdio: 'ignore' }) } catch {}

    const dir = path.dirname(PLIST_PATH)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(PLIST_PATH, plist)
    execSync(`launchctl bootstrap gui/${uid} ${PLIST_PATH}`)

    console.log('Servicio instalado correctamente (launchd)')
    console.log(`  Intervalo: cada ${intervalHours}h`)
    console.log(`  Log: ~/.monitor-ia/agent.log`)
    console.log('\nPara verificar: monitor-ia-agent service status')
    console.log('Para desinstalar: monitor-ia-agent service uninstall')
  } catch (err: any) {
    console.error('Error al configurar launchd:', err.message)
  }
}

function uninstallMac() {
  const uid = os.userInfo().uid
  try {
    execSync(`launchctl bootout gui/${uid}/com.monitor-ia.agent`, { stdio: 'ignore' })
  } catch {}
  if (fs.existsSync(PLIST_PATH)) {
    fs.unlinkSync(PLIST_PATH)
    console.log('Servicio launchd eliminado correctamente.')
  } else {
    console.log('No se encontró el servicio.')
  }
}

function statusMac() {
  const uid = os.userInfo().uid
  try {
    const output = execSync(`launchctl print gui/${uid}/com.monitor-ia.agent`, { encoding: 'utf-8' })
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
