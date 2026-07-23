import type { Hono } from 'hono'
import { requireAdmin, type AuthVariables } from '../auth-mw.ts'
import { getConfig, publicConfigSummary, reloadConfig } from '../config.ts'
import { convertJobStats } from '../db.ts'
import { localMediaEnabled, probeLocalMedia } from '../mediafs.ts'
import { ffmpegAvailable } from '../playback.ts'
import { isScanRunning, withScanLock } from '../scan-lock.ts'
import { readLastScanResult, readScanProgress, scanLibrary } from '../scanner.ts'
import { probeWebdav } from '../webdav.ts'

type Vars = { Variables: AuthVariables }

function scanStatusPayload() {
  const running = isScanRunning()
  const status = readScanProgress()
  const lastResult = readLastScanResult()
  return { running, status, lastResult }
}

export function registerScanRoutes(app: Hono<Vars>): void {
  app.get('/api/diagnostics', async (c) => {
    const denied = requireAdmin(c)
    if (denied) return denied
    reloadConfig()
    const summary = publicConfigSummary()
    const localProbe = await probeLocalMedia()
    const useLocalScan = localMediaEnabled()
    // When local scan source is active, skip WebDAV probe (still expose config for playback fallback)
    const webdav = useLocalScan
      ? {
          ok: false,
          skipped: true as const,
          mediaRoot: summary.mediaRoot,
          rootEntries: [] as Array<{ type: string; name: string }>,
          mediaEntries: [] as Array<{ type: string; name: string }>,
          error: 'Skipped — library scan uses LOCAL_MEDIA_ROOT',
        }
      : await probeWebdav()
    return c.json({
      config: summary,
      scanSource: useLocalScan ? 'local' : 'webdav',
      local: localProbe,
      webdav,
      playback: {
        ffmpegAvailable: ffmpegAvailable(),
        localMediaEnabled: localMediaEnabled(),
      },
      convert: convertJobStats(),
      scan: scanStatusPayload(),
    })
  })

  app.get('/api/scan/status', (c) => {
    const denied = requireAdmin(c)
    if (denied) return denied
    return c.json(scanStatusPayload())
  })

  app.post('/api/scan', async (c) => {
    const denied = requireAdmin(c)
    if (denied) return denied
    reloadConfig()

    if (isScanRunning()) {
      return c.json(
        { error: 'A library scan is already running', ...scanStatusPayload() },
        409,
      )
    }

    const cfg = getConfig()
    if (!cfg.tmdbApiKey) {
      return c.json(
        {
          error: 'TMDB_API_KEY is missing in .env — add a key, then scan again',
          ...scanStatusPayload(),
        },
        400,
      )
    }

    console.log('Scan starting with config:', publicConfigSummary())
    // Fire-and-forget under lock so proxies/browsers don't time out on large libraries
    void withScanLock(async () => {
      try {
        const result = await scanLibrary()
        console.log('Scan finished:', {
          filesFound: result.filesFound,
          titles: result.titles,
          mediaRoot: result.mediaRoot,
          source: result.source,
          preservedOverrides: result.preservedOverrides,
          warning: result.warning,
        })
      } catch (err) {
        console.error('Scan failed:', err)
      }
    }).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err)
      if (!msg.includes('already running')) {
        console.error('Scan lock error:', err)
      }
    })

    // Tiny yield so scan_progress is usually written before the response
    await new Promise((r) => setTimeout(r, 50))
    return c.json({ ok: true, started: true, ...scanStatusPayload() })
  })
}
