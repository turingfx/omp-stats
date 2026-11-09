// Renders the expandable per-model detail panel (Efficiency, Latency, Tokens & performance chart)
// and assigns stable model swatch colors.
import {
  fmtBucketTick,
  fmtCompact,
  fmtErrorRate,
  fmtInt,
  fmtLatency,
  fmtPct,
  fmtTps
} from './format'
import { esc } from './overview-cards'
import type { ModelSeriesPoint, ModelStatsRow, OverviewReport } from './protocol'

const MODEL_PALETTE = [
  '#5ad8e6',
  '#ed4abf',
  '#9d7bff',
  '#f5b54a',
  '#4ade80',
  '#5b8cff',
  '#ff7a59',
  '#2dd4bf',
  '#c3e94f',
  '#fb7185'
]

export function modelKey(m: { model: string; provider: string }): string {
  return `${m.model}::${m.provider}`
}

export function buildModelSwatches(models: ModelStatsRow[]): Map<string, string> {
  const sorted = [...models].sort(
    (a, b) => b.totalRequests - a.totalRequests || modelKey(a).localeCompare(modelKey(b))
  )
  const map = new Map<string, string>()
  sorted.forEach((m, idx) => {
    map.set(modelKey(m), MODEL_PALETTE[idx % MODEL_PALETTE.length] ?? '#5ad8e6')
  })
  return map
}

function renderPerformanceLineChart(
  points: ModelSeriesPoint[],
  color: string,
  bucketMs: number,
  bucketWord: string
): string {
  if (points.length === 0) {
    return `<div class="empty" style="min-height: 60px">No performance samples</div>`
  }

  const rawMaxTps = Math.max(1, ...points.map((p) => p.avgTokensPerSecond ?? 0))
  const maxTps = Math.max(10, Math.ceil(rawMaxTps / 10) * 10)

  const rawMaxTtftSec = Math.max(0.5, ...points.map((p) => (p.avgTtft ?? 0) / 1000))
  const maxTtft =
    rawMaxTtftSec <= 2.5
      ? 2.5
      : rawMaxTtftSec <= 5
        ? 5
        : rawMaxTtftSec <= 10
          ? 10
          : Math.ceil(rawMaxTtftSec / 5) * 5

  const svgW = 300
  const svgH = 92
  const padL = 26
  const padR = 28
  const padT = 8
  const padB = 18
  const plotW = svgW - padL - padR
  const plotH = svgH - padT - padB

  const gridFractions = [0, 0.5, 1]
  const gridLines = gridFractions
    .map((frac) => {
      const y = padT + plotH * (1 - frac)
      const tpsLabel = Math.round(maxTps * frac)
      const ttftLabel = `${(maxTtft * frac).toFixed(maxTtft < 10 ? 1 : 0)}s`
      return `
        <line x1="${padL}" y1="${y.toFixed(1)}" x2="${svgW - padR}" y2="${y.toFixed(1)}" stroke="var(--line-1)" stroke-dasharray="2 2" stroke-width="0.8" />
        <text x="${padL - 4}" y="${(y + 3).toFixed(1)}" text-anchor="end" fill="var(--chart-axis)" font-family="var(--font-mono)" font-size="9">${tpsLabel}</text>
        <text x="${svgW - padR + 4}" y="${(y + 3).toFixed(1)}" text-anchor="start" fill="var(--chart-axis)" font-family="var(--font-mono)" font-size="9">${ttftLabel}</text>
      `
    })
    .join('')

  const n = points.length
  let pathTps = ''
  let pathTtft = ''
  let pointsMarkup = ''

  if (n === 1) {
    const pt = points[0]!
    const x = padL + plotW / 2
    const tps = pt.avgTokensPerSecond ?? 0
    const ttftSec = (pt.avgTtft ?? 0) / 1000
    const yTps = padT + plotH - (tps / maxTps) * plotH
    const yTtft = padT + plotH - (ttftSec / maxTtft) * plotH
    const tip = `${fmtBucketTick(pt.timestamp, bucketMs)}\nTokens/s: ${fmtTps(tps)} tok/s\nTTFT: ${ttftSec.toFixed(2)}s\nRequests: ${pt.requests}`
    pointsMarkup = `
      <g>
        <title>${esc(tip)}</title>
        <circle cx="${x.toFixed(1)}" cy="${yTps.toFixed(1)}" r="4" fill="${color}" />
        <circle cx="${x.toFixed(1)}" cy="${yTtft.toFixed(1)}" r="3" fill="#9a9a95" />
      </g>
    `
  } else {
    const slotW = plotW / (n - 1)
    points.forEach((pt, i) => {
      const x = padL + i * slotW
      const tps = pt.avgTokensPerSecond ?? 0
      const ttftSec = (pt.avgTtft ?? 0) / 1000
      const yTps = padT + plotH - (tps / maxTps) * plotH
      const yTtft = padT + plotH - (ttftSec / maxTtft) * plotH
      pathTps += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${yTps.toFixed(1)} `
      pathTtft += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${yTtft.toFixed(1)} `

      const tip = `${fmtBucketTick(pt.timestamp, bucketMs)}\nTokens/s: ${fmtTps(tps)} tok/s\nTTFT: ${ttftSec.toFixed(2)}s\nRequests: ${pt.requests}`
      pointsMarkup += `
        <g>
          <title>${esc(tip)}</title>
          <circle cx="${x.toFixed(1)}" cy="${yTps.toFixed(1)}" r="2.8" fill="${color}" />
          <circle cx="${x.toFixed(1)}" cy="${yTtft.toFixed(1)}" r="2.2" fill="#9a9a95" />
        </g>
      `
    })
  }

  const tickCount = Math.min(5, n)
  const xTicks =
    n > 1
      ? Array.from({ length: tickCount }, (_, tIdx) => {
          const ptIdx = Math.round((tIdx * (n - 1)) / (tickCount - 1))
          const pt = points[ptIdx]!
          const x = padL + (ptIdx * plotW) / (n - 1)
          const anchor = tIdx === 0 ? 'start' : tIdx === tickCount - 1 ? 'end' : 'middle'
          return `<text x="${x.toFixed(1)}" y="${svgH - 4}" text-anchor="${anchor}" fill="var(--chart-axis)" font-family="var(--font-mono)" font-size="9">${esc(fmtBucketTick(pt.timestamp, bucketMs))}</text>`
        }).join('')
      : `<text x="${(padL + plotW / 2).toFixed(1)}" y="${svgH - 4}" text-anchor="middle" fill="var(--chart-axis)" font-family="var(--font-mono)" font-size="9">${esc(fmtBucketTick(points[0]!.timestamp, bucketMs))}</text>`

  return `
    <div class="models-detail-chart">
      <div class="row" style="justify-content: space-between; margin-bottom: 2px">
        <div class="section-label">Performance per active ${esc(bucketWord)}</div>
        <div class="chart-legend">
          <span class="row" style="gap: 5px">
            <span class="swatch" style="background:${color}"></span>
            <span>Tokens/s</span>
          </span>
          <span class="row" style="gap: 5px">
            <span class="swatch" style="background:#9a9a95"></span>
            <span>TTFT</span>
          </span>
        </div>
      </div>
      <svg class="chart-svg" viewBox="0 0 ${svgW} ${svgH}">
        ${gridLines}
        ${
          n > 1
            ? `
          <path d="${pathTps.trim()}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
          <path d="${pathTtft.trim()}" fill="none" stroke="#9a9a95" stroke-width="1.6" stroke-dasharray="3 3" stroke-linecap="round" stroke-linejoin="round" />
        `
            : ''
        }
        ${pointsMarkup}
        ${xTicks}
      </svg>
    </div>
  `
}

