import { request, sleep } from './client'
import type { ScanResult, ScanStatusResponse } from './types'

export const scanApi = {
  diagnostics: () =>
    request<{
      config: {
        webdavHost: string
        webdavUrlSet: boolean
        webdavUserSet: boolean
        webdavPasswordSet: boolean
        mediaRoot: string
        mediaRoots?: string[]
        localMediaRoot?: string | null
        localMediaEnabled?: boolean
        tmdbKeySet: boolean
        scanIntervalMinutes?: number
        scanIgnore?: string[]
      }
      scanSource: 'local' | 'webdav'
      local: {
        ok: boolean
        localMediaRoot: string | null
        resolvedPath: string | null
        topEntries: Array<{ type: string; name: string }>
        mediaRootFolders: Array<{ root: string; path: string; exists: boolean }>
        error?: string
      }
      webdav: {
        ok: boolean
        skipped?: boolean
        mediaRoot: string
        rootEntries: Array<{ type: string; name: string }>
        mediaEntries: Array<{ type: string; name: string }>
        error?: string
      }
      playback: { ffmpegAvailable: boolean; localMediaEnabled?: boolean }
      scan?: ScanStatusResponse
    }>('/api/diagnostics'),
  scanStart: () =>
    request<{ ok: boolean; started: boolean } & ScanStatusResponse>('/api/scan', {
      method: 'POST',
    }),
  scanStatus: () => request<ScanStatusResponse>('/api/scan/status'),
  /** @deprecated Prefer runScan() — kept for callers that expect the old sync shape */
  scan: () => scanApi.runScan(),
  runScan: async (onUpdate?: (status: ScanStatusResponse) => void): Promise<ScanResult> => {
    const kickedOffAt = Date.now()
    let scanStartedAt: string | null = null
    try {
      const started = await scanApi.scanStart()
      onUpdate?.(started)
      scanStartedAt = started.status?.startedAt ?? null
    } catch (err) {
      // Another scan is already running — attach and poll
      const msg = err instanceof Error ? err.message : String(err)
      if (!msg.toLowerCase().includes('already running')) throw err
      const status = await scanApi.scanStatus()
      onUpdate?.(status)
      scanStartedAt = status.status?.startedAt ?? null
    }

    const deadline = Date.now() + 60 * 60 * 1000
    while (Date.now() < deadline) {
      await sleep(1000)
      const status = await scanApi.scanStatus()
      onUpdate?.(status)
      const phase = status.status?.phase
      if (!status.running && (phase === 'done' || phase === 'error' || !phase)) {
        if (phase === 'error') {
          throw new Error(status.status?.message || 'Scan failed')
        }
        // Ignore a stale "done" snapshot from before this scan was kicked off
        const statusStarted = status.status?.startedAt
        if (
          scanStartedAt &&
          statusStarted &&
          statusStarted < scanStartedAt &&
          Date.now() - kickedOffAt < 8000
        ) {
          continue
        }
        if (status.lastResult) return status.lastResult
        if (phase === 'done') {
          return {
            filesFound: status.status?.filesFound ?? 0,
            matched: status.status?.matched ?? 0,
            unmatched: status.status?.unmatched ?? 0,
            titles: 0,
            files: 0,
            dirsScanned: status.status?.dirsScanned,
            mediaRoot: status.status?.mediaRoot,
            errors: status.status?.errors,
            source: status.status?.source,
            warning: status.status?.message?.includes('0 video')
              ? status.status.message
              : undefined,
          }
        }
        throw new Error(status.status?.message || 'Scan ended without a result')
      }
    }
    throw new Error('Scan timed out waiting for completion')
  },
}
