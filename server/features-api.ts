import type { Context, Hono } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import { dirname, join } from 'node:path'
import {
  addToWatchlist,
  createProfile,
  deleteMediaFileRow,
  deleteProfile,
  getFilesForTitle,
  getMediaFileByPath,
  getProfile,
  getProfileProgress,
  getTitleById,
  isOnWatchlist,
  listProfiles,
  listProfileContinueWatching,
  listWatchlist,
  removeFromWatchlist,
  setPreferredFile,
  upsertProfileProgress,
} from './db.ts'
import { getTitleHealth } from './health.ts'
import { safeUnlink, resolveLocalPath } from './mediafs.ts'
import { versionLabel, qualityRank } from './quality.ts'
import { extractSubtitleVtt, getStreamInfo } from './playback.ts'
import { listExternalSubtitles, readExternalSubtitleVtt } from './subs.ts'
import { backdropUrl, getCredits, getTrailers, posterUrl } from './tmdb.ts'

type Vars = { Variables: { authed: boolean } }

function requireAuth(c: {
  get: (k: 'authed') => boolean
  json: (d: unknown, s?: number) => Response
}) {
  if (!c.get('authed')) return c.json({ error: 'Unauthorized' }, 401)
  return null
}

function profileIdFrom(c: Context): number {
  const raw = c.req.header('x-profile-id') || getCookie(c, 'wtf_profile') || '1'
  const id = Number(raw)
  if (Number.isFinite(id) && id > 0 && getProfile(id)) return id
  return 1
}

