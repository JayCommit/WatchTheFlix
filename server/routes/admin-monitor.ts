import type { Hono } from 'hono'
import { requireAdmin, type AuthVariables } from '../auth-mw.ts'
import {
  countFilesForTitle,
  getLibraryStats,
  getRecentlyAdded,
  getScanMeta,
  listActivityEvents,
  listNowPlaying,
  listRecentProgressActivity,
  pruneOldSessions,
} from '../db.ts'
import { serializeNowPlaying, serializeTitle } from '../http/serialize.ts'
import { ffmpegAvailable } from '../playback.ts'
import { posterUrl } from '../tmdb.ts'

type Vars = { Variables: AuthVariables }

export function registerAdminMonitorRoutes(app: Hono<Vars>): void {
  app.get('/api/admin/overview', (c) => {
    const denied = requireAdmin(c)
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
    const denied = requireAdmin(c)
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
    const denied = requireAdmin(c)
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
}
