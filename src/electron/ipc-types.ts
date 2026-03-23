export interface AgentStatus {
  version: string
  latestVersion: string | null
  apiKeyMasked: string
  lastSentAt: string | null
  nextSendEstimate: string | null
  activities: ActivityItem[]
}

export interface ActivityItem {
  tool: string
  label: string
  level: 'high' | 'normal' | 'low' | 'none'
  percentage: number
  sessions: number          // total acumulado
  sessionsWeek: number      // últimos 7 días
  sessionsSinceSync: number // desde el último envío
}

export interface InstallerSetup {
  token: string
  serverUrl: string
}
