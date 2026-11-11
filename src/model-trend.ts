// Renders the Trends tab: one multi-model chart per metric. Curves use monotone cubic
// interpolation; clicking a chart selects a time bucket (synchronized crosshair across all
// charts plus a per-model breakdown under the clicked chart); clicking a curve or legend
// item focuses that model across every chart.
import { fmtBucketTick, fmtCompact, fmtCost, fmtErrorRate, fmtLatency, fmtPct, fmtTps } from './format'
import { buildModelSwatches, modelKey } from './models-detail'
import { esc } from './overview-cards'
import type { ModelSeriesPoint, OverviewReport } from './protocol'

export type TrendSelection = { ts: number; metric: string }

const MAX_SERIES = 8
const SVG_W = 300
const SVG_H = 150
const PAD_L = 36
const PAD_R = 10
const PAD_T = 10
const PAD_B = 20
const PLOT_W = SVG_W - PAD_L - PAD_R
const PLOT_H = SVG_H - PAD_T - PAD_B

type TrendSeries = { key: string; model: string; values: (number | null)[] }

type ChartContext = {
  buckets: number[]
  bucketMs: number
  swatches: Map<string, string>
  pointMap: Map<number, Map<string, ModelSeriesPoint>>
  selection: TrendSelection | null
  selectedIndex: number
  focus: string | null
}

type MetricSpec = {
  id: string
  title: string
  description: string
  series: TrendSeries[]
  fmt: (v: number) => string
  kind: 'line' | 'share'
}

function lastValue(s: TrendSeries): number | null {
  for (let i = s.values.length - 1; i >= 0; i -= 1) {
    const v = s.values[i]
    if (v !== null && Number.isFinite(v)) {
      return v
    }
  }
  return null
}

/** Rounds up to 1 / 2 / 2.5 / 5 × 10^k so the half-way gridline is also a round number. */
function niceCeil(v: number): number {
  if (!(v > 0)) {
    return 1
  }
  const exp = 10 ** Math.floor(Math.log10(v))
  const f = v / exp
  const nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10
  return nf * exp
}

/** Monotone cubic (Fritsch–Carlson) path: smooth, never overshoots between samples. */
function smoothPath(pts: [number, number][]): string {
  const n = pts.length
  if (n === 0) {
    return ''
  }
  const f = (v: number) => v.toFixed(1)
  if (n === 1) {
    return `M${f(pts[0][0])},${f(pts[0][1])}`
  }
  const dx: number[] = []
  const slope: number[] = []
  for (let i = 0; i < n - 1; i += 1) {
    dx.push(pts[i + 1][0] - pts[i][0])
    slope.push((pts[i + 1][1] - pts[i][1]) / dx[i])
  }
  const tangent: number[] = [slope[0]]
  for (let i = 1; i < n - 1; i += 1) {
    const a = slope[i - 1]
    const b = slope[i]
    tangent.push(
      a * b <= 0 ? 0 : (3 * (dx[i - 1] + dx[i])) / ((2 * dx[i] + dx[i - 1]) / a + (dx[i] + 2 * dx[i - 1]) / b)
    )
  }
  tangent.push(slope[n - 2])
  let d = `M${f(pts[0][0])},${f(pts[0][1])}`
  for (let i = 0; i < n - 1; i += 1) {
    const [x0, y0] = pts[i]
    const [x1, y1] = pts[i + 1]
    const h = dx[i] / 3
    d += ` C${f(x0 + h)},${f(y0 + tangent[i] * h)} ${f(x1 - h)},${f(y1 - tangent[i + 1] * h)} ${f(x1)},${f(y1)}`
  }
  return d
}

function slotX(i: number, n: number): number {
  return PAD_L + (i + 0.5) * (PLOT_W / n)
}

