import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getConfig, publicConfigSummary, reloadConfig } from './config.ts'
import {
  checkPassword,
  createSessionToken,
  sessionCookieName,
  sessionCookieOptions,
  verifySessionToken,
} from './auth.ts'
import {
  bulkHideTitles,
  bulkHideUnmatched,
  clearProgress,
  clearProgressForTitle,
  convertJobStats,
  countFilesForTitle,
  countLibrary,
  getConvertJob,
  getFilesForTitle,
  getLibraryStats,
  getMediaFileByPath,
  getProgress,
  getScanMeta,
  getTitleById,
  getTitleByTmdb,
  getPlaybackSession,
  insertActivityEvent,
  listActivityEvents,
  listContinueWatching,
  listConvertJobs,
  listFilesNeedingConvert,
  listNowPlaying,
  listRecentProgressActivity,
  listTitles,
  listUnmatchedTitles,
  getRecentlyAdded,
  markProgressWatched,
  markTitleWatched,
  mergeTitles,
  patchTitle,
  pruneOldSessions,
  reassignMediaFile,
  searchTitlesAdmin,
  setTitleHidden,
  updateEpisodeName,
  updateMediaProbe,
  upsertPlaybackSession,
  upsertProgress,
} from './db.ts'
import { scanLibrary } from './scanner.ts'
import {
  backdropUrl,
  getByTmdbId,
  getEpisodeName,
  posterUrl,
  searchMovie,
  searchTmdb,
  searchTv,
  type TmdbMatch,
} from './tmdb.ts'
import {
  enqueueConvertForPath,
  requestCancelConvert,
  startConvertWorker,
} from './convert.ts'
import { localMediaEnabled } from './mediafs.ts'
import {
  ffmpegAvailable,
  resolvePlaybackMode,
  startCompatStream,
  streamLocalFile,
  getStreamInfo,
} from './playback.ts'
import { contentTypeFor, probeWebdav, streamFile } from './webdav.ts'

type Variables = {
  authed: boolean
}

const app = new Hono<{ Variables: Variables }>()

function serializeTitle(row: ReturnType<typeof getTitleById>, extra?: Record<string, unknown>) {
  if (!row) return null
  return {
    id: row.id,
    kind: row.kind,
    tmdbId: row.tmdb_id,
    title: row.title,
    overview: row.overview,
    year: row.year,
    poster: posterUrl(row.poster_path),
    backdrop: backdropUrl(row.backdrop_path),
    posterPath: row.poster_path,
    backdropPath: row.backdrop_path,
    voteAverage: row.vote_average,
    genres: (() => {
      if (!row.genres) return [] as string[]
      try {
        const parsed = JSON.parse(row.genres) as unknown
        return Array.isArray(parsed) ? (parsed as string[]) : []
      } catch {
        return [] as string[]
      }
    })(),
    hidden: Boolean(row.hidden),
    manualOverride: Boolean(row.manual_override),
    ...extra,
  }
}

function serializeTmdbMatch(m: TmdbMatch) {
  return {
    tmdbId: m.tmdbId,
    title: m.title,
    overview: m.overview,
    year: m.year,
    poster: posterUrl(m.posterPath),
    backdrop: backdropUrl(m.backdropPath),
    posterPath: m.posterPath,
    backdropPath: m.backdropPath,
    voteAverage: m.voteAverage,
    genres: m.genres,
  }
}

app.use('/api/*', async (c, next) => {
  const token = getCookie(c, sessionCookieName())
  c.set('authed', verifySessionToken(token))
  await next()
})

function requireAuth(c: { get: (k: 'authed') => boolean; json: (d: unknown, s?: number) => Response }) {
  if (!c.get('authed')) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  return null
}

