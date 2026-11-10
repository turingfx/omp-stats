// Renders the All models table in two aesthetic modes:
// 1. Compact (default for narrow sidebar): 5 columns showing Model, Errors (color badge, no histogram),
//    Tokens / Cache rate, Speed · TTFT, and Trend (mini sparkline line chart).
// 2. Full Table (wide mode): all 10 columns from Image 2 in a smooth horizontal scroll wrapper.
import { fmtCompact, fmtCost, fmtInt, fmtLatency, fmtPct, fmtTps, renderErrorPill } from './format'
import { modelKey, renderExpandedModelDetail } from './models-detail'
import { esc, renderSparkline } from './overview-cards'
import type { ModelStatsRow, ModelsTableMode, OverviewReport } from './protocol'

function renderCompactRows(
  models: ModelStatsRow[],
  swatches: Map<string, string>,
  modelTrendMap: Map<string, Map<number, number>>,
  expandedModelKey: string | null,
  report: OverviewReport
): string {
  return models
    .map((m, idx) => {
      const k = modelKey(m)
      const color = swatches.get(k) ?? 'var(--palette-0)'
      const isOpen = expandedModelKey === k
      const conv =
        m.totalInputTokens + m.totalOutputTokens + m.totalCacheReadTokens + m.totalCacheWriteTokens
      const tMap = modelTrendMap.get(k)
      const trendVals = report.buckets.map((b) => tMap?.get(b) ?? 0)
      const speedStr = m.avgTokensPerSecond !== null ? `${fmtTps(m.avgTokensPerSecond)}/s` : '–'
      const ttftStr = m.avgTtft !== null ? fmtLatency(m.avgTtft) : '–'

      return `
        <tr class="clickable-row" data-model-row="${esc(k)}">
          <td title="${esc(`${m.model} (${m.provider}) · ${fmtInt(m.totalRequests)} requests`)}">
            <div class="row" style="gap: 5px">
              <span class="models-chevron" data-open="${isOpen}">▸</span>
              <span class="swatch" style="background:${color}"></span>
              <span class="mono cell-primary truncate" style="max-width: 108px">${esc(m.model)}</span>
            </div>
            <div class="cell-secondary truncate" style="padding-left: 21px; max-width: 108px">
              ${esc(m.provider)} · ${fmtInt(m.totalRequests)}
            </div>
          </td>
          <td class="right">
            ${renderErrorPill(m.failedRequests, m.errorRate)}
          </td>
          <td class="right">
            <div class="num cell-primary" style="font-weight: 600">${fmtCompact(conv)}</div>
            <div class="cell-secondary num">${fmtPct(m.cacheRate)}</div>
          </td>
          <td class="right">
            <div class="num cell-primary" style="font-weight: 600">${speedStr}</div>
            <div class="cell-secondary num">${ttftStr}</div>
          </td>
          <td class="right" style="padding-left: 4px; padding-right: 10px">
            ${renderSparkline(trendVals, color, `tr-c-${idx}`)}
          </td>
        </tr>
        ${
          isOpen
            ? `<tr class="detail-row"><td colspan="5">${renderExpandedModelDetail(m, color, report)}</td></tr>`
            : ''
        }
      `
    })
    .join('')
}

