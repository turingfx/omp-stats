// Shared contract between the sidebar panel (src/panel.ts) and the worker (worker/main.mjs).
// Mirrors http://127.0.0.1:59127/#/overview?range=24h and #/models?range=24h.

export type UsageRange = '1h' | '24h' | '7d' | '30d' | '90d' | 'all'
export type SubTab = 'overview' | 'models'
export type ActivityMetric = 'requests' | 'tokens' | 'cost'
export type ShareChartMode = 'share' | 'requests'
export type ModelsTableMode = 'compact' | 'full'

export type OverallStats = {
  totalRequests: number
  successfulRequests: number
  failedRequests: number
  errorRate: number
  totalInputTokens: number
  totalOutputTokens: number
  totalCacheReadTokens: number
  totalCacheWriteTokens: number
  cacheRate: number
  cacheSavings: number
  totalCost: number
  unpricedRequests: number
  totalPremiumRequests: number
  avgDuration: number | null
  avgTtft: number | null
  avgTokensPerSecond: number | null
  firstTimestamp: number
  lastTimestamp: number
}

export type ModelStatsRow = OverallStats & {
  model: string
  provider: string
}

export type ModelSeriesPoint = {
  timestamp: number
  model: string
  provider: string
  requests: number
  avgTtft: number | null
  avgTokensPerSecond: number | null
}

export type AgentTypeRow = {
  agentType: 'main' | 'subagent' | 'advisor'
  totalRequests: number
  totalInputTokens: number
  totalOutputTokens: number
  totalCacheReadTokens: number
  totalCacheWriteTokens: number
  totalCost: number
}

export type TimeSeriesPoint = {
  timestamp: number
  requests: number
  errors: number
  tokens: number
  cost: number
}

export type RecentRequestRow = {
  id: number
  model: string
  provider: string
  timestamp: number
  duration: number | null
  stopReason: string
  errorMessage: string | null
  totalTokens: number
  costTotal: number
  costUnpriced: boolean
}

export type OverviewReport = {
  range: UsageRange
  windowLabel: string
  bucketMs: number
  buckets: number[]
  overall: OverallStats
  byAgentType: AgentTypeRow[]
  timeSeries: TimeSeriesPoint[]
  recentRequests: RecentRequestRow[]
  byModel: ModelStatsRow[]
  modelSeries: ModelSeriesPoint[]
  generatedAt: number
}

declare module 'orca' {
  // oxlint-disable-next-line typescript/consistent-type-definitions -- declaration merging needs an interface
  interface PluginRequests {
    'usage.overview': { input: { range: UsageRange }; output: OverviewReport }
  }
}
