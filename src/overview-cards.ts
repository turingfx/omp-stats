// Renders the top header, sub-tab navigation, 5 Primary KPI Stat Cards with sparklines,
// 8 Secondary Stat Cells, and the Activity Bar Chart card.
import {
  fmtAgo,
  fmtBucketTick,
  fmtCompact,
  fmtCost,
  fmtErrorRate,
  fmtInt,
  fmtLatency,
  fmtPct,
  fmtTps
} from './format'
import type { ActivityMetric, OverviewReport, SubTab, UsageRange } from './protocol'

const RANGES: { value: UsageRange; label: string }[] = [
  { value: '1h', label: '1h' },
  { value: '24h', label: '24h' },
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
  { value: '90d', label: '90d' },
  { value: 'all', label: 'All' }
]

export function esc(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function alignSeries(
  report: OverviewReport,
  pick: (pt: OverviewReport['timeSeries'][number]) => number
): number[] {
  const byTs = new Map<number, number>()
  for (const pt of report.timeSeries) {
    byTs.set(pt.timestamp, pick(pt))
  }
  return report.buckets.map((b) => byTs.get(b) ?? 0)
}

export function renderSparkline(
  values: number[],
  color = 'var(--chart-primary)',
  uid = 's'
): string {
  if (values.length < 2) {
    return ''
  }
  const w = 120
  const h = 24
  const max = Math.max(0, ...values)
  const min = Math.min(0, ...values)
  const step = w / (values.length - 1)
  let path = ''
  for (let i = 0; i < values.length; i += 1) {
    const x = i * step
    const y = max > min ? h - 2 - ((values[i] - min) / (max - min)) * (h - 4) : h - 2
    path += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)} `
  }
  const area = `${path}L${w},${h} L0,${h} Z`
  return `
    <div class="stat-spark">
      <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
        <defs>
          <linearGradient id="grad-${uid}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${color}" stop-opacity="0.28" />
            <stop offset="100%" stop-color="${color}" stop-opacity="0" />
          </linearGradient>
        </defs>
        <path d="${area}" fill="url(#grad-${uid})" />
        <path d="${path.trim()}" fill="none" stroke="${color}" stroke-width="1.5" />
      </svg>
    </div>
  `
}

export function renderTopHeader(
  range: UsageRange,
  tab: SubTab,
  report: OverviewReport | null,
  loading: boolean,
  autoRefreshMin: number | null,
  autoMenuOpen: boolean
): string {
  const liveAgo = report ? fmtAgo(report.generatedAt) : 'syncing…'
  const modelCount = report?.byModel.length ?? 0
  const autoOptions: { value: number | null; label: string }[] = [
    { value: null, label: 'Off' },
    { value: 1, label: '1m' },
    { value: 5, label: '5m' },
    { value: 10, label: '10m' },
    { value: 30, label: '30m' }
  ]

  return `
    <div class="topbar-row">
      <div class="topbar-controls">
        <div class="status-group">
          <span class="live-chip" title="数据更新于 ${esc(liveAgo)}">
            <span class="row" style="gap: 5px">
              <span class="dot" data-tone="live" data-pulse="true"></span>
              <span>Live</span>
            </span>
          </span>
          <div class="auto-refresh-wrap">
            <button class="auto-btn" data-on="${autoRefreshMin !== null}" data-action="auto-refresh" title="自动刷新间隔" aria-haspopup="menu" aria-expanded="${autoMenuOpen}">
              <span class="auto-btn-label">Auto</span>
              <span class="auto-btn-value">${autoRefreshMin === null ? 'Off' : `${autoRefreshMin}m`}</span>
              <span class="auto-caret">▾</span>
            </button>
            ${autoMenuOpen
              ? `<div class="auto-menu" role="menu">
                  ${autoOptions
                    .map(
                      (o) =>
                        `<button class="auto-menu-option" role="menuitemradio" aria-checked="${autoRefreshMin === o.value}" data-auto-min="${o.value ?? 'off'}">${o.label}</button>`
                    )
                    .join('')}
                </div>`
              : ''}
          </div>
          <button class="refresh-btn" data-action="refresh" title="点击立即刷新数据" ${loading ? 'disabled' : ''}>
            <span class="refresh-icon ${loading ? 'spin' : ''}">⟳</span>
            <span>${loading ? '刷新中…' : '刷新'}</span>
          </button>
        </div>
        <div class="segmented">
          ${RANGES.map((r) => `<button class="segmented-option" data-active="${range === r.value}" data-range="${r.value}">${r.label}</button>`).join('')}
        </div>
      </div>
      <div class="topbar-icon-card" title="omp AI coding agent">
        <img src="./assets/omp-logo.png" class="topbar-icon" alt="omp" />
      </div>
    </div>
    <nav class="tabs" aria-label="Stats views">
      <button class="tab" data-active="${tab === 'overview'}" data-tab="overview">Overview</button>
      <button class="tab" data-active="${tab === 'models'}" data-tab="models">
        <span>Models</span>
        ${modelCount > 0 ? `<span class="tab-badge num">${modelCount}</span>` : ''}
      </button>
      <button class="tab" data-active="${tab === 'model-trend'}" data-tab="model-trend">Trends</button>
    </nav>
  `
}

export function renderStatGrids(report: OverviewReport): string {
  const p = report.overall
  const convTokens =
    p.totalInputTokens + p.totalOutputTokens + p.totalCacheReadTokens + p.totalCacheWriteTokens
  const costSeries = alignSeries(report, (x) => x.cost)
  const reqSeries = alignSeries(report, (x) => x.requests)
  const tokSeries = alignSeries(report, (x) => x.tokens)
  const errSeries = alignSeries(report, (x) => x.errors)
  const unpricedFoot = p.unpricedRequests > 0 ? `${fmtInt(p.unpricedRequests)} unpriced` : '&nbsp;'
  return `
    <div class="page-header">
      <h1 class="page-title">Overview</h1>
      <p class="page-description">Everything omp did across your sessions in ${esc(report.windowLabel)}.</p>
    </div>

    <div class="stat-grid">
      <div class="stat" title="What this usage would cost at public API rates">
        <div class="stat-label">API-equivalent cost</div>
        <div class="stat-value">${fmtCost(p.totalCost, p.unpricedRequests)}</div>
        <div class="stat-foot">${unpricedFoot}</div>
        ${renderSparkline(costSeries, 'var(--chart-secondary)', 'cost')}
      </div>
      <div class="stat">
        <div class="stat-label">Requests</div>
        <div class="stat-value">${fmtInt(p.totalRequests)}</div>
        <div class="stat-foot">${fmtInt(p.failedRequests)} failed</div>
        ${renderSparkline(reqSeries, 'var(--chart-primary)', 'req')}
      </div>
      <div class="stat" title="Uncached input + cache reads + cache writes + output">
        <div class="stat-label">Conversation tokens</div>
        <div class="stat-value">${fmtCompact(convTokens)}</div>
        <div class="stat-foot">${fmtCompact(p.totalOutputTokens)} output</div>
        ${renderSparkline(tokSeries, 'var(--chart-primary)', 'tok')}
      </div>
      <div class="stat" title="Cache reads ÷ (uncached input + cache reads)">
        <div class="stat-label">Cache rate</div>
        <div class="stat-value">${fmtPct(p.cacheRate)}</div>
        <div class="stat-foot">${fmtPct(p.cacheSavings)} saved</div>
      </div>
      <div class="stat">
        <div class="stat-label">Error rate</div>
        <div class="stat-value">${fmtErrorRate(p.errorRate)}</div>
        <div class="stat-foot">${fmtInt(p.successfulRequests)} succeeded</div>
        ${renderSparkline(errSeries, 'var(--bad)', 'err')}
      </div>
    </div>

    <div class="stat-grid" data-strip="sm">
      <div class="stat" data-size="sm"><div class="stat-label">Uncached input</div><div class="stat-value">${fmtCompact(p.totalInputTokens)}</div></div>
      <div class="stat" data-size="sm"><div class="stat-label">Cache read</div><div class="stat-value">${fmtCompact(p.totalCacheReadTokens)}</div></div>
      <div class="stat" data-size="sm"><div class="stat-label">Cache write</div><div class="stat-value">${fmtCompact(p.totalCacheWriteTokens)}</div></div>
      <div class="stat" data-size="sm"><div class="stat-label">Output</div><div class="stat-value">${fmtCompact(p.totalOutputTokens)}</div></div>
      <div class="stat" data-size="sm"><div class="stat-label">Premium reqs</div><div class="stat-value">${fmtInt(Math.round(p.totalPremiumRequests * 100) / 100)}</div></div>
      <div class="stat" data-size="sm"><div class="stat-label">Tokens/s</div><div class="stat-value">${fmtTps(p.avgTokensPerSecond)}</div></div>
      <div class="stat" data-size="sm"><div class="stat-label">Avg latency</div><div class="stat-value">${fmtLatency(p.avgDuration)}</div></div>
      <div class="stat" data-size="sm"><div class="stat-label">Avg TTFT</div><div class="stat-value">${fmtLatency(p.avgTtft)}</div></div>
    </div>
  `
}

export function renderActivityCard(report: OverviewReport, metric: ActivityMetric): string {
  const perUnit =
    report.bucketMs < 3_600_000 ? '5 minutes' : report.bucketMs < 86_400_000 ? 'hour' : 'day'
  const okVals = alignSeries(report, (x) => Math.max(0, x.requests - x.errors))
  const errVals = alignSeries(report, (x) => x.errors)
  const tokVals = alignSeries(report, (x) => x.tokens)
  const costVals = alignSeries(report, (x) => x.cost)

  const totals =
    metric === 'requests'
      ? okVals.map((v, i) => v + (errVals[i] ?? 0))
      : metric === 'tokens'
        ? tokVals
        : costVals
  const rawMax = Math.max(0, ...totals)
  const maxVal = rawMax > 0 ? rawMax : 1
  const fmtTick = (v: number) => (metric === 'cost' ? fmtCost(v, 0) : fmtCompact(v))

  const svgW = 300
  const svgH = 148
  const padL = 34
  const padR = 6
  const padT = 8
  const padB = 20
  const plotW = svgW - padL - padR
  const plotH = svgH - padT - padB
  const n = Math.max(1, report.buckets.length)
  const slotW = plotW / n
  const barW = Math.max(2.5, Math.min(14, slotW * 0.66))

  const gridLines = [0, 0.5, 1]
    .map((frac) => {
      const y = padT + plotH * (1 - frac)
      const val = maxVal * frac
      return `
        <line x1="${padL}" y1="${y.toFixed(1)}" x2="${svgW - padR}" y2="${y.toFixed(1)}" stroke="var(--chart-grid)" stroke-width="1" />
        <text x="${padL - 5}" y="${(y + 3).toFixed(1)}" text-anchor="end" fill="var(--chart-axis)" font-family="var(--font-mono)" font-size="9">${esc(fmtTick(val))}</text>
      `
    })
    .join('')

  const bars = report.buckets
    .map((ts, i) => {
      const x = padL + i * slotW + (slotW - barW) / 2
      const total = totals[i] ?? 0
      if (total <= 0) {
        return ''
      }
      const totalH = Math.max(2, (total / maxVal) * plotH)
      const yTop = padT + plotH - totalH
      const label = fmtBucketTick(ts, report.bucketMs)
      if (metric === 'requests') {
        const err = errVals[i] ?? 0
        const errH = err > 0 ? Math.max(2, (err / maxVal) * plotH) : 0
        const okH = Math.max(0, totalH - errH)
        return `
          <g>
            <title>${esc(`${label}: ${fmtInt(total)} requests (${fmtInt(err)} failed)`)}</title>
            ${okH > 0 ? `<rect x="${x.toFixed(1)}" y="${yTop.toFixed(1)}" width="${barW.toFixed(1)}" height="${okH.toFixed(1)}" rx="1.5" fill="var(--chart-primary)" />` : ''}
            ${errH > 0 ? `<rect x="${x.toFixed(1)}" y="${(padT + plotH - errH).toFixed(1)}" width="${barW.toFixed(1)}" height="${errH.toFixed(1)}" rx="1.5" fill="var(--bad)" />` : ''}
          </g>
        `
      }
      const color = metric === 'tokens' ? 'var(--chart-primary)' : 'var(--chart-secondary)'
      return `
        <g>
          <title>${esc(`${label}: ${fmtTick(total)}`)}</title>
          <rect x="${x.toFixed(1)}" y="${yTop.toFixed(1)}" width="${barW.toFixed(1)}" height="${totalH.toFixed(1)}" rx="1.5" fill="${color}" />
        </g>
      `
    })
    .join('')

  const tickIndices = n >= 3 ? [0, Math.floor(n / 2), n - 1] : [0]
  const xTicks = tickIndices
    .map((idx) => {
      const ts = report.buckets[idx]
      if (ts === undefined) {
        return ''
      }
      const x = padL + idx * slotW + slotW / 2
      const anchor = idx === 0 ? 'start' : idx === n - 1 ? 'end' : 'middle'
      return `<text x="${x.toFixed(1)}" y="${svgH - 4}" text-anchor="${anchor}" fill="var(--chart-axis)" font-family="var(--font-mono)" font-size="9">${esc(fmtBucketTick(ts, report.bucketMs))}</text>`
    })
    .join('')

  return `
    <section class="card">
      <div class="card-header">
        <div class="card-titles">
          <h2 class="card-title">Activity</h2>
          <p class="card-description">Per ${perUnit}</p>
        </div>
        <div class="segmented" data-size="sm">
          <button class="segmented-option" data-active="${metric === 'requests'}" data-metric="requests">Requests</button><button class="segmented-option" data-active="${metric === 'tokens'}" data-metric="tokens">Tokens</button><button class="segmented-option" data-active="${metric === 'cost'}" data-metric="cost">Cost</button>
        </div>
      </div>
      <div class="card-body">
        <svg class="chart-svg" viewBox="0 0 ${svgW} ${svgH}">
          ${gridLines}
          ${bars}
          ${xTicks}
        </svg>
      </div>
    </section>
  `
}