function axis(ctx: ChartContext, maxVal: number, fmt: (v: number) => string): string {
  const n = Math.max(1, ctx.buckets.length)
  const grid = [0, 0.5, 1]
    .map((frac) => {
      const y = PAD_T + PLOT_H * (1 - frac)
      const label = frac === 0 ? '0' : fmt(maxVal * frac)
      return `
        <line x1="${PAD_L}" y1="${y.toFixed(1)}" x2="${SVG_W - PAD_R}" y2="${y.toFixed(1)}" stroke="var(--chart-grid)" stroke-width="1" ${frac === 0 ? '' : 'stroke-dasharray="2 3"'} />
        <text x="${PAD_L - 6}" y="${(y + 3).toFixed(1)}" text-anchor="end" fill="var(--chart-axis)" font-family="var(--font-mono)" font-size="8.5">${esc(label)}</text>
      `
    })
    .join('')
  const idxs = n >= 3 ? [0, Math.floor(n / 2), n - 1] : [0]
  const ticks = idxs
    .map((idx) => {
      const ts = ctx.buckets[idx]
      if (ts === undefined) {
        return ''
      }
      const anchor = idx === 0 ? 'start' : idx === n - 1 ? 'end' : 'middle'
      const x = idx === 0 ? PAD_L : idx === n - 1 ? SVG_W - PAD_R : slotX(idx, n)
      return `<text x="${x.toFixed(1)}" y="${SVG_H - 5}" text-anchor="${anchor}" fill="var(--chart-axis)" font-family="var(--font-mono)" font-size="8.5">${esc(fmtBucketTick(ts, ctx.bucketMs))}</text>`
    })
    .join('')
  return grid + ticks
}

function crosshair(ctx: ChartContext, dots: string): string {
  if (ctx.selectedIndex < 0) {
    return ''
  }
  const x = slotX(ctx.selectedIndex, Math.max(1, ctx.buckets.length)).toFixed(1)
  return `
    <line x1="${x}" y1="${PAD_T}" x2="${x}" y2="${PAD_T + PLOT_H}" stroke="var(--ink-3)" stroke-width="1" stroke-dasharray="3 3" opacity="0.7" pointer-events="none" />
    ${dots}
  `
}

function svgOpen(metric: string, ctx: ChartContext): string {
  const n = Math.max(1, ctx.buckets.length)
  return `<svg class="trend-chart" viewBox="0 0 ${SVG_W} ${SVG_H}" data-trend-metric="${metric}" data-n="${n}" data-pad-l="${PAD_L}" data-plot-w="${PLOT_W}" data-vb-w="${SVG_W}" data-has-focus="${ctx.focus !== null}">`
}

