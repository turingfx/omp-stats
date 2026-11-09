// Queries ~/.omp/stats.db with the exact SQL formulas used by omp's stats dashboard
// (http://127.0.0.1:59127/#/overview?range=24h and #/models?range=24h).
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const MIN_MS = 60_000
const HOUR_MS = 60 * MIN_MS
const DAY_MS = 24 * HOUR_MS
const MAX_BUCKETS = 1500

const RANGES = {
  '1h': { windowLabel: 'the last hour', spanMs: HOUR_MS, bucketMs: 5 * MIN_MS },
  '24h': { windowLabel: 'the last 24 hours', spanMs: DAY_MS, bucketMs: HOUR_MS },
  '7d': { windowLabel: 'the last 7 days', spanMs: 7 * DAY_MS, bucketMs: DAY_MS },
  '30d': { windowLabel: 'the last 30 days', spanMs: 30 * DAY_MS, bucketMs: DAY_MS },
  '90d': { windowLabel: 'the last 90 days', spanMs: 90 * DAY_MS, bucketMs: DAY_MS },
  all: { windowLabel: 'all time', spanMs: null, bucketMs: DAY_MS }
}

const METRIC_COLUMNS_SQL = `
  COUNT(*) AS requests,
  SUM(CASE WHEN stop_reason = 'error' THEN 1 ELSE 0 END) AS failed,
  COALESCE(SUM(input_tokens), 0) AS input_tokens,
  COALESCE(SUM(output_tokens), 0) AS output_tokens,
  COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
  COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens,
  TOTAL(premium_requests) AS premium_requests,
  TOTAL(cost_total) AS cost_total,
  COALESCE(SUM(CASE WHEN total_tokens > 0 AND cost_total = 0 AND (provider = 'xai-oauth' OR cost_unpriced = 1) THEN 1 ELSE 0 END), 0) AS unpriced,
  TOTAL(CASE WHEN cost_no_cache_input > 0 THEN cost_input + cost_cache_read + cost_cache_write ELSE 0 END) AS cached_prompt_cost,
  TOTAL(cost_no_cache_input) AS no_cache_input_cost,
  TOTAL(duration) / NULLIF(COUNT(duration), 0) AS avg_duration,
  TOTAL(ttft) / NULLIF(COUNT(ttft), 0) AS avg_ttft,
  TOTAL(CASE WHEN duration > 0 THEN output_tokens * 1000.0 / duration END) / NULLIF(COUNT(CASE WHEN duration > 0 THEN 1 END), 0) AS avg_tps,
  MIN(timestamp) AS first_ts,
  MAX(timestamp) AS last_ts
`

function buildBuckets(range, timestamps, now) {
  const spec = RANGES[range] ?? RANGES['24h']
  const { bucketMs, spanMs } = spec
  const end = Math.floor(now / bucketMs) * bucketMs
  let start
  if (spanMs !== null) {
    start = Math.floor((now - spanMs) / bucketMs) * bucketMs
  } else {
    start = end
    for (const ts of timestamps) {
      if (ts < start) {
        start = ts
      }
    }
    start = Math.floor(start / bucketMs) * bucketMs
  }
  start = Math.max(start, end - (MAX_BUCKETS - 1) * bucketMs)
  const out = []
  for (let b = start; b <= end; b += bucketMs) {
    out.push(b)
  }
  return out
}

function emptyOverall() {
  return {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    errorRate: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheReadTokens: 0,
    totalCacheWriteTokens: 0,
    cacheRate: 0,
    cacheSavings: 0,
    totalCost: 0,
    unpricedRequests: 0,
    totalPremiumRequests: 0,
    avgDuration: null,
    avgTtft: null,
    avgTokensPerSecond: null,
    firstTimestamp: 0,
    lastTimestamp: 0
  }
}

function shapeOverall(row) {
  if (!row || !row.requests) {
    return emptyOverall()
  }
  const req = Number(row.requests ?? 0)
  const failed = Number(row.failed ?? 0)
  const input = Number(row.input_tokens ?? 0)
  const output = Number(row.output_tokens ?? 0)
  const cacheRead = Number(row.cache_read_tokens ?? 0)
  const cacheWrite = Number(row.cache_write_tokens ?? 0)
  const noCacheCost = Number(row.no_cache_input_cost ?? 0)
  const cachedPromptCost = Number(row.cached_prompt_cost ?? 0)

  return {
    totalRequests: req,
    successfulRequests: req - failed,
    failedRequests: failed,
    errorRate: req > 0 ? failed / req : 0,
    totalInputTokens: input,
    totalOutputTokens: output,
    totalCacheReadTokens: cacheRead,
    totalCacheWriteTokens: cacheWrite,
    cacheRate: input + cacheRead > 0 ? cacheRead / (input + cacheRead) : 0,
    cacheSavings: noCacheCost > 0 ? (noCacheCost - cachedPromptCost) / noCacheCost : 0,
    totalCost: Number(row.cost_total ?? 0),
    unpricedRequests: Number(row.unpriced ?? 0),
    totalPremiumRequests: Number(row.premium_requests ?? 0),
    avgDuration: row.avg_duration === null ? null : Number(row.avg_duration),
    avgTtft: row.avg_ttft === null ? null : Number(row.avg_ttft),
    avgTokensPerSecond: row.avg_tps === null ? null : Number(row.avg_tps),
    firstTimestamp: Number(row.first_ts ?? 0),
    lastTimestamp: Number(row.last_ts ?? 0)
  }
}

