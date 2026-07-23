import { getConfig, reloadConfig } from './config.ts'
import { getScanMeta, setScanMeta } from './db.ts'
import { withScanLock, isScanRunning } from './scan-lock.ts'
import { scanLibrary } from './scanner.ts'

let timer: ReturnType<typeof setInterval> | null = null

export function startScanScheduler(): void {
  if (timer) return
  timer = setInterval(() => {
    void tickScan()
  }, 60_000)
  setTimeout(() => void tickScan(), 15_000)
  console.log('Scan scheduler started (checks every 60s)')
}

async function tickScan(): Promise<void> {
  reloadConfig()
  const minutes = getConfig().scanIntervalMinutes
  if (minutes <= 0 || isScanRunning()) return

  const last = getScanMeta('last_scan')
  const lastMs = last ? Date.parse(last) : 0
  const due = !lastMs || Date.now() - lastMs >= minutes * 60_000
  if (!due) return

  try {
    console.log(`Scheduled scan starting (interval ${minutes}m)…`)
    // scanLibrary writes scan_status / scan_progress; keep a thin wrapper for logs
    const result = await withScanLock(() => scanLibrary())
    setScanMeta(
      'last_scheduled_scan',
      JSON.stringify({
        at: new Date().toISOString(),
        filesFound: result.filesFound,
        source: result.source,
      }),
    )
    console.log('Scheduled scan finished:', result.filesFound, 'files', `(${result.source})`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('already running')) return
    setScanMeta('scan_status', 'error')
    setScanMeta('last_scheduled_scan_error', msg)
    console.error('Scheduled scan failed:', err)
  }
}