function renderLineChart(spec: MetricSpec, ctx: ChartContext): string {
  const n = Math.max(1, ctx.buckets.length)
  let rawMax = 0
  for (const s of spec.series) {
    for (const v of s.values) {
      if (v !== null && Number.isFinite(v)) {
        rawMax = Math.max(rawMax, v)
      }
    }
  }
  const maxVal = niceCeil(rawMax)
  const yOf = (v: number) => PAD_T + PLOT_H * (1 - v / maxVal)
  const baseY = (PAD_T + PLOT_H).toFixed(1)

  const defs: string[] = []
  const groups = spec.series.map((s, sIdx) => {
    const color = ctx.swatches.get(s.key) ?? 'var(--palette-0)'
    const pts: [number, number][] = []
    s.values.forEach((v, i) => {
      if (v !== null && Number.isFinite(v)) {
        pts.push([slotX(i, n), yOf(v)])
      }
    })
    if (pts.length === 0) {
      return ''
    }
    const d = smoothPath(pts)
    const focused = ctx.focus === s.key
    const showArea = focused || (ctx.focus === null && spec.series.length <= 2)
    let area = ''
    if (showArea && pts.length > 1) {
      const gid = `tg-${spec.id}-${sIdx}`
      defs.push(
        `<linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${color}" stop-opacity="${focused ? 0.26 : 0.16}" /><stop offset="100%" stop-color="${color}" stop-opacity="0" /></linearGradient>`
      )
      area = `<path d="${d} L${pts[pts.length - 1][0].toFixed(1)},${baseY} L${pts[0][0].toFixed(1)},${baseY} Z" fill="url(#${gid})" pointer-events="none" />`
    }
    const dots =
      focused && pts.length <= 48
        ? pts
            .map(
              ([x, y]) =>
                `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.2" fill="${color}" stroke="var(--card)" stroke-width="1" pointer-events="none" />`
            )
            .join('')
        : ''
    return `
      <g class="trend-series" data-focused="${focused}">
        ${area}
        <path class="trend-line" d="${d}" fill="none" stroke="${color}" stroke-width="${focused ? 2.4 : 1.8}" stroke-linecap="round" stroke-linejoin="round" />
        ${dots}
        <path class="trend-hit" d="${d}" fill="none" stroke="transparent" stroke-width="12" pointer-events="stroke" data-trend-model="${esc(s.key)}"><title>${esc(s.model)}</title></path>
      </g>
    `
  })

  const selDots =
    ctx.selectedIndex >= 0
      ? spec.series
          .map((s) => {
            const v = s.values[ctx.selectedIndex]
            if (v === null || !Number.isFinite(v)) {
              return ''
            }
            const color = ctx.swatches.get(s.key) ?? 'var(--palette-0)'
            const dim = ctx.focus !== null && ctx.focus !== s.key
            return `<circle cx="${slotX(ctx.selectedIndex, n).toFixed(1)}" cy="${yOf(v).toFixed(1)}" r="3.6" fill="${color}" stroke="var(--card)" stroke-width="1.6" opacity="${dim ? 0.3 : 1}" pointer-events="none" />`
          })
          .join('')
      : ''

  return `
    ${svgOpen(spec.id, ctx)}
      <defs>${defs.join('')}</defs>
      ${axis(ctx, maxVal, spec.fmt)}
      ${groups.join('')}
      ${crosshair(ctx, selDots)}
    </svg>
  `
}

function renderShareChart(spec: MetricSpec, ctx: ChartContext): string {
  const n = Math.max(1, ctx.buckets.length)
  const cumLower = new Array<number>(n).fill(0)
  const groups: string[] = []
  spec.series.forEach((s) => {
    const color = ctx.swatches.get(s.key) ?? 'var(--palette-0)'
    const upper = cumLower.map((lo, i) => lo + (s.values[i] ?? 0))
    const topPts = upper.map((v, i) => `${slotX(i, n).toFixed(1)},${(PAD_T + PLOT_H * (1 - v / 100)).toFixed(1)}`)
    const bottomPts = cumLower
      .map((v, i) => `${slotX(i, n).toFixed(1)},${(PAD_T + PLOT_H * (1 - v / 100)).toFixed(1)}`)
      .reverse()
    const focused = ctx.focus === s.key
    groups.push(`
      <g class="trend-series" data-focused="${focused}">
        <path d="M${topPts.join(' L')} L${bottomPts.join(' L')} Z" fill="${color}" fill-opacity="${focused ? 0.95 : 0.78}" data-trend-model="${esc(s.key)}"><title>${esc(s.model)}</title></path>
        <path d="M${topPts.join(' L')}" fill="none" stroke="var(--card)" stroke-width="0.8" stroke-opacity="0.7" pointer-events="none" />
      </g>
    `)
    upper.forEach((v, i) => {
      cumLower[i] = v
    })
  })
  return `
    ${svgOpen(spec.id, ctx)}
      ${axis(ctx, 100, (v) => `${Math.round(v)}%`)}
      ${groups.join('')}
      ${crosshair(ctx, '')}
    </svg>
  `
}

