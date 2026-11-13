// Controller for the OMP Stats sidebar panel (Overview + Models sub-tabs).
import { renderModelTrendTab, type TrendSelection } from './model-trend'
import { renderModelsTab } from './models-tab'
import { esc, renderActivityCard, renderStatGrids, renderTopHeader } from './overview-cards'
import { renderLatestRequestsCard, renderTokenMixCard } from './overview-sections'
import type {
  ActivityMetric,
  ModelsTableMode,
  OverviewReport,
  ShareChartMode,
  SubTab,
  UsageRange
} from './protocol'

type UiState = {
  range: UsageRange
  tab: SubTab
  metric: ActivityMetric
  shareMode: ShareChartMode
  modelsMode: ModelsTableMode
  expandedModelKey: string | null
  loading: boolean
  error: string | null
  report: OverviewReport | null
  autoRefreshMin: number | null
  autoMenuOpen: boolean
  trendSelection: TrendSelection | null
  trendFocus: string | null
}

const STORAGE_KEY = 'omp-stats-overview.v3'

function loadCached(): {
  range: UsageRange
  tab: SubTab
  modelsMode: ModelsTableMode
  autoRefreshMin: number | null
  report: OverviewReport | null
} {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return { range: '24h', tab: 'models', modelsMode: 'compact', autoRefreshMin: null, report: null }
    }
    const parsed = JSON.parse(raw) as {
      range?: UsageRange
      tab?: SubTab
      modelsMode?: ModelsTableMode
      autoRefreshMin?: number | null
      report?: OverviewReport
    }
    const auto =
      parsed.autoRefreshMin === 1 || parsed.autoRefreshMin === 5 ||
      parsed.autoRefreshMin === 10 || parsed.autoRefreshMin === 30
        ? parsed.autoRefreshMin
        : null
    return {
      range: parsed.range ?? '24h',
      tab: parsed.tab ?? 'models',
      modelsMode: parsed.modelsMode ?? 'compact',
      autoRefreshMin: auto,
      report: parsed.report ?? null
    }
  } catch {
    return { range: '24h', tab: 'models', modelsMode: 'compact', autoRefreshMin: null, report: null }
  }
}

function saveCached(): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        range: state.range,
        tab: state.tab,
        modelsMode: state.modelsMode,
        autoRefreshMin: state.autoRefreshMin,
        report: state.report
      })
    )
  } catch {
    // Ignore storage quota errors.
  }
}

const cached = loadCached()

const state: UiState = {
  range: cached.range,
  tab: cached.tab,
  metric: 'requests',
  shareMode: 'share',
  modelsMode: cached.modelsMode,
  expandedModelKey: null,
  loading: false,
  error: null,
  report: cached.report,
  autoRefreshMin: cached.autoRefreshMin,
  autoMenuOpen: false,
  trendSelection: null,
  trendFocus: null
}

function render(): void {
  const root = document.getElementById('root')
  if (!root) {
    return
  }
  const { range, tab, metric, shareMode, modelsMode, expandedModelKey, report, loading, error } =
    state
  let html = renderTopHeader(range, tab, report, loading, state.autoRefreshMin, state.autoMenuOpen)

  if (error) {
    html += `<div class="card"><div class="empty">${esc(error)}</div></div>`
  }

  if (!report) {
    html += `<div class="card"><div class="empty">${loading ? 'Loading stats…' : 'No data available'}</div></div>`
  } else if (tab === 'model-trend') {
    html += renderModelTrendTab(report, state.trendSelection, state.trendFocus)
  } else if (tab === 'models') {
    html += renderModelsTab(report, shareMode, modelsMode, expandedModelKey)
  } else {
    html += renderStatGrids(report)
    html += renderActivityCard(report, metric)
    html += renderTokenMixCard(report)
    html += renderLatestRequestsCard(report)
  }

  root.innerHTML = html

  if (state.expandedModelKey) {
    const chartEl = root.querySelector('.models-detail-chart')
    chartEl?.scrollIntoView({ block: 'end' })
  }
}

async function fetchOverview(nextRange?: UsageRange, options?: { forceSync?: boolean }): Promise<void> {
  if (state.loading) {
    return
  }
  const targetRange = nextRange ?? state.range
  state.loading = true
  state.error = null
  if (nextRange) {
    state.range = nextRange
  }
  render()

  try {
    const payload: { range: UsageRange; forceSync?: boolean } = { range: targetRange }
    if (options?.forceSync) {
      payload.forceSync = true
    }
    const answer = await orca.plugin.request(
      'usage.overview',
      payload,
      { timeoutMs: 30_000 }
    )
    state.report = answer
    saveCached()
  } catch (cause) {
    state.error = cause instanceof Error ? cause.message : String(cause)
  } finally {
    state.loading = false
    render()
  }
}

