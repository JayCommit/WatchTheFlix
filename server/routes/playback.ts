import type { Hono } from 'hono'
import { requireAuth, type AuthVariables } from '../auth-mw.ts'
import {
  getMediaFileByPath,
  getPlaybackSession,
  getProgress,
  getTitleById,
  insertActivityEvent,
  upsertPlaybackSession,
  upsertProgress,
} from '../db.ts'
import { serializeNowPlaying } from '../http/serialize.ts'
import {
  ffmpegAvailable,
  resolvePlaybackMode,
  startCompatStream,
  streamLocalFile,
} from '../playback.ts'
import { listExternalSubtitles } from '../subs.ts'
import { contentTypeFor, streamFile } from '../webdav.ts'

type Vars = { Variables: AuthVariables }

export function registerPlaybackRoutes(app: Hono<Vars>): void {
  app.post('/api/playback/heartbeat', async (c) => {
    const denied = requireAuth(c)
    if (denied) return denied
    const body = await c.req
      .json<{
        clientId?: string
        path?: string
        titleId?: number
        position?: number
        duration?: number
        state?: 'playing' | 'paused' | 'stopped'
        playbackMode?: string
      }>()
      .catch(() => null)
    if (!body?.clientId?.trim() || !body.path || typeof body.position !== 'number') {
      return c.json({ error: 'clientId, path, and position required' }, 400)
    }
    const state =
      body.state === 'paused' || body.state === 'stopped' || body.state === 'playing'
        ? body.state
        : 'playing'
    const file = getMediaFileByPath(body.path)
    const titleId = body.titleId ?? file?.title_id ?? null
    const title = titleId != null ? getTitleById(titleId) : undefined
    const ua = c.req.header('user-agent') ?? null
    const ip =
      c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
      c.req.header('x-real-ip') ||
      null

    const prev = getPlaybackSession(body.clientId.trim())
    const session = upsertPlaybackSession({
      clientId: body.clientId.trim(),
      path: body.path,
      titleId,
      titleName: title?.title ?? null,
      season: file?.season ?? null,
      episode: file?.episode ?? null,
      position: body.position,
      duration: body.duration ?? 0,
      playbackMode: body.playbackMode ?? null,
      state,
      userAgent: ua,
      ip,
    })

    const pathChanged = !prev || prev.path !== body.path
    const becameActive =
      state === 'playing' && (!prev || prev.state !== 'playing' || pathChanged)
    if (becameActive) {
      insertActivityEvent({
        clientId: body.clientId.trim(),
        path: body.path,
        titleId,
        titleName: title?.title ?? null,
        season: file?.season ?? null,
        episode: file?.episode ?? null,
        position: body.position,
        duration: body.duration ?? 0,
        eventType: pathChanged || !prev ? 'started' : 'resumed',
        detail: body.playbackMode ?? null,
      })
    } else if (state === 'paused' && prev?.state === 'playing') {
      insertActivityEvent({
        clientId: body.clientId.trim(),
        path: body.path,
        titleId,
        titleName: title?.title ?? null,
        season: file?.season ?? null,
        episode: file?.episode ?? null,
        position: body.position,
        duration: body.duration ?? 0,
        eventType: 'paused',
      })
    } else if (state === 'stopped' && prev && prev.state !== 'stopped') {
      insertActivityEvent({
        clientId: body.clientId.trim(),
        path: body.path,
        titleId,
        titleName: title?.title ?? null,
        season: file?.season ?? null,
        episode: file?.episode ?? null,
        position: body.position,
        duration: body.duration ?? 0,
        eventType: 'stopped',
      })
    }

    return c.json({
      ok: true,
      session: serializeNowPlaying({
        ...session,
        status:
          state === 'stopped'
            ? 'stopped'
            : state === 'paused'
              ? 'paused'
              : 'watching',
        idleSeconds: 0,
        poster_path: title?.poster_path ?? null,
        kind: title?.kind ?? null,
        filename: file?.filename ?? null,
      }),
    })
  })

  app.get('/api/stream/info', async (c) => {
    const denied = requireAuth(c)
    if (denied) return denied
    const path = c.req.query('path')
    if (!path || path.includes('..')) {
      return c.json({ error: 'Invalid path' }, 400)
    }
    try {
      const audioIndex = Number(c.req.query('audio') ?? 0) || 0
      const info = await resolvePlaybackMode(path, c.req.query('mode'), { audioIndex })
      const external = listExternalSubtitles(path)
      return c.json({
        ...info,
        subtitleTracks: [...external, ...info.subtitleTracks],
        ffmpegAvailable: ffmpegAvailable(),
      })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Probe failed' }, 500)
    }
  })

  app.get('/api/stream', async (c) => {
    const denied = requireAuth(c)
    if (denied) return denied

    const path = c.req.query('path')
    if (!path || path.includes('..')) {
      return c.json({ error: 'Invalid path' }, 400)
    }

    try {
      const requestedMode = c.req.query('mode')
      const startRaw = c.req.query('t')
      const startSeconds = startRaw ? Math.max(0, Number(startRaw)) : 0
      const audioIndex = Math.max(0, Number(c.req.query('audio') ?? 0) || 0)
      const info = await resolvePlaybackMode(path, requestedMode, { audioIndex })
      if (info.audioTracks.length && audioIndex >= info.audioTracks.length) {
        return c.json({ error: `Invalid audio track index ${audioIndex}` }, 400)
      }
      const audioCodec =
        info.audioTracks[audioIndex]?.codec ?? info.audioCodec

      if (info.mode === 'remux' || info.mode === 'transcode') {
        if (!ffmpegAvailable()) {
          return c.json(
            {
              error:
                'This file needs FFmpeg remux/transcode but FFmpeg is not available. Reinstall dependencies (ffmpeg-static).',
            },
            503,
          )
        }
        const audioAbs =
          info.audioTracks[audioIndex]?.streamIndex ?? info.audioStreamIndex ?? null
        const { response } = startCompatStream(path, info.mode, {
          startSeconds: Number.isFinite(startSeconds) ? startSeconds : 0,
          audioCodec,
          audioIndex,
          videoStreamIndex: info.videoStreamIndex,
          audioStreamIndex: audioAbs,
          signal: c.req.raw.signal,
        })
        // Header values must be ASCII ByteStrings
        response.headers.set('X-Playback-Reason', info.reason.replace(/[^\x20-\x7E]/g, ' '))
        return response
      }

      const range = c.req.header('range')
      const localResponse = streamLocalFile(path, range)
      if (localResponse) return localResponse

      const upstream = await streamFile(path, range)
      const filename = path.split('/').pop() || 'video'
      const headers = new Headers()

      const pass = [
        'content-type',
        'content-length',
        'content-range',
        'accept-ranges',
        'etag',
        'last-modified',
      ]
      for (const key of pass) {
        const v = upstream.headers.get(key)
        if (v) headers.set(key, v)
      }
      if (!headers.has('content-type')) {
        headers.set('content-type', contentTypeFor(filename))
      }
      if (!headers.has('accept-ranges')) {
        headers.set('accept-ranges', 'bytes')
      }
      headers.set('X-Playback-Mode', 'direct')
      headers.set('X-Media-Source', 'webdav')

      return new Response(upstream.body, {
        status: upstream.status,
        headers,
      })
    } catch (err) {
      console.error('Stream error', err)
      return c.json({ error: 'Failed to stream file' }, 502)
    }
  })

  app.get('/api/progress', (c) => {
    const denied = requireAuth(c)
    if (denied) return denied
    const path = c.req.query('path')
    if (!path) return c.json({ error: 'path required' }, 400)
    return c.json(getProgress(path) ?? { path, position: 0, duration: 0 })
  })

  app.put('/api/progress', async (c) => {
    const denied = requireAuth(c)
    if (denied) return denied
    const body = await c.req.json<{
      path?: string
      position?: number
      duration?: number
      clientId?: string
    }>()
    if (!body.path || typeof body.position !== 'number') {
      return c.json({ error: 'path and position required' }, 400)
    }
    upsertProgress(body.path, body.position, body.duration ?? 0)

    // Keep now-playing fresh when the player reports progress (preserve paused/stopped)
    if (body.clientId?.trim()) {
      const clientId = body.clientId.trim()
      const prev = getPlaybackSession(clientId)
      const file = getMediaFileByPath(body.path)
      const title = file ? getTitleById(file.title_id) : undefined
      const state =
        prev?.state === 'paused' || prev?.state === 'stopped' ? prev.state : 'playing'
      if (state !== 'stopped') {
        upsertPlaybackSession({
          clientId,
          path: body.path,
          titleId: file?.title_id ?? null,
          titleName: title?.title ?? null,
          season: file?.season ?? null,
          episode: file?.episode ?? null,
          position: body.position,
          duration: body.duration ?? 0,
          state,
          userAgent: c.req.header('user-agent') ?? null,
          ip:
            c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
            c.req.header('x-real-ip') ||
            null,
        })
      }
    }

    return c.json({ ok: true })
  })
}
