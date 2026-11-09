// Controller for the OMP Stats sidebar panel (Overview + Models sub-tabs).
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
}

const STORAGE_KEY = 'omp-stats-overview.v3'

function loadCached(): {
  range: UsageRange
  tab: SubTab
  modelsMode: ModelsTableMode
  report: OverviewReport | null
} {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return { range: '24h', tab: 'models', modelsMode: 'compact', report: null }
    }
    const parsed = JSON.parse(raw) as {
      range?: UsageRange
      tab?: SubTab
      modelsMode?: ModelsTableMode
      report?: OverviewReport
    }
    return {
      range: parsed.range ?? '24h',
      tab: parsed.tab ?? 'models',
      modelsMode: parsed.modelsMode ?? 'compact',
      report: parsed.report ?? null
    }
  } catch {
    return { range: '24h', tab: 'models', modelsMode: 'compact', report: null }
  }
}

function saveCached(
  range: UsageRange,
  tab: SubTab,
  modelsMode: ModelsTableMode,
  report: OverviewReport | null
): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ range, tab, modelsMode, report }))
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
  report: cached.report
}

function render(): void {
  const root = document.getElementById('root')
  if (!root) {
    return
  }
  const { range, tab, metric, shareMode, modelsMode, expandedModelKey, report, loading, error } =
    state
  let html = renderTopHeader(range, tab, report, loading)

  if (error) {
    html += `<div class="card"><div class="empty">${esc(error)}</div></div>`
  }

  if (!report) {
    html += `<div class="card"><div class="empty">${loading ? 'Loading stats…' : 'No data available'}</div></div>`
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

async function fetchOverview(nextRange?: UsageRange): Promise<void> {
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
    const answer = await orca.plugin.request(
      'usage.overview',
      { range: targetRange },
      { timeoutMs: 30_000 }
    )
    state.report = answer
    saveCached(targetRange, state.tab, state.modelsMode, answer)
  } catch (cause) {
    state.error = cause instanceof Error ? cause.message : String(cause)
  } finally {
    state.loading = false
    render()
  }
}

document.addEventListener('click', (event) => {
  const target = (event.target as HTMLElement | null)?.closest<HTMLElement>(
    '[data-action],[data-range],[data-tab],[data-metric],[data-share-mode],[data-models-mode],[data-model-row]'
  )
  if (!target) {
    return
  }
  if (target.dataset.action === 'refresh') {
    void fetchOverview()
    return
  }
  if (target.dataset.range) {
    void fetchOverview(target.dataset.range as UsageRange)
    return
  }
  if (target.dataset.tab) {
    state.tab = target.dataset.tab as SubTab
    saveCached(state.range, state.tab, state.modelsMode, state.report)
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
    saveCached(state.range, state.tab, state.modelsMode, state.report)
    render()
  }
  if (target.dataset.modelRow) {
    const k = target.dataset.modelRow
    state.expandedModelKey = state.expandedModelKey === k ? null : k
    render()
  }
})

orca.on('theme', () => {
  render()
})

render()
void fetchOverview()
