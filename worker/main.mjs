// Worker entry for the OMP Stats Overview plugin.
import { queryOverviewReport } from './omp-stats-db.mjs'

/** @type {import('orca/worker').Activate} */
export default async function activate(orca) {
  orca.panels.handle('usage.overview', async ({ range }) =>
    queryOverviewReport({ range: range ?? '24h' })
  )
}
