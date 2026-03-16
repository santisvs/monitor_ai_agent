import type { AgentStatus } from '../ipc-types.js'

type ElectronAPI = {
  getStatus: () => Promise<AgentStatus>
  revealApiKey: () => Promise<string>
  uninstall: () => Promise<{ ok: boolean }>
  closeWindow: () => Promise<void>
  openDownloadPage: (version: string) => Promise<void>
}

declare const window: Window & { electronAPI: ElectronAPI }

const LEVEL_LABELS: Record<string, string> = {
  high: 'Alta',
  normal: 'Normal',
  low: 'Poca',
  none: 'Sin datos',
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
      `${status.activities.length} herramientas monitorizadas`
  }

  const activityList = document.getElementById('activity-list')!
  activityList.innerHTML = ''
  for (const item of status.activities) {
    const barWidth = item.level === 'none' ? 100 : item.percentage
    const div = document.createElement('div')
    div.className = 'activity-item'
    div.innerHTML = `
      <span class="activity-name">${item.label}</span>
      <div class="bar-track">
        <div class="bar-fill ${item.level}" style="width:${barWidth}%"></div>
      </div>
      <span class="activity-badge ${item.level}">${LEVEL_LABELS[item.level] ?? item.level}</span>
    `
    activityList.appendChild(div)
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
    } else {
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
      '¿Estás seguro de que quieres desinstalar el agente?\nSe eliminará el servicio del sistema y la configuración.'
    )
    if (ok) await window.electronAPI.uninstall()
  })()
})

document.getElementById('btn-close')?.addEventListener('click', () => {
  void window.electronAPI.closeWindow()
})

window.addEventListener('DOMContentLoaded', () => { void loadStatus() })