function renderLegend(spec: MetricSpec, ctx: ChartContext): string {
  return `
    <div class="legend-grid trend-legend">
      ${spec.series
        .map((s) => {
          const color = ctx.swatches.get(s.key) ?? 'var(--palette-0)'
          const v = lastValue(s)
          const dim = ctx.focus !== null && ctx.focus !== s.key
          return `
            <button class="legend-item trend-legend-item" data-trend-legend="${esc(s.key)}" data-dim="${dim}" data-focused="${ctx.focus === s.key}" title="Highlight ${esc(s.model)}">
              <span class="swatch" style="background:${color}"></span>
              <span class="mono truncate" style="max-width: 118px">${esc(s.model)}</span>
              <span class="dim num">${v === null ? '–' : esc(spec.fmt(v))}</span>
            </button>
          `
        })
        .join('')}
    </div>
  `
}

function renderDetail(spec: MetricSpec, ctx: ChartContext): string {
  if (!ctx.selection || ctx.selection.metric !== spec.id || ctx.selectedIndex < 0) {
    return ''
  }
  const rows = spec.series
    .map((s) => ({ s, v: s.values[ctx.selectedIndex] }))
    .filter((r): r is { s: TrendSeries; v: number } => r.v !== null && Number.isFinite(r.v))
    .sort((a, b) => b.v - a.v)
  const max = Math.max(0, ...rows.map((r) => r.v))
  const bucketPoints = ctx.pointMap.get(ctx.selection.ts)
  return `
    <div class="trend-detail">
      <div class="trend-detail-head">
        <span><span class="num" style="color: var(--ink-1); font-weight: 600">${esc(fmtBucketTick(ctx.selection.ts, ctx.bucketMs))}</span> · ${esc(spec.title)}</span>
        <button class="trend-detail-close" data-trend-clear="true" title="Close">✕</button>
      </div>
      ${
        rows.length === 0
          ? '<div class="dim" style="font-size: 11.5px">No samples at this time</div>'
          : rows
              .map(({ s, v }) => {
                const color = ctx.swatches.get(s.key) ?? 'var(--palette-0)'
                const req = bucketPoints?.get(s.key)?.requests ?? 0
                const pct = max > 0 ? Math.max(2, (v / max) * 100) : 0
                return `
                  <div class="trend-detail-row" data-focused="${ctx.focus === s.key}">
                    <span class="swatch" style="background:${color}"></span>
                    <span class="mono truncate">${esc(s.model)} <span class="dim">· ${esc(s.key.slice(s.model.length + 2) || '—')}</span></span>
                    <span class="num trend-detail-value">${esc(spec.fmt(v))}</span>
                    <span class="trend-detail-bar"><span style="width:${pct.toFixed(1)}%;background:${color}"></span></span>
                    <span class="dim num trend-detail-req">${req} req</span>
                  </div>
                `
              })
              .join('')
      }
    </div>
  `
}

function alignSeries(
  buckets: number[],
  entries: [string, string][],
  pointMap: Map<number, Map<string, ModelSeriesPoint>>,
  pick: (pt: ModelSeriesPoint) => number | null,
  missing: number | null
): TrendSeries[] {
  return entries.map(([key, model]) => ({
    key,
    model,
    values: buckets.map((b) => {
      const pt = pointMap.get(b)?.get(key)
      return pt ? pick(pt) : missing
    })
  }))
}

