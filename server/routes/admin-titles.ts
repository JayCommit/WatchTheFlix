import type { Hono } from 'hono'
import { applyTmdbMatch, fillMissingEpisodeNames } from '../admin-match.ts'
import { requireAdmin, type AuthVariables } from '../auth-mw.ts'
import { reloadConfig } from '../config.ts'
import {
  bulkHideTitles,
  bulkHideUnmatched,
  clearProgress,
  clearProgressForTitle,
  countFilesForTitle,
  getFilesForTitle,
  getMediaFileByPath,
  getPreferredFile,
  getProgress,
  getTitleById,
  insertActivityEvent,
  listUnmatchedTitles,
  markProgressWatched,
  markTitleWatched,
  mergeTitles,
  patchTitle,
  reassignMediaFile,
  searchTitlesAdmin,
  setTitleHidden,
  updateEpisodeName,
} from '../db.ts'
import { serializeTitle, serializeTmdbMatch } from '../http/serialize.ts'
import { getByTmdbId, searchMovie, searchTmdb, searchTv, type TmdbMatch } from '../tmdb.ts'

type Vars = { Variables: AuthVariables }

export function registerAdminTitleRoutes(app: Hono<Vars>): void {
  app.get('/api/admin/titles', (c) => {
    const denied = requireAdmin(c)
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
    const denied = requireAdmin(c)
    if (denied) return denied
    const id = Number(c.req.param('id'))
    if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400)
    const title = getTitleById(id)
    if (!title) return c.json({ error: 'Not found' }, 404)
    const files = getFilesForTitle(id).map((f) => {
      const progress = getProgress(f.path) ?? null
      const preferred = getPreferredFile(id, f.season, f.episode)
      return {
        path: f.path,
        filename: f.filename,
        size: f.size,
        season: f.season,
        episode: f.episode,
        episodeName: f.episode_name,
        progress,
        preferred: preferred === f.path,
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
    const denied = requireAdmin(c)
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
    const denied = requireAdmin(c)
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
    const denied = requireAdmin(c)
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
    const denied = requireAdmin(c)
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
    const denied = requireAdmin(c)
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
    const denied = requireAdmin(c)
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
    const denied = requireAdmin(c)
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

  app.post('/api/admin/unmatched/bulk-hide', async (c) => {
    const denied = requireAdmin(c)
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
    const denied = requireAdmin(c)
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
    const denied = requireAdmin(c)
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
}
