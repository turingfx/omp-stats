// Worker entry for the OMP Stats Overview plugin.
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { queryOverviewReport } from './omp-stats-db.mjs'

const MIN_SYNC_INTERVAL_MS = 15_000
let lastSyncTime = 0
let currentSyncPromise = null

function resolveOmpBin() {
  const candidates = [
    join(homedir(), '.bun', 'bin', 'omp'),
    join(homedir(), '.local', 'bin', 'omp'),
    '/usr/local/bin/omp',
    'omp'
  ]
  return candidates.find((c) => c === 'omp' || existsSync(c)) ?? 'omp'
}

async function syncStats({ force = false } = {}) {
  const now = Date.now()
  if (currentSyncPromise) {
    return currentSyncPromise
  }
  if (!force && now - lastSyncTime < MIN_SYNC_INTERVAL_MS) {
    return
  }

  const bin = resolveOmpBin()
  currentSyncPromise = new Promise((resolve) => {
    execFile(bin, ['stats', '-s'], { timeout: 4000 }, (err) => {
      if (err) {
        console.warn('[omp-stats] Background sync error:', err.message)
      }
      lastSyncTime = Date.now()
      resolve()
    })
  }).finally(() => {
    currentSyncPromise = null
  })

  return currentSyncPromise
}

/** @type {import('orca/worker').Activate} */
export default async function activate(orca) {
  orca.panels.handle('usage.overview', async (data) => {
    await syncStats({ force: Boolean(data?.forceSync) })
    return queryOverviewReport({ range: data?.range ?? '24h' })
  })
}