export function queryOverviewReport({ range = '24h', dbPath } = {}) {
  const spec = RANGES[range] ?? RANGES['24h']
  const now = Date.now()
  const cutoff = spec.spanMs === null ? 0 : now - spec.spanMs
  const resolvedPath = dbPath ?? join(homedir(), '.omp', 'stats.db')

  if (!existsSync(resolvedPath)) {
    return {
      range,
      windowLabel: spec.windowLabel,
      bucketMs: spec.bucketMs,
      buckets: buildBuckets(range, [], now),
      overall: emptyOverall(),
      byAgentType: [],
      timeSeries: [],
      recentRequests: [],
      byModel: [],
      modelSeries: [],
      generatedAt: now
    }
  }

  const db = new DatabaseSync(resolvedPath, { readOnly: true })
  try {
    const overallRow = db
      .prepare(`SELECT ${METRIC_COLUMNS_SQL} FROM messages WHERE timestamp >= ?`)
      .get(cutoff)

    const byModelRows = db
      .prepare(
        `SELECT model, provider, ${METRIC_COLUMNS_SQL}
         FROM messages
         WHERE timestamp >= ?
         GROUP BY model, provider
         ORDER BY requests DESC`
      )
      .all(cutoff)

    const agentRows = db
      .prepare(
        `SELECT
          COALESCE(agent_type, 'main') AS agent_type,
          COUNT(*) AS requests,
          COALESCE(SUM(input_tokens), 0) AS input_tokens,
          COALESCE(SUM(output_tokens), 0) AS output_tokens,
          COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
          COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens,
          TOTAL(cost_total) AS cost_total
        FROM messages
        WHERE timestamp >= ?
        GROUP BY agent_type`
      )
      .all(cutoff)

    const bucketMs = spec.bucketMs
    const seriesRows = db
      .prepare(
        `SELECT
          (timestamp / ${bucketMs}) * ${bucketMs} AS bucket,
          COUNT(*) AS requests,
          SUM(CASE WHEN stop_reason = 'error' THEN 1 ELSE 0 END) AS errors,
          COALESCE(SUM(total_tokens), 0) AS tokens,
          TOTAL(cost_total) AS cost
        FROM messages
        WHERE timestamp >= ?
        GROUP BY 1
        ORDER BY 1`
      )
      .all(cutoff)

    const modelSeriesRows = db
      .prepare(
        `SELECT
          (timestamp / ${bucketMs}) * ${bucketMs} AS bucket,
          model,
          provider,
          COUNT(*) AS requests,
          TOTAL(ttft) / NULLIF(COUNT(ttft), 0) AS avg_ttft,
          TOTAL(CASE WHEN duration > 0 THEN output_tokens * 1000.0 / duration END) / NULLIF(COUNT(CASE WHEN duration > 0 THEN 1 END), 0) AS avg_tps
        FROM messages
        WHERE timestamp >= ?
        GROUP BY 1, model, provider
        ORDER BY 1`
      )
      .all(cutoff)

    const recentRows = db
      .prepare(
        `SELECT
          id,
          model,
          provider,
          timestamp,
          duration,
          stop_reason,
          error_message,
          total_tokens,
          cost_total,
          cost_unpriced
        FROM messages
        ORDER BY timestamp DESC
        LIMIT 12`
      )
      .all()

    const timeSeries = seriesRows.map((r) => ({
      timestamp: Number(r.bucket),
      requests: Number(r.requests ?? 0),
      errors: Number(r.errors ?? 0),
      tokens: Number(r.tokens ?? 0),
      cost: Number(r.cost ?? 0)
    }))

    return {
      range,
      windowLabel: spec.windowLabel,
      bucketMs,
      buckets: buildBuckets(
        range,
        timeSeries.map((p) => p.timestamp),
        now
      ),
      overall: shapeOverall(overallRow),
      byAgentType: agentRows.map((r) => ({
        agentType: r.agent_type,
        totalRequests: Number(r.requests ?? 0),
        totalInputTokens: Number(r.input_tokens ?? 0),
        totalOutputTokens: Number(r.output_tokens ?? 0),
        totalCacheReadTokens: Number(r.cache_read_tokens ?? 0),
        totalCacheWriteTokens: Number(r.cache_write_tokens ?? 0),
        totalCost: Number(r.cost_total ?? 0)
      })),
      timeSeries,
      recentRequests: recentRows.map((r) => ({
        id: Number(r.id),
        model: String(r.model ?? '—'),
        provider: String(r.provider ?? '—'),
        timestamp: Number(r.timestamp ?? 0),
        duration: r.duration === null ? null : Number(r.duration),
        stopReason: String(r.stop_reason ?? 'stop'),
        errorMessage: r.error_message === null ? null : String(r.error_message),
        totalTokens: Number(r.total_tokens ?? 0),
        costTotal: Number(r.cost_total ?? 0),
        costUnpriced: Boolean(r.cost_unpriced)
      })),
      byModel: byModelRows.map((r) => ({
        model: String(r.model ?? '—'),
        provider: String(r.provider ?? '—'),
        ...shapeOverall(r)
      })),
      modelSeries: modelSeriesRows.map((r) => ({
        timestamp: Number(r.bucket),
        model: String(r.model ?? '—'),
        provider: String(r.provider ?? '—'),
        requests: Number(r.requests ?? 0),
        avgTtft: r.avg_ttft === null ? null : Number(r.avg_ttft),
        avgTokensPerSecond: r.avg_tps === null ? null : Number(r.avg_tps)
      })),
      generatedAt: now
    }
  } finally {
    db.close()
  }
}
