import type { AgentStatus, ActivityItem } from '../ipc-types.js'

type ElectronAPI = {
  getStatus: () => Promise<AgentStatus>
  revealApiKey: () => Promise<string>
  uninstall: () => Promise<{ ok: boolean }>
  closeWindow: () => Promise<void>
  openDownloadPage: (version: string) => Promise<void>
}

declare const window: Window & { electronAPI: ElectronAPI }

// Radio r=15.91549 → circunferencia ≈ 100, por lo que stroke-dasharray="${pct} ${100-pct}" es directo
const DONUT_R = 15.91549

const TOOL_COLORS: Record<string, string> = {
  'claude-code': '#3b82f6',
  'cursor': '#8b5cf6',
  'vscode-copilot': '#06b6d4',
}
const TOOL_COLORS_BG: Record<string, string> = {
  'claude-code': '#eff6ff',
  'cursor': '#f5f3ff',
  'vscode-copilot': '#ecfeff',
}
const DEFAULT_COLOR = '#94a3b8'
const DEFAULT_COLOR_BG = '#f8fafc'

function buildMultiDonut(activities: ActivityItem[]): { svg: string; total: number } {
  const withData = activities.filter(a => a.sessions > 0)
  const total = withData.reduce((sum, a) => sum + a.sessions, 0)

  if (total === 0) {
    const svg = `<svg viewBox="0 0 36 36" xmlns="http://www.w3.org/2000/svg">
      <circle fill="none" stroke="#f1f5f9" stroke-width="3.5" cx="18" cy="18" r="${DONUT_R}"/>
    </svg>`
    return { svg, total: 0 }
  }

  let offset = 0
  const segments = withData.map((a) => {
    const pct = (a.sessions / total) * 100
    const dashOffset = 100 - offset
    const color = TOOL_COLORS[a.tool] ?? DEFAULT_COLOR
    offset += pct
    return `<circle fill="none" stroke="${color}" stroke-width="3.5" cx="18" cy="18" r="${DONUT_R}"
      stroke-dasharray="${pct.toFixed(4)} ${(100 - pct).toFixed(4)}"
      stroke-dashoffset="${dashOffset.toFixed(4)}"/>`
  }).join('\n      ')

  const svg = `<svg viewBox="0 0 36 36" xmlns="http://www.w3.org/2000/svg" style="transform:rotate(-90deg)">
      <circle fill="none" stroke="#f1f5f9" stroke-width="3.5" cx="18" cy="18" r="${DONUT_R}"/>
      ${segments}
    </svg>`

  return { svg, total }
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })
    + ' · '
    + d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function formatNextSend(iso: string | null): string {
  if (!iso) return '—'
  const diff = new Date(iso).getTime() - Date.now()
  if (diff <= 0) return 'Inminente'
  const h = Math.floor(diff / 3_600_000)
  const m = Math.floor((diff % 3_600_000) / 60_000)
  return h > 0 ? `~${h}h` : `~${m}m`
}

async function loadStatus() {
  const status = await window.electronAPI.getStatus()

  document.getElementById('version-label')!.textContent = `v${status.version}`

  if (status.latestVersion && status.latestVersion !== status.version) {
    pendingLatestVersion = status.latestVersion
    const banner = document.getElementById('update-banner')!
    banner.style.display = 'flex'
    document.getElementById('latest-version-text')!.textContent = `v${status.latestVersion}`
  }

  document.getElementById('apikey-display')!.textContent = status.apiKeyMasked

  if (status.lastSentAt) {
    document.getElementById('last-send-date')!.textContent = formatDate(status.lastSentAt)
    document.getElementById('last-send-meta')!.textContent =
      `${status.activities.length} herramienta${status.activities.length !== 1 ? 's' : ''} monitorizada${status.activities.length !== 1 ? 's' : ''}`
  }

  const { svg, total } = buildMultiDonut(status.activities)

  const chartWrap = document.getElementById('chart-wrap')!
  chartWrap.innerHTML = svg
  const totalEl = document.createElement('div')
  totalEl.className = 'chart-total'
  totalEl.innerHTML = total > 0
    ? `<span class="chart-total-num">${total}</span><span class="chart-total-sub">sesiones</span>`
    : `<span class="chart-total-empty">Sin datos</span>`
  chartWrap.appendChild(totalEl)

  const legend = document.getElementById('tool-legend')!
  legend.innerHTML = ''
  const withData = status.activities.filter(a => a.sessions > 0)
  const grandTotal = withData.reduce((s, a) => s + a.sessions, 0)
  for (const item of status.activities) {
    const color = TOOL_COLORS[item.tool] ?? DEFAULT_COLOR
    const colorBg = TOOL_COLORS_BG[item.tool] ?? DEFAULT_COLOR_BG
    const pct = grandTotal > 0 ? Math.round((item.sessions / grandTotal) * 100) : 0
    const sessionsLabel = item.sessions === 1 ? '1 sesión' : `${item.sessions} sesiones`
    const row = document.createElement('div')
    row.className = 'legend-row'
    row.innerHTML = `
      <span class="legend-dot" style="background:${color}"></span>
      <span class="legend-name">${item.label}</span>
      <span class="legend-pct" style="color:${color};background:${colorBg}">${item.sessions > 0 ? `${pct}%` : '—'}</span>
      <span class="legend-sessions">${item.sessions > 0 ? sessionsLabel : 'Sin datos'}</span>
    `
    legend.appendChild(row)
  }

  document.getElementById('next-send-label')!.textContent = formatNextSend(status.nextSendEstimate)
}

let keyRevealed = false
let pendingLatestVersion = ''

document.getElementById('btn-show-key')?.addEventListener('click', () => {
  void (async () => {
    const display = document.getElementById('apikey-display')!
    const btn = document.getElementById('btn-show-key')!
    if (!keyRevealed) {
      display.textContent = await window.electronAPI.revealApiKey()
      btn.textContent = 'Ocultar'
      keyRevealed = true
    }
    else {
      const status = await window.electronAPI.getStatus()
      display.textContent = status.apiKeyMasked
      btn.textContent = 'Mostrar'
      keyRevealed = false
    }
  })()
})

document.getElementById('btn-update')?.addEventListener('click', () => {
  void window.electronAPI.openDownloadPage(pendingLatestVersion)
})

document.getElementById('btn-uninstall')?.addEventListener('click', () => {
  void (async () => {
    const ok = confirm(
      '¿Estás seguro de que quieres desinstalar el agente?\nSe eliminará el servicio del sistema y la configuración.',
    )
    if (ok) await window.electronAPI.uninstall()
  })()
})

document.getElementById('btn-close')?.addEventListener('click', () => {
  void window.electronAPI.closeWindow()
})

window.addEventListener('DOMContentLoaded', () => { void loadStatus() })