async function applyTmdbMatch(
  titleId: number,
  kind: 'movie' | 'tv',
  meta: TmdbMatch,
): Promise<{ title: NonNullable<ReturnType<typeof getTitleById>>; mergedIntoId?: number }> {
  const current = getTitleById(titleId)
  if (!current) throw new Error('Title not found')

  const fields = {
    title: meta.title,
    kind,
    tmdbId: meta.tmdbId,
    overview: meta.overview,
    year: meta.year,
    posterPath: meta.posterPath,
    backdropPath: meta.backdropPath,
    voteAverage: meta.voteAverage,
    genres: meta.genres,
    hidden: false,
    manualOverride: true,
  } as const

  const clash = getTitleByTmdb(kind, meta.tmdbId)
  if (clash && clash.id !== titleId) {
    // Prefer consolidating into the existing TMDB title
    mergeTitles(titleId, clash.id)
    const merged = patchTitle(clash.id, fields)
    if (!merged) throw new Error('Title not found after merge')
    return { title: merged, mergedIntoId: clash.id }
  }

  const updated = patchTitle(titleId, fields)
  if (!updated) throw new Error('Title not found')
  return { title: updated }
}

async function fillMissingEpisodeNames(titleId: number, tmdbId: number): Promise<void> {
  if (tmdbId <= 0) return
  const files = getFilesForTitle(titleId)
  const missing = files.filter(
    (f) => f.season != null && f.episode != null && !f.episode_name,
  )
  if (!missing.length) return

  let i = 0
  const concurrency = 4
  const workers = Array.from({ length: Math.min(concurrency, missing.length) }, async () => {
    while (i < missing.length) {
      const idx = i++
      const f = missing[idx]!
      const name = await getEpisodeName(tmdbId, f.season!, f.episode!)
      if (name) updateEpisodeName(f.path, name)
    }
  })
  await Promise.all(workers)
}

app.get('/api/health', (c) => c.json({ ok: true }))

app.get('/api/me', (c) => c.json({ authed: c.get('authed') }))

app.post('/api/login', async (c) => {
  const body = await c.req.json<{ password?: string }>().catch(() => ({} as { password?: string }))
  if (!body.password || !checkPassword(body.password)) {
    return c.json({ error: 'Invalid password' }, 401)
  }
  const token = createSessionToken()
  setCookie(c, sessionCookieName(), token, sessionCookieOptions())
  return c.json({ ok: true })
})

app.post('/api/logout', (c) => {
  deleteCookie(c, sessionCookieName(), { path: '/' })
  return c.json({ ok: true })
})

app.get('/api/diagnostics', async (c) => {
  const denied = requireAuth(c)
  if (denied) return denied
  reloadConfig()
  const summary = publicConfigSummary()
  const probe = await probeWebdav()
    return c.json({
      config: summary,
      webdav: probe,
      playback: {
        ffmpegAvailable: ffmpegAvailable(),
        localMediaEnabled: localMediaEnabled(),
      },
      convert: convertJobStats(),
    })
  })

app.post('/api/scan', async (c) => {
  const denied = requireAuth(c)
  if (denied) return denied
  try {
    reloadConfig()
    console.log('Scan starting with config:', publicConfigSummary())
    const result = await scanLibrary()
    console.log('Scan finished:', {
      filesFound: result.filesFound,
      titles: result.titles,
      mediaRoot: result.mediaRoot,
      preservedOverrides: result.preservedOverrides,
      warning: result.warning,
    })
    return c.json(result)
  } catch (err) {
    console.error('Scan failed:', err)
    return c.json(
      { error: err instanceof Error ? err.message : 'Scan failed' },
      500,
    )
  }
})

app.get('/api/library', (c) => {
  const denied = requireAuth(c)
  if (denied) return denied

  const movies = listTitles('movie').map((t) => serializeTitle(t)!)
  const shows = listTitles('tv').map((t) => serializeTitle(t)!)
  const recent = getRecentlyAdded(24).map((t) => serializeTitle(t)!)
  const continueWatching = listContinueWatching(20).map((item) => ({
    path: item.path,
    position: item.position,
    duration: item.duration,
    updatedAt: item.updated_at,
    filename: item.filename,
    titleId: item.title_id,
    kind: item.kind,
    title: item.title,
    poster: posterUrl(item.poster_path),
    backdrop: backdropUrl(item.backdrop_path),
    season: item.season,
    episode: item.episode,
  }))

  const counts = countLibrary()
  return c.json({
    movies,
    shows,
    recent,
    continueWatching,
    lastScan: getScanMeta('last_scan'),
    counts,
  })
})

