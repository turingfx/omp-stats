// Renders the Token mix & By agent breakdown card and the Latest requests table card.
import { fmtAgo, fmtCompact, fmtCost, fmtInt, fmtLatency, fmtPct } from './format'
import { esc } from './overview-cards'
import type { AgentTypeRow, OverviewReport } from './protocol'

const MIX_SPEC = [
  { key: 'input' as const, label: 'Uncached input', color: '#5b8cff' },
  { key: 'cacheRead' as const, label: 'Cache read', color: 'var(--chart-primary)' },
  { key: 'cacheWrite' as const, label: 'Cache write', color: '#f5b54a' },
  { key: 'output' as const, label: 'Output', color: 'var(--chart-secondary)' }
]

const AGENT_LABELS: Record<string, string> = {
  main: 'Main agent',
  subagent: 'Subagents',
  advisor: 'Advisor'
}

const AGENT_COLORS: Record<string, string> = {
  main: 'var(--chart-primary)',
  subagent: 'var(--chart-secondary)',
  advisor: '#9d7bff'
}

export function renderTokenMixCard(report: OverviewReport): string {
  const p = report.overall
  const mix = {
    input: p.totalInputTokens,
    cacheRead: p.totalCacheReadTokens,
    cacheWrite: p.totalCacheWriteTokens,
    output: p.totalOutputTokens
  }
  const convTokens = mix.input + mix.cacheRead + mix.cacheWrite + mix.output

  const byType = new Map<string, AgentTypeRow>()
  for (const row of report.byAgentType) {
    byType.set(row.agentType, row)
  }
  const agentOrder: ('main' | 'subagent' | 'advisor')[] = ['main', 'subagent', 'advisor']
  const agentRows = agentOrder
    .map((key) => {
      const found = byType.get(key)
      if (!found && key === 'advisor') {
        return null
      }
      const tokens = found
        ? found.totalInputTokens +
          found.totalOutputTokens +
          found.totalCacheReadTokens +
          found.totalCacheWriteTokens
        : 0
      return {
        agentType: key,
        requests: found?.totalRequests ?? 0,
        tokens,
        share: convTokens > 0 ? tokens / convTokens : 0
      }
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)

  return `
    <section class="card">
      <div class="card-header">
        <div class="card-titles">
          <h2 class="card-title">Token mix</h2>
          <p class="card-description">Where conversation tokens went</p>
        </div>
      </div>
      <div class="card-body">
        <div class="stack" style="gap: 16px">
          <div class="stack" style="gap: 9px">
            <div class="share-bar">
              ${MIX_SPEC.filter((s) => mix[s.key] > 0)
                .map(
                  (s) =>
                    `<div class="share-bar-seg" style="flex-grow:${mix[s.key] / Math.max(1, convTokens)};background:${s.color}" title="${esc(`${s.label}: ${fmtPct(mix[s.key] / Math.max(1, convTokens))}`)}"></div>`
                )
                .join('')}
            </div>
            <div class="legend-grid">
              ${MIX_SPEC.map(
                (s) => `
                  <span class="legend-item">
                    <span class="swatch" style="background:${s.color}"></span>
                    <span>${s.label}</span>
                    <span class="dim num">${convTokens > 0 ? fmtPct(mix[s.key] / convTokens, 0) : '–'}</span>
                  </span>
                `
              ).join('')}
            </div>
          </div>

          <div class="stack" style="gap: 9px">
            <div class="section-label">By agent</div>
            <div class="share-bar">
              ${agentRows
                .filter((a) => a.tokens > 0)
                .map(
                  (a) =>
                    `<div class="share-bar-seg" style="flex-grow:${a.share};background:${AGENT_COLORS[a.agentType]}" title="${esc(`${AGENT_LABELS[a.agentType]}: ${fmtPct(a.share)}`)}"></div>`
                )
                .join('')}
            </div>
            ${agentRows
              .map(
                (a) => `
                  <div class="agent-row">
                    <span class="row">
                      <span class="swatch" style="background:${AGENT_COLORS[a.agentType]}"></span>
                      <span>${AGENT_LABELS[a.agentType]}</span>
                      <span class="dim num">${fmtInt(a.requests)} req</span>
                    </span>
                    <span class="row">
                      <span class="dim num">${fmtCompact(a.tokens)}</span>
                      <span class="num" style="min-width: 44px; text-align: right">${fmtPct(a.share)}</span>
                    </span>
                  </div>
                `
              )
              .join('')}
          </div>
        </div>
      </div>
    </section>
  `
}

export function renderLatestRequestsCard(report: OverviewReport): string {
  const rows = report.recentRequests

  return `
    <section class="card">
      <div class="card-header">
        <div class="card-titles">
          <h2 class="card-title">
            <span class="dot" data-tone="live" data-pulse="true"></span>
            <span>Latest requests</span>
          </h2>
          <p class="card-description">Most recent model calls across every session</p>
        </div>
      </div>
      <div class="card-body" data-flush="true">
        ${
          rows.length === 0
            ? `<div class="empty">No requests recorded yet.</div>`
            : `
          <table class="table">
            <colgroup>
              <col style="width: 39%" />
              <col style="width: 21%" />
              <col style="width: 23%" />
              <col style="width: 17%" />
            </colgroup>
            <thead>
              <tr>
                <th>Model</th>
                <th>When</th>
                <th class="right">Tokens / Cost</th>
                <th class="right">Status</th>
              </tr>
            </thead>
            <tbody>
              ${rows
                .map((r) => {
                  const unpriced =
                    r.totalTokens > 0 &&
                    r.costTotal === 0 &&
                    (r.provider === 'xai-oauth' || r.costUnpriced)
                  const costStr = fmtCost(r.costTotal, unpriced ? 1 : 0, 4)
                  const failed = Boolean(r.errorMessage) || r.stopReason === 'error'
                  return `
                    <tr>
                      <td title="${esc(`${r.provider}/${r.model}`)}">
                        <div class="mono cell-primary">${esc(r.model)}</div>
                        <div class="cell-secondary">${esc(r.provider)}</div>
                      </td>
                      <td>
                        <div class="muted" style="font-size: 11px">${esc(fmtAgo(r.timestamp))}</div>
                        <div class="cell-secondary num">${esc(fmtLatency(r.duration))}</div>
                      </td>
                      <td class="right">
                        <div class="num cell-primary">${fmtInt(r.totalTokens)}</div>
                        <div class="cell-secondary num">${esc(costStr)}</div>
                      </td>
                      <td class="right">
                        <span class="badge" data-tone="${failed ? 'bad' : 'ok'}">${failed ? 'Failed' : 'OK'}</span>
                      </td>
                    </tr>
                  `
                })
                .join('')}
            </tbody>
          </table>
        `
        }
      </div>
    </section>
  `
}
