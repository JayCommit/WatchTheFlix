import type { Hono } from 'hono'
import { fillMissingEpisodeNames } from '../admin-match.ts'
import { requireAuth, type AuthVariables } from '../auth-mw.ts'
import {
  countLibrary,
  getFilesForTitle,
  getPreferredFile,
  getProfileProgress,
  getRecentlyAdded,
  getScanMeta,
  getTitleById,
  listProfileContinueWatching,
  listTitles,
} from '../db.ts'
import { profileIdFrom } from '../http/profile.ts'
import { serializeTitle } from '../http/serialize.ts'
import { versionLabel } from '../quality.ts'
import { backdropUrl, posterUrl } from '../tmdb.ts'

type Vars = { Variables: AuthVariables }

export function registerLibraryRoutes(app: Hono<Vars>): void {
  app.get('/api/library', (c) => {
    const denied = requireAuth(c)
    if (denied) return denied

    const movies = listTitles('movie').map((t) => serializeTitle(t)!)
    const shows = listTitles('tv').map((t) => serializeTitle(t)!)
    const recent = getRecentlyAdded(24).map((t) => serializeTitle(t)!)
    const continueWatching = (
      listProfileContinueWatching(profileIdFrom(c), 20) as Array<{
        path: string
        position: number
        duration: number
        updated_at: string
        filename: string
        title_id: number
        kind: string
        title: string
        poster_path: string | null
        backdrop_path: string | null
        season: number | null
        episode: number | null
      }>
    ).map((item) => ({
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
    const pid = profileIdFrom(c)
    const preferred = getPreferredFile(id, null, null)
    const files = getFilesForTitle(id)
      .map((f) => ({
        path: f.path,
        filename: f.filename,
        size: f.size,
        label: versionLabel(f.filename),
        preferred: preferred === f.path,
        progress: getProfileProgress(pid, f.path) ?? null,
      }))
      .sort((a, b) => Number(b.preferred) - Number(a.preferred))
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

    const pid = profileIdFrom(c)
    const files = getFilesForTitle(id).map((f) => {
      const preferred = getPreferredFile(id, f.season, f.episode)
      return {
        path: f.path,
        filename: f.filename,
        size: f.size,
        season: f.season,
        episode: f.episode,
        episodeName: f.episode_name,
        label: versionLabel(f.filename),
        preferred: preferred === f.path,
        progress: getProfileProgress(pid, f.path) ?? null,
      }
    })
    // Preferred versions first within the same S/E
    files.sort((a, b) => {
      const sa = a.season ?? 0
      const sb = b.season ?? 0
      if (sa !== sb) return sa - sb
      const ea = a.episode ?? 0
      const eb = b.episode ?? 0
      if (ea !== eb) return ea - eb
      return Number(b.preferred) - Number(a.preferred)
    })
    return c.json({ ...serializeTitle(title)!, files })
  })
}