export function renderModelTrendTab(
  report: OverviewReport,
  selection: TrendSelection | null,
  focus: string | null
): string {
  const perUnit =
    report.bucketMs < 3_600_000 ? '5 minutes' : report.bucketMs < 86_400_000 ? 'hour' : 'day'
  const header = (extra: string) => `
    <div class="page-header">
      <h1 class="page-title">Trends</h1>
      <p class="page-description">How each model performed in ${esc(report.windowLabel)}.${extra}</p>
    </div>
  `

  if (report.modelSeries.length === 0) {
    return `${header('')}<div class="card"><div class="empty">No model activity in this range</div></div>`
  }

  const swatches = buildModelSwatches(report.byModel)
  const ranked = [...report.byModel].sort((a, b) => b.totalRequests - a.totalRequests)
  const visible = ranked.slice(0, MAX_SERIES)
  const entries: [string, string][] = visible.map((m) => [modelKey(m), m.model])

  const pointMap = new Map<number, Map<string, ModelSeriesPoint>>()
  for (const pt of report.modelSeries) {
    let inner = pointMap.get(pt.timestamp)
    if (!inner) {
      inner = new Map()
      pointMap.set(pt.timestamp, inner)
    }
    inner.set(modelKey(pt), pt)
  }

  const { buckets } = report
  const anyPositive = (s: TrendSeries) => s.values.some((v) => v !== null && v > 0)
  const align = (pick: (pt: ModelSeriesPoint) => number | null, missing: number | null) =>
    alignSeries(buckets, entries, pointMap, pick, missing).filter(anyPositive)

  const requests = align((pt) => pt.requests, 0)
  const totals = buckets.map((_, i) => requests.reduce((sum, s) => sum + (s.values[i] ?? 0), 0))
  const share = requests
    .map((s) => ({
      ...s,
      values: s.values.map((v, i) => (totals[i] > 0 ? ((v ?? 0) / totals[i]) * 100 : null))
    }))
    .filter(anyPositive)

  const specs: MetricSpec[] = [
    { id: 'requests', title: 'Usage', description: `Requests per ${perUnit}`, series: requests, fmt: fmtCompact, kind: 'line' },
    { id: 'share', title: 'Usage share', description: `Share of requests per ${perUnit}`, series: share, fmt: (v) => fmtPct(v / 100), kind: 'share' },
    {
      id: 'tps',
      title: 'Speed',
      description: `Average output tokens/s per ${perUnit}`,
      series: align((pt) => (pt.avgTokensPerSecond !== null && pt.avgTokensPerSecond > 0 ? pt.avgTokensPerSecond : null), null),
      fmt: (v) => `${fmtTps(v)}/s`,
      kind: 'line'
    },
    {
      id: 'ttft',
      title: 'TTFT',
      description: `Average time to first token per ${perUnit}`,
      series: align((pt) => (pt.avgTtft !== null && pt.avgTtft > 0 ? pt.avgTtft : null), null),
      fmt: fmtLatency,
      kind: 'line'
    },
    {
      id: 'errors',
      title: 'Error rate',
      description: `Failed ÷ total requests per ${perUnit}`,
      series: align((pt) => (pt.requests > 0 ? pt.errors / pt.requests : null), null),
      fmt: fmtErrorRate,
      kind: 'line'
    },
    { id: 'tokens', title: 'Tokens', description: `Tokens per ${perUnit}`, series: align((pt) => pt.tokens, 0), fmt: fmtCompact, kind: 'line' },
    { id: 'cost', title: 'Cost', description: `Cost per ${perUnit}`, series: align((pt) => pt.cost, 0), fmt: (v) => fmtCost(v, 0), kind: 'line' }
  ]

  const ctx: ChartContext = {
    buckets,
    bucketMs: report.bucketMs,
    swatches,
    pointMap,
    selection,
    selectedIndex: selection ? buckets.indexOf(selection.ts) : -1,
    focus: focus !== null && entries.some(([k]) => k === focus) ? focus : null
  }

  const cards = specs
    .filter((spec) => spec.series.length > 0)
    .map(
      (spec) => `
        <section class="card">
          <div class="card-header">
            <div class="card-titles">
              <h2 class="card-title">${spec.title}</h2>
              <p class="card-description">${spec.description}</p>
            </div>
          </div>
          <div class="card-body">
            ${spec.kind === 'share' ? renderShareChart(spec, ctx) : renderLineChart(spec, ctx)}
            ${renderDetail(spec, ctx)}
            ${renderLegend(spec, ctx)}
          </div>
        </section>
      `
    )
    .join('')

  const hidden = ranked.length - visible.length
  return `
    ${header(`${hidden > 0 ? ` Top ${visible.length} of ${ranked.length} models.` : ''} Click a chart for a per-model breakdown; click a curve or legend to highlight a model.`)}
    ${cards}
  `
}
