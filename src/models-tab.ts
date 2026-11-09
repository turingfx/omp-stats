// Renders http://127.0.0.1:59127/#/models?range=24h:
// 1. 4 Stat cards (Models used, Most used, Requests + sparkline, API-equivalent cost)
// 2. Request share stacked bar chart (Share % vs Requests count) + model legend
// 3. All models table (delegated to models-table.ts with Compact and Full views)
import { fmtBucketTick, fmtCompact, fmtCost, fmtInt, fmtPct } from './format'
import { buildModelSwatches, modelKey } from './models-detail'
import { renderAllModelsCard } from './models-table'
import { esc, renderSparkline } from './overview-cards'
import type { ModelsTableMode, OverviewReport, ShareChartMode } from './protocol'

export function renderModelsTab(
  report: OverviewReport,
  shareMode: ShareChartMode,
  tableMode: ModelsTableMode,
  expandedModelKey: string | null
): string {
  const models = report.byModel
  const perUnit =
    report.bucketMs < 3_600_000 ? '5 minutes' : report.bucketMs < 86_400_000 ? 'hour' : 'day'

  if (models.length === 0) {
    return `
      <div class="page-header">
        <h1 class="page-title">Models</h1>
        <p class="page-description">Which models did the work in ${esc(report.windowLabel)}, and how fast they answered.</p>
      </div>
      <div class="card"><div class="empty">No model usage in this range.</div></div>
    `
  }

  const swatches = buildModelSwatches(models)
  const top = models[0]
  const providerCount = new Set(models.map((m) => m.provider)).size
  const totalRequests = models.reduce((s, m) => s + m.totalRequests, 0)
  const failedRequests = models.reduce((s, m) => s + m.failedRequests, 0)
  const totalCost = models.reduce((s, m) => s + m.totalCost, 0)
  const unpricedRequests = models.reduce((s, m) => s + m.unpricedRequests, 0)
  const maxRequests = Math.max(1, top?.totalRequests ?? 1)

  const bucketModelMap = new Map<number, Map<string, number>>()
  const modelTrendMap = new Map<string, Map<number, number>>()
  for (const pt of report.modelSeries) {
    const k = modelKey(pt)
    let bMap = bucketModelMap.get(pt.timestamp)
    if (!bMap) {
      bMap = new Map()
      bucketModelMap.set(pt.timestamp, bMap)
    }
    bMap.set(k, (bMap.get(k) ?? 0) + pt.requests)

    let tMap = modelTrendMap.get(k)
    if (!tMap) {
      tMap = new Map()
      modelTrendMap.set(k, tMap)
    }
    tMap.set(pt.timestamp, (tMap.get(pt.timestamp) ?? 0) + pt.requests)
  }

  const requestTotals = report.buckets.map((b) => {
    const bMap = bucketModelMap.get(b)
    if (!bMap) {
      return 0
    }
    let sum = 0
    for (const v of bMap.values()) {
      sum += v
    }
    return sum
  })

  const maxBucketReq = Math.max(1, ...requestTotals)
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
      const label =
        shareMode === 'share' ? `${Math.round(frac * 100)}%` : fmtCompact(maxBucketReq * frac)
      return `
        <line x1="${padL}" y1="${y.toFixed(1)}" x2="${svgW - padR}" y2="${y.toFixed(1)}" stroke="var(--chart-grid)" stroke-width="1" />
        <text x="${padL - 5}" y="${(y + 3).toFixed(1)}" text-anchor="end" fill="var(--chart-axis)" font-family="var(--font-mono)" font-size="9">${esc(label)}</text>
      `
    })
    .join('')

  const stackedBars = report.buckets
    .map((ts, i) => {
      const total = requestTotals[i] ?? 0
      if (total <= 0) {
        return ''
      }
      const bMap = bucketModelMap.get(ts)
      if (!bMap) {
        return ''
      }
      const x = padL + i * slotW + (slotW - barW) / 2
      let yCursor = padT + plotH
      return models
        .map((m) => {
          const k = modelKey(m)
          const count = bMap.get(k) ?? 0
          if (count <= 0) {
            return ''
          }
          const frac = shareMode === 'share' ? count / total : count / maxBucketReq
          const h = Math.max(1.5, frac * plotH)
          yCursor -= h
          const color = swatches.get(k) ?? '#5ad8e6'
          return `<rect x="${x.toFixed(1)}" y="${Math.max(padT, yCursor).toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" fill="${color}"><title>${esc(`${fmtBucketTick(ts, report.bucketMs)} · ${m.model}: ${count} req (${fmtPct(count / total)})`)}</title></rect>`
        })
        .join('')
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
    <div class="page-header">
      <h1 class="page-title">Models</h1>
      <p class="page-description">Which models did the work in ${esc(report.windowLabel)}, and how fast they answered.</p>
    </div>

    <div class="stat-grid">
      <div class="stat">
        <div class="stat-label">Models used</div>
        <div class="stat-value">${fmtInt(models.length)}</div>
        <div class="stat-foot">across ${fmtInt(providerCount)} provider${providerCount === 1 ? '' : 's'}</div>
      </div>
      <div class="stat" title="${esc(top ? `${top.model} (${top.provider})` : '')}">
        <div class="stat-label">Most used</div>
        <div class="stat-value" style="font-size: 16px">${esc(top ? top.model : '–')}</div>
        <div class="stat-foot">${top ? `${fmtPct(top.totalRequests / Math.max(1, totalRequests))} · ${esc(top.provider)}` : '–'}</div>
      </div>
      <div class="stat">
        <div class="stat-label">Requests</div>
        <div class="stat-value">${fmtInt(totalRequests)}</div>
        <div class="stat-foot">${fmtInt(failedRequests)} failed</div>
        ${renderSparkline(requestTotals, 'var(--chart-primary)', 'mreq')}
      </div>
      <div class="stat" title="What this usage would cost at public API rates">
        <div class="stat-label">API-equivalent cost</div>
        <div class="stat-value">${fmtCost(totalCost, unpricedRequests)}</div>
        <div class="stat-foot">${unpricedRequests > 0 ? `${fmtInt(unpricedRequests)} unpriced` : '&nbsp;'}</div>
      </div>
    </div>

    <section class="card">
      <div class="card-header">
        <div class="card-titles">
          <h2 class="card-title">Request share</h2>
          <p class="card-description">${shareMode === 'share' ? `Each model's share of requests per ${perUnit}` : `Requests per ${perUnit}, stacked by model`}</p>
        </div>
        <div class="segmented" data-size="sm">
          <button class="segmented-option" data-active="${shareMode === 'share'}" data-share-mode="share">Share</button>
          <button class="segmented-option" data-active="${shareMode === 'requests'}" data-share-mode="requests">Requests</button>
        </div>
      </div>
      <div class="card-body">
        <div class="stack" style="gap: 12px">
          <svg class="chart-svg" viewBox="0 0 ${svgW} ${svgH}">
            ${gridLines}
            ${stackedBars}
            ${xTicks}
          </svg>
          <div class="legend-grid">
            ${models
              .slice(0, 8)
              .map((m) => {
                const k = modelKey(m)
                const color = swatches.get(k) ?? '#5ad8e6'
                return `
                  <span class="legend-item">
                    <span class="swatch" style="background:${color}"></span>
                    <span class="mono truncate" style="max-width: 140px">${esc(m.model)}</span>
                    <span class="dim num">${fmtPct(m.totalRequests / Math.max(1, totalRequests))}</span>
                  </span>
                `
              })
              .join('')}
          </div>
        </div>
      </div>
    </section>

    ${renderAllModelsCard(report, tableMode, expandedModelKey, swatches, maxRequests, modelTrendMap)}
  `
}