function renderFullRows(
  models: ModelStatsRow[],
  swatches: Map<string, string>,
  maxRequests: number,
  modelTrendMap: Map<string, Map<number, number>>,
  expandedModelKey: string | null,
  report: OverviewReport
): string {
  return models
    .map((m, idx) => {
      const k = modelKey(m)
      const color = swatches.get(k) ?? 'var(--palette-0)'
      const isOpen = expandedModelKey === k
      const conv =
        m.totalInputTokens + m.totalOutputTokens + m.totalCacheReadTokens + m.totalCacheWriteTokens
      const tMap = modelTrendMap.get(k)
      const trendVals = report.buckets.map((b) => tMap?.get(b) ?? 0)
      const reqPct = Math.max(4, Math.round((m.totalRequests / maxRequests) * 100))
      const speedStr = m.avgTokensPerSecond !== null ? fmtTps(m.avgTokensPerSecond) : '–'
      const ttftStr = m.avgTtft !== null ? fmtLatency(m.avgTtft) : '–'

      return `
        <tr class="clickable-row" data-model-row="${esc(k)}">
          <td style="width: 22px; padding-right: 0">
            <span class="models-chevron" data-open="${isOpen}">▸</span>
          </td>
          <td title="${esc(`${m.model} (${m.provider})`)}">
            <div class="row" style="gap: 6px">
              <span class="swatch" style="background:${color}"></span>
              <span class="mono cell-primary">${esc(m.model)}</span>
            </div>
            <div class="cell-secondary" style="padding-left: 14px">${esc(m.provider)}</div>
          </td>
          <td class="right">
            <div class="num cell-primary">${fmtInt(m.totalRequests)}</div>
            <div class="meter"><div class="meter-fill" style="width:${reqPct}%;background:${color}"></div></div>
          </td>
          <td class="right">
            <span class="num cell-primary">${fmtCost(m.totalCost, m.unpricedRequests)}</span>
          </td>
          <td class="right">
            <span class="num cell-primary" style="font-weight: 600">${fmtCompact(conv)}</span>
          </td>
          <td class="right">
            <span class="num cell-secondary">${fmtPct(m.cacheRate)}</span>
          </td>
          <td class="right">
            ${renderErrorPill(m.failedRequests, m.errorRate)}
          </td>
          <td class="right">
            <span class="num cell-primary">${speedStr}</span>
          </td>
          <td class="right">
            <span class="num cell-secondary">${ttftStr}</span>
          </td>
          <td style="padding-left: 10px">
            ${renderSparkline(trendVals, color, `tr-f-${idx}`)}
          </td>
        </tr>
        ${
          isOpen
            ? `<tr class="detail-row"><td colspan="10">${renderExpandedModelDetail(m, color, report)}</td></tr>`
            : ''
        }
      `
    })
    .join('')
}

export function renderAllModelsCard(
  report: OverviewReport,
  mode: ModelsTableMode,
  expandedModelKey: string | null,
  swatches: Map<string, string>,
  maxRequests: number,
  modelTrendMap: Map<string, Map<number, number>>
): string {
  const models = report.byModel

  return `
    <section class="card">
      <div class="card-header">
        <div class="card-titles">
          <h2 class="card-title">All models</h2>
          <p class="card-description">Click a row for latency and throughput over time</p>
        </div>
        <div class="segmented" data-size="sm">
          <button class="segmented-option" data-active="${mode === 'compact'}" data-models-mode="compact">Compact</button>
          <button class="segmented-option" data-active="${mode === 'full'}" data-models-mode="full">Full table</button>
        </div>
      </div>
      <div class="card-body" data-flush="true">
        ${
          mode === 'compact'
            ? `
          <table class="table">
            <colgroup>
              <col style="width: 32%" />
              <col style="width: 14%" />
              <col style="width: 18%" />
              <col style="width: 18%" />
              <col style="width: 18%" />
            </colgroup>
            <thead>
              <tr>
                <th>Model</th>
                <th class="right">Errors</th>
                <th class="right">Tokens</th>
                <th class="right" title="Tokens/s and TTFT">Speed</th>
                <th class="right" style="padding-right: 10px">Trend</th>
              </tr>
            </thead>
            <tbody>
              ${renderCompactRows(models, swatches, modelTrendMap, expandedModelKey, report)}
            </tbody>
          </table>
        `
            : `
          <div class="table-wrap">
            <table class="table" style="min-width: 620px">
              <thead>
                <tr>
                  <th style="width: 22px"></th>
                  <th style="width: 140px">Model</th>
                  <th class="right" style="width: 75px">Requests</th>
                  <th class="right" style="width: 60px">Cost</th>
                  <th class="right" style="width: 65px">Tokens</th>
                  <th class="right" style="width: 68px">Cache rate</th>
                  <th class="right" style="width: 65px">Errors</th>
                  <th class="right" style="width: 65px">Tokens/s</th>
                  <th class="right" style="width: 60px">TTFT</th>
                  <th style="width: 80px">Trend</th>
                </tr>
              </thead>
              <tbody>
                ${renderFullRows(models, swatches, maxRequests, modelTrendMap, expandedModelKey, report)}
              </tbody>
            </table>
          </div>
        `
        }
      </div>
    </section>
  `
}
