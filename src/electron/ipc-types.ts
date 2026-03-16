export interface AgentStatus {
  version: string
  latestVersion: string | null
  apiKeyMasked: string
  lastSentAt: string | null
  nextSendEstimate: string | null
  activities: ActivityItem[]
  serviceInstalled: boolean
}

export interface ActivityItem {
  tool: string
  label: string
  level: 'high' | 'normal' | 'low' | 'none'
  percentage: number
}

export interface InstallerSetup {
  token: string
  serverUrl: string
}
