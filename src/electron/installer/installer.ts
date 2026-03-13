type ElectronAPI = {
  getInstallerSetup: () => Promise<{ token: string; serverUrl: string } | null>
  getServerUrl: () => Promise<string>
  validateToken: (token: string, serverUrl: string) => Promise<{ ok: boolean; latestVersion: string | null }>
  saveConfig: (token: string, serverUrl: string) => Promise<{ ok: boolean }>
  installService: () => Promise<{ ok: boolean; error?: string }>
  registerSetup: (collectors: string[]) => Promise<{ ok: boolean; error?: string }>
  runFirstCollection: () => Promise<{ ok: boolean }>
  createShortcut: () => Promise<{ ok: boolean }>
  finishInstall: () => Promise<void>
  cancelInstall: () => Promise<void>
  getAppVersion: () => Promise<string>
}

interface Window { electronAPI: ElectronAPI }

const SCREENS = ['welcome', 'privacy', 'tech', 'apikey', 'installing', 'done'] as const
type ScreenId = typeof SCREENS[number]

let currentScreen: ScreenId = 'welcome'
let setup: { token: string; serverUrl: string } | null = null
let selectedCollectors: string[] = []

function showScreen(name: ScreenId) {
  document.querySelectorAll<HTMLElement>('.screen').forEach(s => s.classList.remove('active'))
  document.getElementById(`screen-${name}`)?.classList.add('active')
  currentScreen = name

  const btnNext = document.getElementById('btn-next') as HTMLButtonElement
  const btnBack = document.getElementById('btn-back') as HTMLButtonElement

  const hideBack = name === 'welcome' || name === 'installing' || name === 'done'
  const hideNext = name === 'installing'
  const hideCancel = name === 'done'

  btnBack.style.display = hideBack ? 'none' : 'inline-block'
  btnNext.style.display = hideNext ? 'none' : 'inline-block'
  btnNext.textContent = name === 'done' ? 'Finalizar' : 'Siguiente'
  const btnCancel = document.getElementById('btn-cancel') as HTMLButtonElement
  if (btnCancel) btnCancel.style.display = hideCancel ? 'none' : 'inline-block'

  if (name === 'privacy') {
    const consent = document.getElementById('consent-check') as HTMLInputElement
    btnNext.disabled = !consent.checked
  } else if (name === 'tech') {
    updateTechNextButton()
  } else if (name === 'apikey') {
    const errorEl = document.getElementById('apikey-error')
    const validatingEl = document.getElementById('apikey-validating') as HTMLDivElement
    if (errorEl) errorEl.textContent = ''
    if (validatingEl) validatingEl.style.display = 'none'
    updateApikeyNextButton()
  } else {
    btnNext.disabled = false
  }
}

function setStep(step: string, status: 'pending' | 'running' | 'done' | 'error', errorMsg?: string) {
  const icon = document.getElementById(`icon-${step}`)
  const error = document.getElementById(`error-${step}`)
  if (!icon) return
  icon.className = `step-icon ${status}`
  const stepNum = icon.textContent?.match(/\d/)?.[0] ?? ''
  icon.textContent = status === 'done' ? '✓' : status === 'error' ? '✗' : status === 'running' ? '⟳' : stepNum
  if (error) error.textContent = errorMsg ?? ''
}

async function runInstallation() {
  showScreen('installing')
  if (!setup) return

  setStep('validate', 'running')
  const validation = await window.electronAPI.validateToken(setup.token, setup.serverUrl)
  if (!validation.ok) {
    setStep('validate', 'error', 'Token inválido o servidor no disponible')
    showRetry()
    return
  }
  setStep('validate', 'done')

  setStep('config', 'running')
  const saved = await window.electronAPI.saveConfig(setup.token, setup.serverUrl)
  if (!saved.ok) {
    setStep('config', 'error', 'No se pudo guardar la configuración')
    showRetry()
    return
  }
  setStep('config', 'done')

  setStep('service', 'running')
  const service = await window.electronAPI.installService()
  if (!service.ok) {
    setStep('service', 'error', service.error ?? 'Error al instalar el servicio')
    // Non-fatal: continue
  } else {
    setStep('service', 'done')
  }

  setStep('register', 'running')
  const registered = await window.electronAPI.registerSetup(selectedCollectors)
  if (!registered.ok) {
    setStep('register', 'error', registered.error ?? 'Error al registrar tecnologías')
  } else {
    setStep('register', 'done')
  }

  setStep('collect', 'running')
  const collected = await window.electronAPI.runFirstCollection()
  if (!collected.ok) {
    setStep('collect', 'error', 'La captura inicial no pudo completarse (se reintentará automáticamente)')
  } else {
    setStep('collect', 'done')
  }

  showScreen('done')
  const btnNext = document.getElementById('btn-next') as HTMLButtonElement
  btnNext.style.display = 'inline-block'
}