export function renderExpandedModelDetail(
  m: ModelStatsRow,
  color: string,
  report: OverviewReport
): string {
  const key = modelKey(m)
  const points = report.modelSeries
    .filter((pt) => modelKey(pt) === key && (pt.avgTokensPerSecond !== null || pt.avgTtft !== null))
    .sort((a, b) => a.timestamp - b.timestamp)

  const bucketWord =
    report.bucketMs < 3_600_000 ? '5 minutes' : report.bucketMs < 86_400_000 ? 'hour' : 'day'

  return `
    <div class="models-detail">
      <div class="models-detail-grid">
        <div>
          <div class="section-label">Efficiency</div>
          <dl class="detail-dl">
            <div><dt>Error rate</dt><dd class="num">${fmtErrorRate(m.errorRate)} <span class="dim">(${fmtInt(m.failedRequests)})</span></dd></div>
            <div><dt>Cache rate</dt><dd class="num">${fmtPct(m.cacheRate)}</dd></div>
            <div><dt>Cache savings</dt><dd class="num">${fmtPct(m.cacheSavings)}</dd></div>
            <div><dt>Premium reqs</dt><dd class="num">${fmtInt(Math.round(m.totalPremiumRequests * 100) / 100)}</dd></div>
          </dl>
        </div>
        <div>
          <div class="section-label">Latency & Throughput</div>
          <dl class="detail-dl">
            <div><dt>Avg duration</dt><dd class="num">${fmtLatency(m.avgDuration)}</dd></div>
            <div><dt>Avg TTFT</dt><dd class="num">${fmtLatency(m.avgTtft)}</dd></div>
            <div><dt>Tokens/s</dt><dd class="num">${fmtTps(m.avgTokensPerSecond)}</dd></div>
          </dl>
        </div>
        <div>
          <div class="section-label">Tokens</div>
          <dl class="detail-dl">
            <div><dt>Uncached in</dt><dd class="num">${fmtCompact(m.totalInputTokens)}</dd></div>
            <div><dt>Cache read</dt><dd class="num">${fmtCompact(m.totalCacheReadTokens)}</dd></div>
            <div><dt>Cache write</dt><dd class="num">${fmtCompact(m.totalCacheWriteTokens)}</dd></div>
            <div><dt>Output</dt><dd class="num">${fmtCompact(m.totalOutputTokens)}</dd></div>
          </dl>
        </div>
      </div>
      ${renderPerformanceLineChart(points, color, report.bucketMs, bucketWord)}
    </div>
  `
}
