import { app, BrowserWindow, Tray, Menu, ipcMain, shell, nativeImage } from 'electron'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { loadBrandConfig } from './brand'
import { loadConfig, saveConfig, configExists, updateSendHistory } from '../core/config'
import { sendMetrics } from '../core/sender'
import { serviceInstall, serviceUninstall } from '../core/service'
import { SyncStateManager, DEFAULT_SYNC_STATE_PATH } from '../core/sync-state'
import { calculateActivityLevel } from './activity'
import type { AgentStatus, ActivityItem, InstallerSetup } from './ipc-types'

const CONFIG_PATH = path.join(os.homedir(), '.monitor-ia', 'config.json')

let tray: Tray | null = null
let installerWindow: BrowserWindow | null = null
let mainWindow: BrowserWindow | null = null

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function getIconPath(): string {
  const brand = process.env.BUILD_BRAND ?? 'jakite'
  // In production, extraResources land at process.resourcesPath/icons/
  const prodIcon = path.join(process.resourcesPath ?? '', 'icons', 'icon.png')
  if (fs.existsSync(prodIcon)) return prodIcon

  // In development, icons live in brands/<brand>/icons/ (3 levels up from dist/electron/electron/)
  const devIcon = path.join(__dirname, '..', '..', '..', 'brands', brand, 'icons', 'icon.png')
  if (fs.existsSync(devIcon)) return devIcon

  // Absolute fallback: same directory as this file (shouldn't happen)
  return path.join(__dirname, 'icon.png')
}

function maskToken(token: string): string {
  if (!token || token.length < 8) return '****'
  return token.slice(0, 4) + '****' + token.slice(-4)
}

async function tryCollectIfStale(): Promise<void> {
  try {
    const config = loadConfig()
    if (config.lastSentAt) {
      const hoursSinceLast = (Date.now() - new Date(config.lastSentAt).getTime()) / 3600000
      const intervalHours = config.syncIntervalHours ?? 15
      if (hoursSinceLast < intervalHours) return
    }
    const { collectAll } = await import('../core/collector-runner')
    const results = await collectAll(config)
    const agentVersion = app.getVersion()
    if (results.length > 0) {
      const sent = await sendMetrics(config.serverUrl, config.authToken, results, agentVersion, new SyncStateManager(DEFAULT_SYNC_STATE_PATH))
      if (sent) {
        const sessions: Record<string, number> = {}
          const sessionsWeek: Record<string, number> = {}
          const sessionsSinceSync: Record<string, number> = {}
        for (const r of results) {
            const metrics = r.metrics as Record<string, unknown>
            sessions[r.tool] = (metrics.sessionsCount as number) ?? 0
            sessionsWeek[r.tool] = (metrics.sessionFrequency as number) ?? 0
            sessionsSinceSync[r.tool] = (metrics.sessionsSinceLastSync as number) ?? 0
        }
        config.lastSentAt = new Date().toISOString()
          config.sendHistory = updateSendHistory(config.sendHistory ?? [], config.lastSentAt, sessions, sessionsWeek, sessionsSinceSync)
        saveConfig(config)
      }
    }
  } catch { /* background collection errors are non-fatal */ }
}


// ─────────────────────────────────────────────────────────────────────────────
// Window factories
// ─────────────────────────────────────────────────────────────────────────────

function createInstallerWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 560,
    height: 540,
    resizable: false,
    show: false,
    icon: getIconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  const htmlPath = path.join(__dirname, '..', 'installer', 'installer.html')
  win.loadFile(htmlPath)

  win.once('ready-to-show', () => win.show())
  return win
}

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 400,
    height: 580,
    resizable: false,
    show: false,
    icon: getIconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  const htmlPath = path.join(__dirname, '..', 'app', 'app.html')
  win.loadFile(htmlPath)

  win.once('ready-to-show', () => win.show())

  // Hide on close instead of quitting
  win.on('close', (e) => {
    e.preventDefault()
    win.hide()
  })

  return win
}

// ─────────────────────────────────────────────────────────────────────────────
// Tray
// ─────────────────────────────────────────────────────────────────────────────