app.get('/api/movie/:id', (c) => {
  const denied = requireAuth(c)
  if (denied) return denied
  const id = Number(c.req.param('id'))
  const title = getTitleById(id)
  if (!title || title.kind !== 'movie' || title.hidden) return c.json({ error: 'Not found' }, 404)
  const files = getFilesForTitle(id).map((f) => ({
    path: f.path,
    filename: f.filename,
    size: f.size,
    progress: getProgress(f.path) ?? null,
  }))
  return c.json({ ...serializeTitle(title)!, files })
})

app.get('/api/tv/:id', async (c) => {
  const denied = requireAuth(c)
  if (denied) return denied
  const id = Number(c.req.param('id'))
  const title = getTitleById(id)
  if (!title || title.kind !== 'tv' || title.hidden) return c.json({ error: 'Not found' }, 404)

  // Lazily fill missing episode names from TMDB
  if (title.tmdb_id > 0) {
    try {
      await fillMissingEpisodeNames(id, title.tmdb_id)
    } catch (err) {
      console.warn('Episode name fetch failed:', err)
    }
  }

  const files = getFilesForTitle(id).map((f) => ({
    path: f.path,
    filename: f.filename,
    size: f.size,
    season: f.season,
    episode: f.episode,
    episodeName: f.episode_name,
    progress: getProgress(f.path) ?? null,
  }))
  return c.json({ ...serializeTitle(title)!, files })
})

// ——— Admin APIs (same session cookie as the rest of the app) ———

app.get('/api/admin/titles', (c) => {
  const denied = requireAuth(c)
  if (denied) return denied
  const q = c.req.query('q') ?? undefined
  const kindRaw = c.req.query('kind')
  const kind = kindRaw === 'movie' || kindRaw === 'tv' ? kindRaw : undefined
  const includeHidden = c.req.query('includeHidden') === '1' || c.req.query('includeHidden') === 'true'
  const rows = searchTitlesAdmin({ q, kind, includeHidden })
  return c.json({
    titles: rows.map((t) =>
      serializeTitle(t, {
        fileCount: countFilesForTitle(t.id),
        unmatched: t.tmdb_id < 0,
      }),
    ),
  })
})

app.get('/api/admin/titles/:id', (c) => {
  const denied = requireAuth(c)
  if (denied) return denied
  const id = Number(c.req.param('id'))
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400)
  const title = getTitleById(id)
  if (!title) return c.json({ error: 'Not found' }, 404)
  const files = getFilesForTitle(id).map((f) => {
    const progress = getProgress(f.path) ?? null
    return {
      path: f.path,
      filename: f.filename,
      size: f.size,
      season: f.season,
      episode: f.episode,
      episodeName: f.episode_name,
      progress,
      container: f.container ?? null,
      videoCodec: f.video_codec ?? null,
      audioCodec: f.audio_codec ?? null,
      playbackMode: f.playback_mode ?? null,
      canDirect: f.can_direct == null ? null : Boolean(f.can_direct),
      probedAt: f.probed_at ?? null,
    }
  })
  return c.json(
    serializeTitle(title, {
      fileCount: files.length,
      unmatched: title.tmdb_id < 0,
      files,
    }),
  )
})

app.patch('/api/admin/titles/:id', async (c) => {
  const denied = requireAuth(c)
  if (denied) return denied
  const id = Number(c.req.param('id'))
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400)

  const body = await c.req
    .json<{
      title?: string
      kind?: 'movie' | 'tv'
      tmdbId?: number
      overview?: string | null
      year?: number | null
      posterPath?: string | null
      backdropPath?: string | null
      voteAverage?: number | null
      genres?: string[] | null
      hidden?: boolean
      manualOverride?: boolean
    }>()
    .catch(() => null)
  if (!body) return c.json({ error: 'Invalid JSON body' }, 400)

  try {
    const updated = patchTitle(id, body)
    if (!updated) return c.json({ error: 'Not found' }, 404)
    return c.json(
      serializeTitle(updated, {
        fileCount: countFilesForTitle(updated.id),
        unmatched: updated.tmdb_id < 0,
      }),
    )
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Update failed' }, 400)
  }
})

