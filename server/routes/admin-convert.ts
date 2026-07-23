import type { Hono } from 'hono'
import { requireAdmin, type AuthVariables } from '../auth-mw.ts'
import {
  getCodecProbeProgress,
  isCodecProbeRunning,
  requestCancelCodecProbe,
  startCodecProbe,
} from '../codec-probe.ts'
import { getConfig } from '../config.ts'
import {
  enqueueConvertForPath,
  requestCancelConvert,
} from '../convert.ts'
import {
  convertJobStats,
  countProbeCoverage,
  getConvertJob,
  listConvertJobs,
  listFilesNeedingConvert,
  updateMediaProbe,
} from '../db.ts'
import { serializeConvertJob } from '../http/serialize.ts'
import { localMediaEnabled } from '../mediafs.ts'
import { clearProbeCache, getStreamInfo } from '../playback.ts'
import { posterUrl } from '../tmdb.ts'

type Vars = { Variables: AuthVariables }

export function registerAdminConvertRoutes(app: Hono<Vars>): void {
  app.get('/api/admin/convert/jobs', (c) => {
    const denied = requireAdmin(c)
    if (denied) return denied
    const limit = Math.min(200, Number(c.req.query('limit') ?? 100) || 100)
    return c.json({
      jobs: listConvertJobs(limit).map((j) => serializeConvertJob(j)),
      stats: convertJobStats(),
      localMediaEnabled: localMediaEnabled(),
      deleteOriginalDefault: getConfig().convertDeleteOriginalDefault,
    })
  })

  app.get('/api/admin/convert/needs', (c) => {
    const denied = requireAdmin(c)
    if (denied) return denied
    const limit = Math.min(500, Number(c.req.query('limit') ?? 200) || 200)
    const files = listFilesNeedingConvert(limit).map((f) => ({
      path: f.path,
      filename: f.filename,
      size: f.size,
      titleId: f.title_id,
      title: f.title,
      kind: f.kind,
      poster: posterUrl(f.poster_path),
      season: f.season,
      episode: f.episode,
      container: f.container ?? null,
      videoCodec: f.video_codec ?? null,
      audioCodec: f.audio_codec ?? null,
      playbackMode: f.playback_mode ?? null,
      canDirect: f.can_direct == null ? null : Boolean(f.can_direct),
      probedAt: f.probed_at ?? null,
      probeError: f.probe_error ?? null,
    }))
    return c.json({ files, localMediaEnabled: localMediaEnabled() })
  })

  app.post('/api/admin/convert/probe', async (c) => {
    const denied = requireAdmin(c)
    if (denied) return denied
    const body =
      (await c.req.json<{ paths?: string[]; limit?: number }>().catch(() => null)) ?? {}
    let paths = body.paths ?? []
    if (!paths.length) {
      paths = listFilesNeedingConvert(body.limit ?? 40).map((f) => f.path)
    }
    const results = []
    for (const path of paths.slice(0, 80)) {
      try {
        clearProbeCache(path)
        const info = await getStreamInfo(path)
        if (info.probeFailed || !info.videoCodec) {
          updateMediaProbe(path, {
            container: info.container,
            videoCodec: info.videoCodec,
            audioCodec: info.audioCodec,
            playbackMode: info.mode,
            canDirect: false,
            probeError: info.probeError || info.reason,
            duration: info.duration,
          })
          results.push({
            path,
            ok: false,
            error: info.probeError || info.reason,
            container: info.container,
            videoCodec: info.videoCodec,
            audioCodec: info.audioCodec,
            mode: info.mode,
          })
          continue
        }
        updateMediaProbe(path, {
          container: info.container,
          videoCodec: info.videoCodec,
          audioCodec: info.audioCodec,
          playbackMode: info.mode,
          canDirect: info.canDirect,
          probeError: null,
          duration: info.duration,
        })
        results.push({ path, ok: true, ...info })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        updateMediaProbe(path, { probeError: msg, canDirect: false, errorOnly: true })
        results.push({ path, ok: false, error: msg })
      }
    }
    return c.json({ probed: results.length, results, localMediaEnabled: localMediaEnabled() })
  })

  /** Start background ffprobe of unprobed (or all) library files for remux/transcode detection. */
  app.post('/api/admin/convert/probe-library', async (c) => {
    const denied = requireAdmin(c)
    if (denied) return denied
    if (isCodecProbeRunning()) {
      return c.json(
        { error: 'Codec probe already running', running: true, status: getCodecProbeProgress() },
        409,
      )
    }
    const body = (await c.req.json<{ force?: boolean }>().catch(() => null)) ?? {}
    try {
      const status = startCodecProbe({ force: Boolean(body.force) })
      return c.json({
        ok: true,
        started: true,
        status,
        coverage: countProbeCoverage(),
        localMediaEnabled: localMediaEnabled(),
      })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Failed to start probe' }, 400)
    }
  })

  app.get('/api/admin/convert/probe-status', (c) => {
    const denied = requireAdmin(c)
    if (denied) return denied
    return c.json({
      running: isCodecProbeRunning(),
      status: getCodecProbeProgress(),
      coverage: countProbeCoverage(),
      localMediaEnabled: localMediaEnabled(),
    })
  })

  app.post('/api/admin/convert/probe-cancel', (c) => {
    const denied = requireAdmin(c)
    if (denied) return denied
    requestCancelCodecProbe()
    return c.json({ ok: true, running: isCodecProbeRunning(), status: getCodecProbeProgress() })
  })

  app.post('/api/admin/convert/enqueue', async (c) => {
    const denied = requireAdmin(c)
    if (denied) return denied
    if (!localMediaEnabled() && !getConfig().localMediaRoot) {
      // Still allow if files resolve as-is on disk
    }
    const body =
      (await c.req
        .json<{
          path?: string
          paths?: string[]
          mode?: 'auto' | 'remux' | 'transcode'
          replaceOriginal?: boolean
          deleteOriginal?: boolean
        }>()
        .catch(() => null)) ?? {}

    const paths = body.paths?.length ? body.paths : body.path ? [body.path] : []
    if (!paths.length) return c.json({ error: 'path or paths required' }, 400)

    const jobs = []
    const errors: string[] = []
    for (const path of paths.slice(0, 100)) {
      try {
        const { job, info } = await enqueueConvertForPath(path, {
          mode: body.mode,
          replaceOriginal: body.replaceOriginal,
          deleteOriginal: body.deleteOriginal,
        })
        jobs.push({ job: serializeConvertJob(job), info })
      } catch (err) {
        errors.push(`${path}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    return c.json({ enqueued: jobs.length, jobs, errors, stats: convertJobStats() })
  })

  app.post('/api/admin/convert/jobs/:id/cancel', (c) => {
    const denied = requireAdmin(c)
    if (denied) return denied
    const id = Number(c.req.param('id'))
    const job = requestCancelConvert(id)
    if (!job) return c.json({ error: 'Not found' }, 404)
    return c.json({ job: serializeConvertJob(job) })
  })

  app.get('/api/admin/convert/jobs/:id', (c) => {
    const denied = requireAdmin(c)
    if (denied) return denied
    const id = Number(c.req.param('id'))
    const job = getConvertJob(id)
    if (!job) return c.json({ error: 'Not found' }, 404)
    return c.json({ job: serializeConvertJob(job) })
  })
}
