// Formatting helpers matching http://127.0.0.1:59127/#/overview?range=24h.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function fmtCompact(n: number): string {
  if (!Number.isFinite(n)) {
    return '0'
  }
  const abs = Math.abs(n)
  if (abs >= 1_000_000_000) {
    return `${(n / 1_000_000_000).toFixed(abs >= 10_000_000_000 ? 0 : 1).replace(/\.0$/, '')}B`
  }
  if (abs >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1).replace(/\.0$/, '')}M`
  }
  if (abs >= 1_000) {
    return `${(n / 1_000).toFixed(abs >= 10_000 ? 0 : 1).replace(/\.0$/, '')}K`
  }
  return Math.round(n).toLocaleString('en-US')
}

export function fmtInt(n: number): string {
  if (!Number.isFinite(n)) {
    return '0'
  }
  return Math.round(n).toLocaleString('en-US')
}

export function fmtCost(cost: number, unpricedRequests = 0, decimals?: number): string {
  if (cost === 0 && unpricedRequests > 0) {
    return 'N/A'
  }
  const d = decimals !== undefined ? decimals : cost > 0 && cost < 0.01 ? 4 : 2
  return `$${cost.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`
}

export function fmtPct(ratio: number, decimals = 1): string {
  if (!Number.isFinite(ratio)) {
    return '0.0%'
  }
  return `${(ratio * 100).toFixed(decimals)}%`
}

export function fmtErrorRate(ratio: number): string {
  const pct = ratio * 100
  if (pct > 0 && pct < 0.005) {
    return '<0.01%'
  }
  return fmtPct(ratio, pct > 0 && pct < 0.1 ? 2 : 1)
}

export function fmtErrorTone(rate: number): 'ok' | 'warn' | 'bad' {
  if (rate >= 0.05) {
    return 'bad'
  }
  if (rate >= 0.01) {
    return 'warn'
  }
  return 'ok'
}

export function renderErrorPill(failed: number, rate: number): string {
  if (failed === 0) {
    return '<span class="num dim">0%</span>'
  }
  const tone = fmtErrorTone(rate)
  return `<span class="badge" data-tone="${tone}">${fmtErrorRate(rate)}</span>`
}

export function fmtLatency(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) {
    return '–'
  }
  const s = ms / 1_000
  const d = s < 1 ? 2 : 1
  return `${s.toFixed(d)}s`
}

export function fmtTps(tps: number | null): string {
  if (tps === null || !Number.isFinite(tps)) {
    return '–'
  }
  return tps.toFixed(1)
}

export function fmtAgo(ts: number): string {
  const sec = Math.max(0, Math.round((Date.now() - ts) / 1_000))
  if (sec < 45) {
    return 'just now'
  }
  const min = Math.round(sec / 60)
  if (min < 60) {
    return `${min}m ago`
  }
  const hr = Math.round(min / 60)
  if (hr < 24) {
    return `${hr}h ago`
  }
  return `${Math.round(hr / 24)}d ago`
}

export function fmtBucketTick(ts: number, bucketMs: number): string {
  const d = new Date(ts)
  if (bucketMs < 86_400_000) {
    const h = String(d.getHours()).padStart(2, '0')
    const m = String(d.getMinutes()).padStart(2, '0')
    return `${h}:${m}`
  }
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`
}