app.post('/api/admin/titles/:id/rematch', async (c) => {
  const denied = requireAuth(c)
  if (denied) return denied
  const id = Number(c.req.param('id'))
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400)

  const current = getTitleById(id)
  if (!current) return c.json({ error: 'Not found' }, 404)

  const body = await c.req
    .json<{ query?: string; tmdbId?: number; kind?: 'movie' | 'tv' }>()
    .catch(() => ({} as { query?: string; tmdbId?: number; kind?: 'movie' | 'tv' }))

  const kind = body.kind ?? current.kind
  reloadConfig()

  try {
    let meta: TmdbMatch | null = null
    if (body.tmdbId != null && Number.isFinite(body.tmdbId)) {
      meta = await getByTmdbId(kind, Number(body.tmdbId))
      if (!meta) return c.json({ error: `TMDB ${kind} ${body.tmdbId} not found` }, 404)
    } else {
      const query = (body.query?.trim() || current.title).trim()
      const yearHint =
        body.query?.trim() && body.query.trim() !== current.title ? null : current.year
      const searched =
        kind === 'tv' ? await searchTv(query, yearHint) : await searchMovie(query, yearHint)
      if (!searched) return c.json({ error: `No TMDB match for "${query}"` }, 404)
      // Always pull detail endpoint for fresh poster/backdrop/overview/year
      meta = (await getByTmdbId(kind, searched.tmdbId)) ?? searched
    }

    const { title: updated, mergedIntoId } = await applyTmdbMatch(id, kind, meta)
    if (updated.kind === 'tv' && updated.tmdb_id > 0) {
      // Clear stale episode names then refill from the new TMDB id
      for (const f of getFilesForTitle(updated.id)) {
        if (f.episode_name) updateEpisodeName(f.path, null)
      }
      await fillMissingEpisodeNames(updated.id, updated.tmdb_id)
    }
    return c.json(
      serializeTitle(updated, {
        fileCount: countFilesForTitle(updated.id),
        unmatched: updated.tmdb_id < 0,
        ...(mergedIntoId != null ? { mergedIntoId } : {}),
      }),
    )
  } catch (err) {
    console.error('Rematch failed:', err)
    return c.json({ error: err instanceof Error ? err.message : 'Rematch failed' }, 500)
  }
})

app.delete('/api/admin/titles/:id', (c) => {
  const denied = requireAuth(c)
  if (denied) return denied
  const id = Number(c.req.param('id'))
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400)
  const hard = c.req.query('hard') === '1'
  const title = getTitleById(id)
  if (!title) return c.json({ error: 'Not found' }, 404)

  if (hard) {
    // Soft-hide is preferred; hard delete not implemented to avoid orphans/progress loss
    return c.json({ error: 'Hard delete not supported; omit ?hard or use soft-hide' }, 400)
  }

  const updated = setTitleHidden(id, true)
  return c.json({ ok: true, title: serializeTitle(updated!) })
})

app.get('/api/admin/unmatched', (c) => {
  const denied = requireAuth(c)
  if (denied) return denied
  const rows = listUnmatchedTitles()
  return c.json({
    titles: rows.map((t) =>
      serializeTitle(t, {
        fileCount: t.file_count,
        unmatched: true,
        files: getFilesForTitle(t.id).map((f) => ({
          path: f.path,
          filename: f.filename,
          size: f.size,
          season: f.season,
          episode: f.episode,
        })),
      }),
    ),
  })
})

app.post('/api/admin/titles/:id/merge', async (c) => {
  const denied = requireAuth(c)
  if (denied) return denied
  const sourceId = Number(c.req.param('id'))
  const body = await c.req
    .json<{ targetId?: number; targetTitleId?: number }>()
    .catch(() => ({} as { targetId?: number; targetTitleId?: number }))
  const targetId = body.targetId ?? body.targetTitleId
  if (!Number.isFinite(sourceId) || targetId == null || !Number.isFinite(targetId)) {
    return c.json({ error: 'targetId required' }, 400)
  }
  try {
    const result = mergeTitles(sourceId, Number(targetId))
    const target = getTitleById(Number(targetId))
    return c.json({
      ok: true,
      moved: result.moved,
      target: serializeTitle(target!, { fileCount: countFilesForTitle(Number(targetId)) }),
    })
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Merge failed' }, 400)
  }
})

