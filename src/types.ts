export interface CollectorResult {
  tool: string
  metrics: {
    sessionsCount?: number
    totalTokens?: number
    lastUsed?: string | null
    timeSpentMinutes?: number
    installed?: boolean
    [key: string]: any
  }
  collectedAt: string
}
