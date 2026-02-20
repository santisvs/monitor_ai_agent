import fs from 'fs'
import path from 'path'
import os from 'os'

const CONFIG_DIR = path.join(os.homedir(), '.monitor-ia')
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json')

export interface AgentConfig {
  serverUrl: string
  authToken: string
  syncIntervalHours: number
  enabledCollectors: string[]
  /** Clave AES-256 para encriptar datos sensibles (base64) */
  encryptionKey?: string
  /** Fecha en que se dio consentimiento (ISO string) */
  consentGivenAt?: string
  /** Fecha del último envío exitoso de métricas (ISO string) */
  lastSentAt?: string
}

export function loadConfig(): AgentConfig {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error('Agente no configurado. Ejecuta: monitor-ia-agent setup <token>')
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'))
}

export function saveConfig(config: AgentConfig): void {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true })
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2))
}

export function configExists(): boolean {
  return fs.existsSync(CONFIG_PATH)
}

export function getConfigDir(): string {
  return CONFIG_DIR
}