function showRetry() {
  const btnNext = document.getElementById('btn-next') as HTMLButtonElement
  btnNext.style.display = 'inline-block'
  btnNext.textContent = 'Reintentar'
  btnNext.disabled = false
  btnNext.onclick = () => { void runInstallation() }
}

function updateTechNextButton() {
  const checked = document.querySelectorAll<HTMLInputElement>('input[name=tech]:checked')
  const btnNext = document.getElementById('btn-next') as HTMLButtonElement
  if (currentScreen === 'tech') btnNext.disabled = checked.length === 0
}

function updateApikeyNextButton() {
  const input = document.getElementById('apikey-input') as HTMLInputElement
  const btnNext = document.getElementById('btn-next') as HTMLButtonElement
  if (currentScreen === 'apikey') btnNext.disabled = input.value.trim().length === 0
}

document.querySelectorAll<HTMLElement>('.tech-option').forEach(opt => {
  opt.addEventListener('change', () => {
    const cb = opt.querySelector<HTMLInputElement>('input[type=checkbox]')
    opt.classList.toggle('selected', cb?.checked ?? false)
    updateTechNextButton()
  })
})

document.getElementById('privacy-scroll')?.addEventListener('scroll', function () {
  const el = this as HTMLElement
  const atBottom = el.scrollHeight - el.scrollTop <= el.clientHeight + 20
  const checkbox = document.getElementById('consent-check') as HTMLInputElement
  if (atBottom && checkbox.disabled) {
    checkbox.disabled = false
  }
})

document.getElementById('consent-check')?.addEventListener('change', function () {
  const btnNext = document.getElementById('btn-next') as HTMLButtonElement
  if (currentScreen === 'privacy') btnNext.disabled = !(this as HTMLInputElement).checked
})

document.getElementById('apikey-input')?.addEventListener('input', () => {
  updateApikeyNextButton()
  const errorEl = document.getElementById('apikey-error')
  if (errorEl) errorEl.textContent = ''
})

document.getElementById('btn-next')?.addEventListener('click', () => {
  void (async () => {
    const idx = SCREENS.indexOf(currentScreen)

    if (currentScreen === 'tech') {
      selectedCollectors = Array.from(
        document.querySelectorAll<HTMLInputElement>('input[name=tech]:checked')
      ).map(c => c.value)
      showScreen('apikey')
      return
    }

    if (currentScreen === 'apikey') {
      const input = document.getElementById('apikey-input') as HTMLInputElement
      const errorEl = document.getElementById('apikey-error') as HTMLDivElement
      const validatingEl = document.getElementById('apikey-validating') as HTMLDivElement
      const token = input.value.trim()
      if (!token) return

      const btnNext = document.getElementById('btn-next') as HTMLButtonElement
      btnNext.disabled = true
      validatingEl.style.display = 'block'
      errorEl.textContent = ''

      try {
        const serverUrl = await window.electronAPI.getServerUrl()
        const validation = await window.electronAPI.validateToken(token, serverUrl)
        if (!validation.ok) {
          errorEl.textContent = 'API Key inválida o servidor no disponible. Verifica la clave e inténtalo de nuevo.'
          btnNext.disabled = false
          validatingEl.style.display = 'none'
          return
        }
        setup = { token, serverUrl }
        await runInstallation()
      } catch {
        errorEl.textContent = 'Error de conexión. Verifica tu conexión a internet.'
        btnNext.disabled = false
        validatingEl.style.display = 'none'
      }
      return
    }

    if (currentScreen === 'done') {
      const wantShortcut = (document.getElementById('shortcut-check') as HTMLInputElement).checked
      if (wantShortcut) await window.electronAPI.createShortcut()
      await window.electronAPI.finishInstall()
      return
    }

    if (idx < SCREENS.length - 1) showScreen(SCREENS[idx + 1])
  })()
})

document.getElementById('btn-back')?.addEventListener('click', () => {
  const idx = SCREENS.indexOf(currentScreen)
  if (idx > 0) showScreen(SCREENS[idx - 1])
})

document.getElementById('btn-cancel')?.addEventListener('click', () => {
  void window.electronAPI.cancelInstall()
})

window.addEventListener('DOMContentLoaded', () => {
  void (async () => {
    const versionEl = document.getElementById('agent-version')
    if (versionEl) {
      const ver = await window.electronAPI.getAppVersion()
      versionEl.textContent = ver
    }
  })()
})