app.post('/api/admin/files/reassign', async (c) => {
  const denied = requireAuth(c)
  if (denied) return denied
  const body = await c.req
    .json<{ path?: string; titleId?: number }>()
    .catch(() => ({} as { path?: string; titleId?: number }))
  if (!body.path || body.titleId == null) {
    return c.json({ error: 'path and titleId required' }, 400)
  }
  const file = getMediaFileByPath(body.path)
  if (!file) return c.json({ error: 'File not found' }, 404)
  const title = getTitleById(Number(body.titleId))
  if (!title) return c.json({ error: 'Title not found' }, 404)

  const updated = reassignMediaFile(body.path, Number(body.titleId))
  // Mark target as manually managed so scans keep the assignment for override titles…
  // File-level override: mark destination title as manual so scan won't steal sibling logic incorrectly.
  // Actually scan preserves by file→title.manual_override; mark the destination.
  patchTitle(title.id, { manualOverride: true })

  return c.json({
    ok: true,
    file: {
      path: updated!.path,
      filename: updated!.filename,
      titleId: updated!.title_id,
      season: updated!.season,
      episode: updated!.episode,
    },
    title: serializeTitle(getTitleById(title.id)!),
  })
})

app.get('/api/admin/tmdb/search', async (c) => {
  const denied = requireAuth(c)
  if (denied) return denied
  const q = c.req.query('q')?.trim()
  const kindRaw = c.req.query('kind')
  const kind = kindRaw === 'movie' || kindRaw === 'tv' ? kindRaw : 'movie'
  if (!q) return c.json({ error: 'q required' }, 400)
  reloadConfig()
  try {
    const yearRaw = c.req.query('year')
    const year = yearRaw ? Number(yearRaw) : null
    const results = await searchTmdb(kind, q, Number.isFinite(year) ? year : null, 12)
    return c.json({ results: results.map(serializeTmdbMatch) })
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Search failed' }, 500)
  }
})

app.get('/api/admin/overview', (c) => {
  const denied = requireAuth(c)
  if (denied) return denied
  pruneOldSessions()
  const stats = getLibraryStats()
  const nowPlaying = listNowPlaying()
  const recent = getRecentlyAdded(12).map((t) =>
    serializeTitle(t, {
      fileCount: countFilesForTitle(t.id),
      unmatched: t.tmdb_id < 0,
      scannedAt: t.scanned_at,
    }),
  )
  return c.json({
    stats: {
      ...stats,
      knownDurationHours: Math.round((stats.knownDurationSeconds / 3600) * 10) / 10,
      titles: stats.movies + stats.shows,
    },
    lastScan: getScanMeta('last_scan'),
    ffmpegAvailable: ffmpegAvailable(),
    nowPlayingCount: nowPlaying.length,
    nowPlaying: nowPlaying.slice(0, 6).map(serializeNowPlaying),
    recent,
  })
})

app.get('/api/admin/now-playing', (c) => {
  const denied = requireAuth(c)
  if (denied) return denied
  pruneOldSessions()
  const includeStale =
    c.req.query('includeStale') === '1' || c.req.query('includeStale') === 'true'
  const sessions = listNowPlaying({ includeStale })
  return c.json({
    sessions: sessions.map(serializeNowPlaying),
    watchingWindowSeconds: 120,
  })
})

app.get('/api/admin/activity', (c) => {
  const denied = requireAuth(c)
  if (denied) return denied
  const limitRaw = Number(c.req.query('limit') ?? 50)
  const limit = Number.isFinite(limitRaw) ? Math.min(200, Math.max(1, limitRaw)) : 50
  const events = listActivityEvents(limit).map((e) => ({
    id: e.id,
    clientId: e.client_id,
    path: e.path,
    titleId: e.title_id,
    titleName: e.title_name,
    season: e.season,
    episode: e.episode,
    position: e.position,
    duration: e.duration,
    eventType: e.event_type,
    detail: e.detail,
    createdAt: e.created_at,
  }))
  const progress = listRecentProgressActivity(limit).map((p) => ({
    path: p.path,
    position: p.position,
    duration: p.duration,
    updatedAt: p.updated_at,
    filename: p.filename,
    titleId: p.title_id,
    kind: p.kind,
    title: p.title,
    poster: posterUrl(p.poster_path),
    season: p.season,
    episode: p.episode,
  }))
  return c.json({ events, progress })
})