export function registerFeatureRoutes(app: Hono<Vars>): void {
  app.get('/api/stream/tracks', async (c) => {
    const denied = requireAuth(c)
    if (denied) return denied
    const path = c.req.query('path')
    if (!path || path.includes('..')) return c.json({ error: 'Invalid path' }, 400)
    try {
      const info = await getStreamInfo(path)
      const external = listExternalSubtitles(path)
      return c.json({
        audioTracks: info.audioTracks,
        subtitleTracks: [...external, ...info.subtitleTracks],
        mode: info.mode,
        canDirect: info.canDirect,
      })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Probe failed' }, 500)
    }
  })

  app.get('/api/stream/subtitle', async (c) => {
    const denied = requireAuth(c)
    if (denied) return denied
    const path = c.req.query('path')
    const kind = c.req.query('kind') || 'embedded'
    const index = Number(c.req.query('index') ?? 0)
    if (!path || path.includes('..')) return c.json({ error: 'Invalid path' }, 400)

    try {
      if (kind === 'external') {
        const sidecar = c.req.query('sidecar')
        if (!sidecar || sidecar.includes('..')) return c.json({ error: 'Invalid sidecar' }, 400)
        // Only allow exact sidecar paths discovered next to this media file
        const externals = listExternalSubtitles(path)
        const hit = externals.find((t) => t.path === sidecar || t.title === sidecar)
        if (!hit?.title) return c.json({ error: 'Subtitle not found' }, 404)
        const local = resolveLocalPath(path)
        if (!local) return c.json({ error: 'Local media required for external subs' }, 400)
        const full = join(dirname(local), hit.title)
        const vtt = readExternalSubtitleVtt(full)
        return new Response(vtt, {
          headers: { 'Content-Type': 'text/vtt; charset=utf-8', 'Cache-Control': 'no-store' },
        })
      }
      const vtt = await extractSubtitleVtt(path, index)
      return new Response(vtt, {
        headers: { 'Content-Type': 'text/vtt; charset=utf-8', 'Cache-Control': 'no-store' },
      })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Subtitle failed' }, 500)
    }
  })

  app.get('/api/profiles', (c) => {
    const denied = requireAuth(c)
    if (denied) return denied
    return c.json({ profiles: listProfiles(), activeId: profileIdFrom(c) })
  })

  app.post('/api/profiles', async (c) => {
    const denied = requireAuth(c)
    if (denied) return denied
    const body = await c.req.json<{ name?: string }>().catch(() => null)
    try {
      const profile = createProfile(body?.name || 'Viewer')
      return c.json({ profile })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Create failed' }, 400)
    }
  })

  app.post('/api/profiles/:id/select', (c) => {
    const denied = requireAuth(c)
    if (denied) return denied
    const id = Number(c.req.param('id'))
    if (!getProfile(id)) return c.json({ error: 'Not found' }, 404)
    setCookie(c, 'wtf_profile', String(id), { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'Lax' })
    return c.json({ ok: true, activeId: id })
  })

  app.delete('/api/profiles/:id', (c) => {
    const denied = requireAuth(c)
    if (denied) return denied
    try {
      deleteProfile(Number(c.req.param('id')))
      return c.json({ ok: true })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Delete failed' }, 400)
    }
  })

  app.get('/api/watchlist', (c) => {
    const denied = requireAuth(c)
    if (denied) return denied
    const pid = profileIdFrom(c)
    const items = listWatchlist(pid).map((t) => ({
      id: t.id,
      kind: t.kind,
      tmdbId: t.tmdb_id,
      title: t.title,
      overview: t.overview,
      year: t.year,
      poster: posterUrl(t.poster_path),
      backdrop: backdropUrl(t.backdrop_path),
      voteAverage: t.vote_average,
      genres: [],
      addedAt: t.added_at,
    }))
    return c.json({ items })
  })

  app.post('/api/watchlist/:titleId', (c) => {
    const denied = requireAuth(c)
    if (denied) return denied
    const titleId = Number(c.req.param('titleId'))
    if (!getTitleById(titleId)) return c.json({ error: 'Not found' }, 404)
    addToWatchlist(profileIdFrom(c), titleId)
    return c.json({ ok: true })
  })

  app.delete('/api/watchlist/:titleId', (c) => {
    const denied = requireAuth(c)
    if (denied) return denied
    removeFromWatchlist(profileIdFrom(c), Number(c.req.param('titleId')))
    return c.json({ ok: true })
  })

  app.get('/api/title/:id/extras', async (c) => {
    const denied = requireAuth(c)
    if (denied) return denied
    const id = Number(c.req.param('id'))
    const title = getTitleById(id)
    if (!title || title.hidden) return c.json({ error: 'Not found' }, 404)
    const pid = profileIdFrom(c)
    const [trailers, cast, health] = await Promise.all([
      title.tmdb_id > 0 ? getTrailers(title.kind, title.tmdb_id) : Promise.resolve([]),
      title.tmdb_id > 0 ? getCredits(title.kind, title.tmdb_id) : Promise.resolve([]),
      title.kind === 'tv' && title.tmdb_id > 0
        ? getTitleHealth(id)
        : Promise.resolve(null),
    ])
    return c.json({
      onWatchlist: isOnWatchlist(pid, id),
      trailers,
      cast: cast.map((m) => ({
        ...m,
        profile: m.profilePath ? posterUrl(m.profilePath) : null,
      })),
      health,
    })
  })

  app.get('/api/admin/titles/:id/health', async (c) => {
    const denied = requireAuth(c)
    if (denied) return denied
    const id = Number(c.req.param('id'))
    try {
      return c.json(await getTitleHealth(id))
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Health failed' }, 500)
    }
  })

  app.delete('/api/admin/files', async (c) => {
    const denied = requireAuth(c)
    if (denied) return denied
    const body = await c.req
      .json<{ path?: string; deleteDisk?: boolean }>()
      .catch(() => null)
    if (!body?.path || body.path.includes('..')) return c.json({ error: 'path required' }, 400)
    const file = getMediaFileByPath(body.path)
    if (!file) return c.json({ error: 'Not found' }, 404)

    let diskDeleted = false
    if (body.deleteDisk) {
      const local = resolveLocalPath(body.path)
      if (local) {
        safeUnlink(local)
        diskDeleted = true
      }
    }
    deleteMediaFileRow(body.path)
    return c.json({ ok: true, diskDeleted })
  })

  app.post('/api/admin/files/prefer', async (c) => {
    const denied = requireAuth(c)
    if (denied) return denied
    const body = await c.req
      .json<{ path?: string; titleId?: number }>()
      .catch(() => null)
    if (!body?.path || !body.titleId) return c.json({ error: 'path and titleId required' }, 400)
    const file = getMediaFileByPath(body.path)
    if (!file) return c.json({ error: 'Not found' }, 404)
    setPreferredFile(body.titleId, body.path, file.season, file.episode)
    return c.json({ ok: true })
  })

  app.get('/api/library/continue', (c) => {
    const denied = requireAuth(c)
    if (denied) return denied
    const pid = profileIdFrom(c)
    const rows = listProfileContinueWatching(pid, 24) as Array<{
      path: string
      position: number
      duration: number
      updated_at: string
      filename: string
      season: number | null
      episode: number | null
      title_id: number
      kind: string
      title: string
      poster_path: string | null
      backdrop_path: string | null
    }>
    return c.json({
      continueWatching: rows.map((item) => ({
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
      })),
    })
  })

  // Profile-aware progress write (also keeps legacy table for default)
  app.put('/api/progress/profile', async (c) => {
    const denied = requireAuth(c)
    if (denied) return denied
    const body = await c.req
      .json<{ path?: string; position?: number; duration?: number }>()
      .catch(() => null)
    if (!body?.path || typeof body.position !== 'number') {
      return c.json({ error: 'path and position required' }, 400)
    }
    upsertProfileProgress(
      profileIdFrom(c),
      body.path,
      body.position,
      body.duration ?? 0,
    )
    return c.json({ ok: true })
  })

  app.get('/api/files/meta', (c) => {
    const denied = requireAuth(c)
    if (denied) return denied
    const titleId = Number(c.req.query('titleId'))
    if (!titleId) return c.json({ error: 'titleId required' }, 400)
    const files = getFilesForTitle(titleId)
      .map((f) => ({
        path: f.path,
        filename: f.filename,
        size: f.size,
        season: f.season,
        episode: f.episode,
        label: versionLabel(f.filename),
        rank: qualityRank(f.filename),
        progress: getProfileProgress(profileIdFrom(c), f.path) ?? null,
      }))
      .sort((a, b) => b.rank - a.rank)
    return c.json({ files })
  })
}

export { versionLabel }