function createTray(brand: { productName: string }): Tray {
  const iconPath = getIconPath()
  const icon = nativeImage.createFromPath(iconPath)
  const t = new Tray(icon.resize({ width: 16, height: 16 }))

  t.setToolTip(brand.productName)

  // Left-click: show/hide main window
  t.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide()
      } else {
        mainWindow.show()
        mainWindow.focus()
      }
    }
  })

  const contextMenu = Menu.buildFromTemplate([
    {
      label: `Abrir ${brand.productName}`,
      click: () => {
        if (mainWindow) {
          mainWindow.show()
          mainWindow.focus()
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Cerrar aplicación',
      click: () => {
        // Remove close handler so the window actually closes
        if (mainWindow) {
          mainWindow.removeAllListeners('close')
          mainWindow.close()
        }
        app.quit()
      },
    },
  ])

  t.setContextMenu(contextMenu)
  return t
}

// ─────────────────────────────────────────────────────────────────────────────
// IPC handlers
// ─────────────────────────────────────────────────────────────────────────────

function isTrustedUrl(url: string, brand: ReturnType<typeof loadBrandConfig>): boolean {
  try {
    const parsed = new URL(url)
    const brandUrl = new URL(brand.serverUrl)
    return parsed.protocol === 'https:' && parsed.origin === brandUrl.origin
  } catch {
    return false
  }
}

function getEstimatedSessionsSinceSync(
  history: Array<{ sessions: Record<string, number>; sessionsSinceSync?: Record<string, number> }>,
  tool: string,
): number {
  const lastEntry = history[history.length - 1]
  if (!lastEntry) return 0
  const explicit = lastEntry.sessionsSinceSync?.[tool]
  if (typeof explicit === 'number') return explicit

  const lastTotal = lastEntry.sessions[tool] ?? 0
  if (history.length < 2) return lastTotal

  const prevTotal = history[history.length - 2]?.sessions[tool] ?? 0
  return Math.max(0, lastTotal - prevTotal)
}

function countClaudeCodeSessionsSince(since: Date | null): number {
  if (!since) return 0
  const projectsDir = path.join(os.homedir(), '.claude', 'projects')
  if (!fs.existsSync(projectsDir)) return 0
  let count = 0
  try {
    for (const project of fs.readdirSync(projectsDir)) {
      const projectPath = path.join(projectsDir, project)
      try {
        if (!fs.statSync(projectPath).isDirectory()) continue
        for (const file of fs.readdirSync(projectPath)) {
          if (!file.endsWith('.jsonl')) continue
          const mtime = fs.statSync(path.join(projectPath, file)).mtimeMs
          if (mtime > since.getTime()) count++
        }
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
  return count
}

function countCursorSessionsSince(since: Date | null): number {
  if (!since) return 0
  const appData = process.platform === 'darwin'
    ? path.join(os.homedir(), 'Library', 'Application Support')
    : process.platform === 'linux'
      ? path.join(os.homedir(), '.config')
      : path.join(os.homedir(), 'AppData', 'Roaming')
  const wsDir = path.join(appData, 'Cursor', 'User', 'workspaceStorage')
  if (!fs.existsSync(wsDir)) return 0
  let count = 0
  try {
    for (const entry of fs.readdirSync(wsDir)) {
      const dbPath = path.join(wsDir, entry, 'state.vscdb')
      if (!fs.existsSync(dbPath)) continue
      const mtime = fs.statSync(dbPath).mtimeMs
      if (mtime > since.getTime()) count++
    }
  } catch { /* skip */ }
  return count
}

function getEstimatedSessionsWeek(
  history: Array<{ sentAt?: string; sessions: Record<string, number>; sessionsWeek?: Record<string, number> }>,
  tool: string,
): number {
  const lastEntry = history[history.length - 1]
  if (!lastEntry) return 0
  const explicit = lastEntry.sessionsWeek?.[tool]
  if (typeof explicit === 'number') return explicit

  if (history.length < 2) return lastEntry.sessions[tool] ?? 0

  const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
  let weeklySum = 0

  for (let i = 1; i < history.length; i++) {
    const current = history[i]
    const previous = history[i - 1]
    const sentAtMs = current.sentAt ? new Date(current.sentAt).getTime() : NaN
    if (!Number.isNaN(sentAtMs) && sentAtMs >= oneWeekAgo) {
      const curr = current.sessions[tool] ?? 0
      const prev = previous.sessions[tool] ?? 0
      weeklySum += Math.max(0, curr - prev)
    }
  }

  if (weeklySum > 0) return weeklySum
  return getEstimatedSessionsSinceSync(history, tool)
}

function registerIpcHandlers(brand: ReturnType<typeof loadBrandConfig>): void {
  // ── Installer ──────────────────────────────────────────────────────────────

  ipcMain.handle('installer:get-setup', async (): Promise<InstallerSetup | null> => {
    // Look for agent-setup.json written by the one-click installer script (~/.monitor-ia/),
    // in resourcesPath (production bundle), or in resources/ dir (dev)
    const candidates = [
      path.join(os.homedir(), '.monitor-ia', 'agent-setup.json'),
      path.join(process.resourcesPath ?? '', 'agent-setup.json'),
      path.join(__dirname, '..', '..', '..', 'resources', 'agent-setup.json'),
    ]
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        try {
          return JSON.parse(fs.readFileSync(p, 'utf-8')) as InstallerSetup
        } catch {
          return null
        }
      }
    }
    return null
  })

  ipcMain.handle(
    'installer:validate-token',
    async (_event, token: string, serverUrl: string): Promise<{ ok: boolean; latestVersion?: string }> => {
      if (!isTrustedUrl(serverUrl, brand)) return { ok: false }
      try {
        const response = await fetch(`${serverUrl}/api/agent/heartbeat`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!response.ok) return { ok: false }
        const data = await response.json() as { latestVersion?: string }
        return { ok: true, latestVersion: data.latestVersion }
      } catch {
        return { ok: false }
      }
    },
  )

  ipcMain.handle(
    'installer:save-config',
    async (_event, token: string, serverUrl: string): Promise<{ ok: boolean }> => {
      if (!token || typeof token !== 'string' || token.length > 512) return { ok: false }
      try { const u = new URL(serverUrl); if (u.protocol !== 'https:') return { ok: false } } catch { return { ok: false } }
      const config = {
        serverUrl,
        authToken: token,
        consentGivenAt: new Date().toISOString(),
        syncIntervalHours: 15,
        enabledCollectors: [] as string[],
        sendHistory: [] as never[],
      }
      saveConfig(config)
      return { ok: true }
    },
  )

  ipcMain.handle('installer:install-service', async (): Promise<{ ok: boolean; error?: string }> => {
    try {
      // Registro en inicio de sesión de Windows/macOS via Electron (entrada en registro/launchd)
      app.setLoginItemSettings({ openAtLogin: true })
      // Tarea programada periódica para colección de métricas en background
      serviceInstall()
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  ipcMain.handle(
    'installer:register-setup',
    async (
      _event,
      collectors: string[],
    ): Promise<{ ok: boolean; error?: string }> => {
      try {
        const config = loadConfig()
        if (!isTrustedUrl(config.serverUrl, brand)) return { ok: false, error: 'Untrusted server URL' }
        const platform = os.platform()
        const agentVersion = app.getVersion()

        const response = await fetch(`${config.serverUrl}/api/agent/setup`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${config.authToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ collectors, platform, agentVersion }),
        })

        if (!response.ok) return { ok: false }

        const data = await response.json() as Record<string, unknown>
        // Use explicit allowlist when merging server response into config
        if (data.ok) {
          config.enabledCollectors = collectors
          if (typeof data.syncIntervalHours === 'number') config.syncIntervalHours = data.syncIntervalHours
          if (typeof data.encryptionKey === 'string') config.encryptionKey = data.encryptionKey
          await saveConfig(config)
        }
        return { ok: true }
      } catch {
        return { ok: false }
      }
    },
  )

  ipcMain.handle('installer:run-first-collection', async (): Promise<{ ok: boolean }> => {
    try {
      const config = loadConfig()
      // Dynamic import so cursor (sql.js/WASM) is optional at build time
      const { collectAll } = await import('../core/collector-runner')
      const results = await collectAll(config)
      const agentVersion = app.getVersion()

      if (results.length > 0) {
        const sent = await sendMetrics(config.serverUrl, config.authToken, results, agentVersion, new SyncStateManager(DEFAULT_SYNC_STATE_PATH))
        if (sent) {
          const sessions: Record<string, number> = {}
          const sessionsWeek: Record<string, number> = {}
          const sessionsSinceSync: Record<string, number> = {}
          for (const r of results) {
            const metrics = r.metrics as Record<string, unknown>
            sessions[r.tool] = (metrics.sessionsCount as number) ?? 0
            sessionsWeek[r.tool] = (metrics.sessionFrequency as number) ?? 0
            sessionsSinceSync[r.tool] = (metrics.sessionsSinceLastSync as number) ?? 0
          }
          config.lastSentAt = new Date().toISOString()
          config.sendHistory = updateSendHistory(config.sendHistory ?? [], config.lastSentAt, sessions, sessionsWeek, sessionsSinceSync)
          saveConfig(config)
        }
      }

      return { ok: true }
    } catch {
      return { ok: false }
    }
  })

  ipcMain.handle('installer:create-shortcut', async (): Promise<{ ok: boolean }> => {
    if (process.platform !== 'win32') return { ok: false }
    try {
      const desktopPath = app.getPath('desktop')
      const shortcutPath = path.join(desktopPath, `${brand.productName}.lnk`)
      const result = shell.writeShortcutLink(shortcutPath, {
        target: process.execPath,
        description: brand.productName,
      })
      return { ok: result }
    } catch {
      return { ok: false }
    }
  })

  ipcMain.handle('installer:cancel', async (): Promise<void> => {
    // Undo any partial setup: disable autostart and remove config dir
    try { app.setLoginItemSettings({ openAtLogin: false }) } catch { /* ignore */ }
    try { serviceUninstall() } catch { /* ignore */ }
    const monitorDir = path.join(os.homedir(), '.monitor-ia')
    try { fs.rmSync(monitorDir, { recursive: true, force: true }) } catch { /* ignore */ }
    app.quit()
  })

  ipcMain.handle('installer:finish', async (): Promise<void> => {
    if (installerWindow) {
      installerWindow.destroy()
      installerWindow = null
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.destroy()
      mainWindow = null
    }
    mainWindow = createMainWindow()
    mainWindow.show()
  })

  ipcMain.handle('installer:get-server-url', (): string => brand.serverUrl)

  // ── App ────────────────────────────────────────────────────────────────────

  ipcMain.handle('app:get-version', (): string => app.getVersion())

  ipcMain.handle('app:get-status', async (): Promise<AgentStatus> => {
    let version = app.getVersion()
    let latestVersion: string | null = null
    let apiKeyMasked = '****'
    let lastSentAt: string | null = null
    let nextSendEstimate: string | null = null
    const activities: ActivityItem[] = []

    if (configExists()) {
      try {
        const config = loadConfig()
        latestVersion = config.latestAgentVersion ?? null
        apiKeyMasked = maskToken(config.authToken)
        lastSentAt = config.lastSentAt ?? null

        if (lastSentAt) {
          const nextMs = new Date(lastSentAt).getTime() + config.syncIntervalHours * 3600 * 1000
          nextSendEstimate = new Date(nextMs).toISOString()
        }

        // Build activities from sendHistory
        const history = config.sendHistory ?? []
        const allTools = config.enabledCollectors ?? []
        const toolLabels: Record<string, string> = {
          'claude-code': 'Claude Code',
          'cursor': 'Cursor',
          'vscode-copilot': 'VS Code Copilot',
        }

        const syncState = new SyncStateManager(DEFAULT_SYNC_STATE_PATH)

        for (const tool of allTools) {
          const lastEntry = history[history.length - 1]
          const currentSessions = lastEntry?.sessions[tool] ?? 0
          const currentSessionsWeek = getEstimatedSessionsWeek(history, tool)

          // Real-time count since last sync using filesystem
          const lastSyncedAt = syncState.getLastSyncedAt(tool)
          let currentSessionsSinceSync: number
          if (tool === 'claude-code') {
            currentSessionsSinceSync = lastSyncedAt !== null
              ? countClaudeCodeSessionsSince(lastSyncedAt)
              : getEstimatedSessionsSinceSync(history, tool)
          } else if (tool === 'cursor') {
            currentSessionsSinceSync = lastSyncedAt !== null
              ? countCursorSessionsSince(lastSyncedAt)
              : getEstimatedSessionsSinceSync(history, tool)
          } else {
            currentSessionsSinceSync = getEstimatedSessionsSinceSync(history, tool)
          }

          const { level, percentage } = calculateActivityLevel(currentSessions, history, tool)
          activities.push({
            tool,
            label: toolLabels[tool] ?? tool,
            level,
            percentage,
            sessions: currentSessions,
            sessionsWeek: currentSessionsWeek,
            sessionsSinceSync: currentSessionsSinceSync,
          })
        }
      } catch {
        // Config unreadable — return defaults
      }
    }

    return {
      version,
      latestVersion,
      apiKeyMasked,
      lastSentAt,
      nextSendEstimate,
      activities,
    }
  })

  ipcMain.handle('app:reveal-apikey', (): string | null => {
    try {
      return loadConfig().authToken
    } catch {
      return null
    }
  })

  ipcMain.handle('app:uninstall', async (): Promise<void> => {
    // Eliminar tareas de Task Scheduler
    try { serviceUninstall() } catch { /* ignore */ }
    // Eliminar entrada de inicio de sesión en registro de Windows / launchd macOS
    try { app.setLoginItemSettings({ openAtLogin: false }) } catch { /* ignore */ }
    // Eliminar directorio completo de datos del agente (~/.monitor-ia/)
    const monitorDir = path.join(os.homedir(), '.monitor-ia')
    try { fs.rmSync(monitorDir, { recursive: true, force: true }) } catch { /* ignore */ }
    app.quit()
  })

  ipcMain.handle('app:close-window', (): void => {
    mainWindow?.hide()
  })

  ipcMain.handle('app:open-download', async (_event, version: string): Promise<void> => {
    const platform = process.platform
    const asset = platform === 'win32' ? 'jakite-agent-win.exe'
      : platform === 'darwin' ? 'jakite-agent-mac.dmg'
      : 'jakite-agent-linux.AppImage'
    const tag = version.startsWith('v') ? version : `v${version}`
    await shell.openExternal(`https://github.com/santisvs/monitor_ai_agent/releases/download/${tag}/${asset}`)
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// App lifecycle
// ─────────────────────────────────────────────────────────────────────────────

app.on('before-quit', () => {
  tray?.destroy()
  tray = null
})

app.whenReady().then(async () => {
  // Remove the default application menu (File, Edit, View, Window, Help)
  Menu.setApplicationMenu(null)

  // Modo headless: colección periódica lanzada por Task Scheduler
  if (process.argv.includes('run-once') || process.argv.includes('--run-once')) {
    try {
      const config = loadConfig()

      // Guard: mínimo 15h entre envíos para evitar dobles envíos por reinicios rápidos
      if (config.lastSentAt) {
        const hoursSinceLast = (Date.now() - new Date(config.lastSentAt).getTime()) / 3600000
        if (hoursSinceLast < 15) {
          app.quit()
          return
        }
      }

      const { collectAll } = await import('../core/collector-runner')
      const results = await collectAll(config)
      const agentVersion = app.getVersion()

      if (results.length > 0) {
        const sent = await sendMetrics(config.serverUrl, config.authToken, results, agentVersion, new SyncStateManager(DEFAULT_SYNC_STATE_PATH))
        if (sent) {
          const sessions: Record<string, number> = {}
          const sessionsWeek: Record<string, number> = {}
          const sessionsSinceSync: Record<string, number> = {}
          for (const r of results) {
            const metrics = r.metrics as Record<string, unknown>
            sessions[r.tool] = (metrics.sessionsCount as number) ?? 0
            sessionsWeek[r.tool] = (metrics.sessionFrequency as number) ?? 0
            sessionsSinceSync[r.tool] = (metrics.sessionsSinceLastSync as number) ?? 0
          }
          config.lastSentAt = new Date().toISOString()
          config.sendHistory = updateSendHistory(config.sendHistory ?? [], config.lastSentAt, sessions, sessionsWeek, sessionsSinceSync)
          saveConfig(config)
        }
      }

      // Heartbeat: update latestAgentVersion so the app can show the update banner
      try {
        const hbRes = await fetch(`${config.serverUrl}/api/agent/heartbeat`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${config.authToken}`, 'Content-Type': 'application/json' },
          body: '{}',
        })
        if (hbRes.ok) {
          const hbData = await hbRes.json() as { latestVersion?: string }
          if (hbData.latestVersion && hbData.latestVersion !== config.latestAgentVersion) {
            config.latestAgentVersion = hbData.latestVersion
            saveConfig(config)
          }
        }
      } catch { /* heartbeat is best-effort */ }
    } catch { /* ignore errors in background collection */ }
    app.quit()
    return
  }

  const brand = loadBrandConfig()

  registerIpcHandlers(brand)
  tray = createTray(brand)

  if (!configExists()) {
    installerWindow = createInstallerWindow()
  } else {
    mainWindow = createMainWindow()
    // Collect on startup and then check every hour — no system permissions required
    void tryCollectIfStale()
    setInterval(() => { void tryCollectIfStale() }, 60 * 60 * 1000)
  }
})

// Prevent quitting when all windows are closed
app.on('window-all-closed', () => {
  // Intentionally do nothing — tray keeps the app alive
})