app.post('/api/admin/unmatched/bulk-hide', async (c) => {
  const denied = requireAuth(c)
  if (denied) return denied
  const body = await c.req
    .json<{ ids?: number[]; all?: boolean }>()
    .catch(() => ({} as { ids?: number[]; all?: boolean }))
  let hidden = 0
  if (body.all) {
    hidden = bulkHideUnmatched()
  } else if (Array.isArray(body.ids) && body.ids.length > 0) {
    const ids = body.ids.filter((n) => Number.isFinite(n)).map(Number)
    hidden = bulkHideTitles(ids)
  } else {
    return c.json({ error: 'Provide ids[] or all: true' }, 400)
  }
  insertActivityEvent({
    eventType: 'admin_bulk_hide',
    detail: body.all ? 'all unmatched' : `ids=${hidden}`,
  })
  return c.json({ ok: true, hidden })
})

app.post('/api/admin/progress/clear', async (c) => {
  const denied = requireAuth(c)
  if (denied) return denied
  const body = await c.req
    .json<{ path?: string; titleId?: number }>()
    .catch(() => ({} as { path?: string; titleId?: number }))
  if (body.path) {
    const ok = clearProgress(body.path)
    insertActivityEvent({
      path: body.path,
      eventType: 'progress_cleared',
      titleId: getMediaFileByPath(body.path)?.title_id ?? null,
    })
    return c.json({ ok, cleared: ok ? 1 : 0 })
  }
  if (body.titleId != null && Number.isFinite(body.titleId)) {
    const cleared = clearProgressForTitle(Number(body.titleId))
    insertActivityEvent({
      titleId: Number(body.titleId),
      titleName: getTitleById(Number(body.titleId))?.title ?? null,
      eventType: 'progress_cleared',
      detail: `files=${cleared}`,
    })
    return c.json({ ok: true, cleared })
  }
  return c.json({ error: 'path or titleId required' }, 400)
})

app.post('/api/admin/progress/watched', async (c) => {
  const denied = requireAuth(c)
  if (denied) return denied
  const body = await c.req
    .json<{ path?: string; titleId?: number; duration?: number }>()
    .catch(() => ({} as { path?: string; titleId?: number; duration?: number }))
  if (body.path) {
    const row = markProgressWatched(body.path, body.duration ?? 0)
    const file = getMediaFileByPath(body.path)
    const title = file ? getTitleById(file.title_id) : undefined
    insertActivityEvent({
      path: body.path,
      titleId: file?.title_id ?? null,
      titleName: title?.title ?? null,
      season: file?.season ?? null,
      episode: file?.episode ?? null,
      position: row?.position ?? null,
      duration: row?.duration ?? null,
      eventType: 'marked_watched',
    })
    return c.json({ ok: true, progress: row ?? null })
  }
  if (body.titleId != null && Number.isFinite(body.titleId)) {
    const marked = markTitleWatched(Number(body.titleId))
    insertActivityEvent({
      titleId: Number(body.titleId),
      titleName: getTitleById(Number(body.titleId))?.title ?? null,
      eventType: 'marked_watched',
      detail: `files=${marked}`,
    })
    return c.json({ ok: true, marked })
  }
  return c.json({ error: 'path or titleId required' }, 400)
})

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

function serializeNowPlaying(s: {
  client_id: string
  path: string
  title_id: number | null
  title_name: string | null
  season: number | null
  episode: number | null
  position: number
  duration: number
  playback_mode: string | null
  state: string
  user_agent: string | null
  ip: string | null
  started_at: string
  last_seen_at: string
  status: 'watching' | 'paused' | 'stalled' | 'stopped'
  idleSeconds: number
  poster_path: string | null
  kind: 'movie' | 'tv' | null
  filename: string | null
}) {
  return {
    clientId: s.client_id,
    path: s.path,
    titleId: s.title_id,
    titleName: s.title_name,
    season: s.season,
    episode: s.episode,
    position: s.position,
    duration: s.duration,
    playbackMode: s.playback_mode,
    state: s.state,
    status: s.status,
    idleSeconds: s.idleSeconds,
    userAgent: s.user_agent,
    ip: s.ip,
    startedAt: s.started_at,
    lastSeenAt: s.last_seen_at,
    poster: posterUrl(s.poster_path),
    kind: s.kind,
    filename: s.filename,
    progressPct:
      s.duration > 0 ? Math.min(100, Math.round((s.position / s.duration) * 1000) / 10) : 0,
  }
}