let autoTimer: number | null = null

function applyAutoRefresh(): void {
  if (autoTimer !== null) {
    clearInterval(autoTimer)
    autoTimer = null
  }
  if (state.autoRefreshMin !== null) {
    autoTimer = setInterval(() => {
      void fetchOverview()
    }, state.autoRefreshMin * 60_000)
  }
}

document.addEventListener('click', (event) => {
  const el = event.target as HTMLElement | null
  const inAuto = el?.closest?.('.auto-refresh-wrap') ?? null
  if (state.autoMenuOpen && !inAuto) {
    state.autoMenuOpen = false
    render()
  }
  const chart = el?.closest?.<SVGSVGElement>('svg[data-trend-metric]') ?? null
  if (chart && chart.isConnected && state.report) {
    const box = chart.getBoundingClientRect()
    const vbX = ((event.clientX - box.left) / box.width) * Number(chart.dataset.vbW)
    const n = Number(chart.dataset.n)
    const idx = Math.min(
      n - 1,
      Math.max(0, Math.floor((vbX - Number(chart.dataset.padL)) / (Number(chart.dataset.plotW) / n)))
    )
    const ts = state.report.buckets[idx]
    const metric = chart.dataset.trendMetric ?? ''
    const model = el?.closest?.<SVGElement>('[data-trend-model]')?.dataset.trendModel ?? null
    if (ts !== undefined) {
      const same = state.trendSelection?.ts === ts && state.trendSelection.metric === metric
      state.trendSelection = same && !model ? null : { ts, metric }
    }
    if (model) {
      state.trendFocus = model
    }
    render()
    return
  }
  const target = (event.target as HTMLElement | null)?.closest<HTMLElement>(
    '[data-action],[data-range],[data-tab],[data-metric],[data-share-mode],[data-models-mode],[data-model-row],[data-auto-min],[data-trend-legend],[data-trend-clear]'
  )
  if (!target) {
    return
  }
  if (target.dataset.trendLegend) {
    state.trendFocus = state.trendFocus === target.dataset.trendLegend ? null : target.dataset.trendLegend
    render()
    return
  }
  if (target.dataset.trendClear) {
    state.trendSelection = null
    render()
    return
  }
  if (target.dataset.action === 'refresh') {
    void fetchOverview(undefined, { forceSync: true })
    return
  }
  if (target.dataset.action === 'auto-refresh') {
    state.autoMenuOpen = !state.autoMenuOpen
    render()
    return
  }
  if (target.dataset.autoMin !== undefined) {
    const raw = target.dataset.autoMin
    const parsed = raw === 'off' ? null : Number.parseInt(raw, 10)
    state.autoRefreshMin =
      parsed === 1 || parsed === 5 || parsed === 10 || parsed === 30 ? parsed : null
    state.autoMenuOpen = false
    applyAutoRefresh()
    saveCached()
    render()
    return
  }
  if (target.dataset.range) {
    void fetchOverview(target.dataset.range as UsageRange)
    return
  }
  if (target.dataset.tab) {
    state.tab = target.dataset.tab as SubTab
    saveCached()
    render()
    return
  }
  if (target.dataset.metric) {
    state.metric = target.dataset.metric as ActivityMetric
    render()
  }
  if (target.dataset.shareMode) {
    state.shareMode = target.dataset.shareMode as ShareChartMode
    render()
  }
  if (target.dataset.modelsMode) {
    state.modelsMode = target.dataset.modelsMode as ModelsTableMode
    saveCached()
    render()
  }
  if (target.dataset.modelRow) {
    const k = target.dataset.modelRow
    state.expandedModelKey = state.expandedModelKey === k ? null : k
    render()
  }
})

function syncTheme(scheme?: 'light' | 'dark'): void {
  const resolved =
    scheme ?? (document.documentElement.classList.contains('light') ? 'light' : 'dark')
  document.documentElement.dataset.theme = resolved
  document.documentElement.classList.toggle('light', resolved === 'light')
  document.documentElement.classList.toggle('dark', resolved === 'dark')
}

syncTheme()

orca.on('theme', (theme) => {
  syncTheme(theme?.colorScheme)
  render()
})
render()
void fetchOverview()

applyAutoRefresh()