app.get('/api/stream/info', async (c) => {
  const denied = requireAuth(c)
  if (denied) return denied
  const path = c.req.query('path')
  if (!path || path.includes('..')) {
    return c.json({ error: 'Invalid path' }, 400)
  }
  try {
    const info = await resolvePlaybackMode(path, c.req.query('mode'))
    return c.json({ ...info, ffmpegAvailable: ffmpegAvailable() })
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
    const info = await resolvePlaybackMode(path, requestedMode)

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
      const { response } = startCompatStream(path, info.mode, {
        startSeconds: Number.isFinite(startSeconds) ? startSeconds : 0,
        audioCodec: info.audioCodec,
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

function serializeConvertJob(j: ReturnType<typeof getConvertJob>) {
  if (!j) return null
  return {
    id: j.id,
    path: j.path,
    titleId: j.title_id,
    titleName: j.title_name,
    status: j.status,
    mode: j.mode,
    replaceOriginal: Boolean(j.replace_original),
    deleteOriginal: Boolean(j.delete_original),
    progress: j.progress,
    container: j.container,
    videoCodec: j.video_codec,
    audioCodec: j.audio_codec,
    outputPath: j.output_path,
    quarantinedPath: j.quarantined_path,
    error: j.error,
    createdAt: j.created_at,
    startedAt: j.started_at,
    finishedAt: j.finished_at,
  }
}

app.get('/api/admin/convert/jobs', (c) => {
  const denied = requireAuth(c)
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
  const denied = requireAuth(c)
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
  }))
  return c.json({ files, localMediaEnabled: localMediaEnabled() })
})

app.post('/api/admin/convert/probe', async (c) => {
  const denied = requireAuth(c)
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
      const info = await getStreamInfo(path)
      updateMediaProbe(path, {
        container: info.container,
        videoCodec: info.videoCodec,
        audioCodec: info.audioCodec,
        playbackMode: info.mode,
        canDirect: info.canDirect,
        duration: info.duration,
      })
      results.push({ path, ok: true, ...info })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      updateMediaProbe(path, { probeError: msg, canDirect: false })
      results.push({ path, ok: false, error: msg })
    }
  }
  return c.json({ probed: results.length, results, localMediaEnabled: localMediaEnabled() })
})

app.post('/api/admin/convert/enqueue', async (c) => {
  const denied = requireAuth(c)
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
  const denied = requireAuth(c)
  if (denied) return denied
  const id = Number(c.req.param('id'))
  const job = requestCancelConvert(id)
  if (!job) return c.json({ error: 'Not found' }, 404)
  return c.json({ job: serializeConvertJob(job) })
})

app.get('/api/admin/convert/jobs/:id', (c) => {
  const denied = requireAuth(c)
  if (denied) return denied
  const id = Number(c.req.param('id'))
  const job = getConvertJob(id)
  if (!job) return c.json({ error: 'Not found' }, 404)
  return c.json({ job: serializeConvertJob(job) })
})

// Production static UI (never intercept /api/*)
const rootDir = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const distDir = join(rootDir, 'dist')
if (existsSync(distDir)) {
  app.use('*', async (c, next) => {
    if (c.req.path.startsWith('/api')) {
      return c.json({ error: 'Not found' }, 404)
    }
    return next()
  })
  app.use('/*', serveStatic({ root: './dist' }))
  app.get('*', async (c) => {
    if (c.req.path.startsWith('/api')) {
      return c.json({ error: 'Not found' }, 404)
    }
    const { readFile } = await import('node:fs/promises')
    const html = await readFile(join(distDir, 'index.html'), 'utf8')
    return c.html(html)
  })
}

const boot = getConfig()
const port = boot.port
console.log(`WatchTheFlix listening on http://localhost:${port}`)
console.log('Config:', publicConfigSummary())
if (!boot.webdavUrl || !boot.tmdbApiKey) {
  console.warn('Warning: SFTPGO_WEBDAV_URL and/or TMDB_API_KEY not set. Copy .env.example to .env')
}

startConvertWorker()

serve({
  fetch: app.fetch,
  port,
})
