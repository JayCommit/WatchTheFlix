import { db } from './connection.ts'
import type { TitleRow } from './types.ts'

export function upsertTitle(input: {
  kind: 'movie' | 'tv'
  tmdbId: number
  title: string
  overview?: string | null
  year?: number | null
  posterPath?: string | null
  backdropPath?: string | null
  voteAverage?: number | null
  genres?: string[]
  /** When true, always overwrite metadata (admin rematch). */
  force?: boolean
}): number {
  const existing = db
    .prepare(`SELECT id, manual_override FROM titles WHERE kind = ? AND tmdb_id = ?`)
    .get(input.kind, input.tmdbId) as { id: number; manual_override: number } | undefined

  if (existing && existing.manual_override && !input.force) {
    return existing.id
  }

  if (existing && input.force) {
    db.prepare(`
      UPDATE titles SET
        title = ?, overview = ?, year = ?, poster_path = ?, backdrop_path = ?,
        vote_average = ?, genres = ?
      WHERE id = ?
    `).run(
      input.title,
      input.overview ?? null,
      input.year ?? null,
      input.posterPath ?? null,
      input.backdropPath ?? null,
      input.voteAverage ?? null,
      input.genres ? JSON.stringify(input.genres) : null,
      existing.id,
    )
    return existing.id
  }

  db.prepare(`
    INSERT INTO titles (kind, tmdb_id, title, overview, year, poster_path, backdrop_path, vote_average, genres, hidden, manual_override)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)
    ON CONFLICT(kind, tmdb_id) DO UPDATE SET
      title = excluded.title,
      overview = excluded.overview,
      year = excluded.year,
      poster_path = excluded.poster_path,
      backdrop_path = excluded.backdrop_path,
      vote_average = excluded.vote_average,
      genres = excluded.genres
    WHERE titles.manual_override = 0
  `).run(
    input.kind,
    input.tmdbId,
    input.title,
    input.overview ?? null,
    input.year ?? null,
    input.posterPath ?? null,
    input.backdropPath ?? null,
    input.voteAverage ?? null,
    input.genres ? JSON.stringify(input.genres) : null,
  )

  const row = db
    .prepare(`SELECT id FROM titles WHERE kind = ? AND tmdb_id = ?`)
    .get(input.kind, input.tmdbId) as { id: number }
  return row.id
}

export function listTitles(kind?: 'movie' | 'tv', opts?: { includeHidden?: boolean }): TitleRow[] {
  const includeHidden = opts?.includeHidden ?? false
  if (kind) {
    if (includeHidden) {
      return db
        .prepare(`SELECT * FROM titles WHERE kind = ? ORDER BY title COLLATE NOCASE`)
        .all(kind) as TitleRow[]
    }
    return db
      .prepare(`SELECT * FROM titles WHERE kind = ? AND hidden = 0 ORDER BY title COLLATE NOCASE`)
      .all(kind) as TitleRow[]
  }
  if (includeHidden) {
    return db.prepare(`SELECT * FROM titles ORDER BY title COLLATE NOCASE`).all() as TitleRow[]
  }
  return db
    .prepare(`SELECT * FROM titles WHERE hidden = 0 ORDER BY title COLLATE NOCASE`)
    .all() as TitleRow[]
}

export function searchTitlesAdmin(opts: {
  q?: string
  kind?: 'movie' | 'tv'
  includeHidden?: boolean
}): TitleRow[] {
  const clauses: string[] = []
  const params: Array<string | number> = []
  if (opts.kind) {
    clauses.push(`kind = ?`)
    params.push(opts.kind)
  }
  if (!opts.includeHidden) {
    clauses.push(`hidden = 0`)
  }
  if (opts.q?.trim()) {
    clauses.push(`(title LIKE ? OR CAST(tmdb_id AS TEXT) LIKE ? OR CAST(id AS TEXT) = ?)`)
    const like = `%${opts.q.trim()}%`
    params.push(like, like, opts.q.trim())
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  return db
    .prepare(`SELECT * FROM titles ${where} ORDER BY title COLLATE NOCASE`)
    .all(...params) as TitleRow[]
}

export function listUnmatchedTitles(): Array<TitleRow & { file_count: number }> {
  return db
    .prepare(
      `
      SELECT t.*, COUNT(f.id) AS file_count
      FROM titles t
      LEFT JOIN media_files f ON f.title_id = t.id
      WHERE t.tmdb_id < 0 AND t.hidden = 0
      GROUP BY t.id
      ORDER BY t.title COLLATE NOCASE
    `,
    )
    .all() as Array<TitleRow & { file_count: number }>
}

export function getTitleById(id: number): TitleRow | undefined {
  return db.prepare(`SELECT * FROM titles WHERE id = ?`).get(id) as TitleRow | undefined
}

export function getTitleByTmdb(kind: 'movie' | 'tv', tmdbId: number): TitleRow | undefined {
  return db
    .prepare(`SELECT * FROM titles WHERE kind = ? AND tmdb_id = ?`)
    .get(kind, tmdbId) as TitleRow | undefined
}

export function patchTitle(
  id: number,
  patch: {
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
  },
): TitleRow | undefined {
  const current = getTitleById(id)
  if (!current) return undefined

  const kind = patch.kind ?? current.kind
  const tmdbId = patch.tmdbId ?? current.tmdb_id

  // Unique(kind, tmdb_id) — if changing to an existing pair, fail unless same row
  if (kind !== current.kind || tmdbId !== current.tmdb_id) {
    const clash = getTitleByTmdb(kind, tmdbId)
    if (clash && clash.id !== id) {
      throw new Error(`Another title already uses ${kind}/${tmdbId} (id ${clash.id})`)
    }
  }

  db.prepare(`
    UPDATE titles SET
      kind = ?,
      tmdb_id = ?,
      title = ?,
      overview = ?,
      year = ?,
      poster_path = ?,
      backdrop_path = ?,
      vote_average = ?,
      genres = ?,
      hidden = ?,
      manual_override = ?
    WHERE id = ?
  `).run(
    kind,
    tmdbId,
    patch.title ?? current.title,
    patch.overview !== undefined ? patch.overview : current.overview,
    patch.year !== undefined ? patch.year : current.year,
    patch.posterPath !== undefined ? patch.posterPath : current.poster_path,
    patch.backdropPath !== undefined ? patch.backdropPath : current.backdrop_path,
    patch.voteAverage !== undefined ? patch.voteAverage : current.vote_average,
    patch.genres !== undefined
      ? patch.genres
        ? JSON.stringify(patch.genres)
        : null
      : current.genres,
    patch.hidden !== undefined ? (patch.hidden ? 1 : 0) : current.hidden,
    patch.manualOverride !== undefined
      ? patch.manualOverride
        ? 1
        : 0
      : 1, // any admin patch marks as manual override
    id,
  )
  return getTitleById(id)
}

export function setTitleHidden(id: number, hidden: boolean): TitleRow | undefined {
  db.prepare(`UPDATE titles SET hidden = ?, manual_override = 1 WHERE id = ?`).run(hidden ? 1 : 0, id)
  return getTitleById(id)
}

/** Move all files from source title into target; hide (soft-delete) the source. */
export function mergeTitles(sourceId: number, targetId: number): { moved: number } {
  if (sourceId === targetId) throw new Error('Cannot merge a title into itself')
  const source = getTitleById(sourceId)
  const target = getTitleById(targetId)
  if (!source || !target) throw new Error('Title not found')

  const result = db
    .prepare(`UPDATE media_files SET title_id = ? WHERE title_id = ?`)
    .run(targetId, sourceId)
  db.prepare(`UPDATE titles SET hidden = 1, manual_override = 1 WHERE id = ?`).run(sourceId)
  return { moved: Number(result.changes ?? 0) }
}

export function getRecentlyAdded(limit = 24): Array<TitleRow & { scanned_at: string }> {
  return db
    .prepare(
      `
      SELECT t.*, MAX(f.scanned_at) AS scanned_at
      FROM titles t
      JOIN media_files f ON f.title_id = t.id
      WHERE t.hidden = 0
      GROUP BY t.id
      ORDER BY scanned_at DESC
      LIMIT ?
    `,
    )
    .all(limit) as Array<TitleRow & { scanned_at: string }>
}

export function countLibrary(opts?: { includeHidden?: boolean }): { titles: number; files: number } {
  const includeHidden = opts?.includeHidden ?? false
  const titles = (
    db
      .prepare(
        includeHidden
          ? `SELECT COUNT(*) AS c FROM titles`
          : `SELECT COUNT(*) AS c FROM titles WHERE hidden = 0`,
      )
      .get() as { c: number }
  ).c
  const files = (
    db
      .prepare(
        includeHidden
          ? `SELECT COUNT(*) AS c FROM media_files`
          : `SELECT COUNT(*) AS c FROM media_files f JOIN titles t ON t.id = f.title_id WHERE t.hidden = 0`,
      )
      .get() as { c: number }
  ).c
  return { titles, files }
}

export function getLibraryStats(): {
  movies: number
  shows: number
  unmatched: number
  hidden: number
  files: number
  movieFiles: number
  tvFiles: number
  knownDurationSeconds: number
  progressRows: number
} {
  const movies = (
    db.prepare(`SELECT COUNT(*) AS c FROM titles WHERE kind = 'movie' AND hidden = 0`).get() as {
      c: number
    }
  ).c
  const shows = (
    db.prepare(`SELECT COUNT(*) AS c FROM titles WHERE kind = 'tv' AND hidden = 0`).get() as {
      c: number
    }
  ).c
  const unmatched = (
    db
      .prepare(`SELECT COUNT(*) AS c FROM titles WHERE tmdb_id < 0 AND hidden = 0`)
      .get() as { c: number }
  ).c
  const hidden = (
    db.prepare(`SELECT COUNT(*) AS c FROM titles WHERE hidden = 1`).get() as { c: number }
  ).c
  const files = (
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM media_files f JOIN titles t ON t.id = f.title_id WHERE t.hidden = 0`,
      )
      .get() as { c: number }
  ).c
  const movieFiles = (
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM media_files f JOIN titles t ON t.id = f.title_id WHERE t.hidden = 0 AND t.kind = 'movie'`,
      )
      .get() as { c: number }
  ).c
  const tvFiles = (
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM media_files f JOIN titles t ON t.id = f.title_id WHERE t.hidden = 0 AND t.kind = 'tv'`,
      )
      .get() as { c: number }
  ).c
  // Only count progress that reflects real watching (not probe-only duration stamps).
  const knownDurationSeconds = (
    db
      .prepare(
        `SELECT COALESCE(SUM(duration), 0) AS s FROM progress WHERE duration > 0 AND position > 0`,
      )
      .get() as { s: number }
  ).s
  const progressRows = (
    db.prepare(`SELECT COUNT(*) AS c FROM progress`).get() as { c: number }
  ).c
  return {
    movies,
    shows,
    unmatched,
    hidden,
    files,
    movieFiles,
    tvFiles,
    knownDurationSeconds,
    progressRows,
  }
}

export function bulkHideTitles(ids: number[]): number {
  if (ids.length === 0) return 0
  const placeholders = ids.map(() => '?').join(',')
  const result = db
    .prepare(`UPDATE titles SET hidden = 1, manual_override = 1 WHERE id IN (${placeholders})`)
    .run(...ids)
  return Number(result.changes ?? 0)
}

export function bulkHideUnmatched(): number {
  const result = db
    .prepare(`UPDATE titles SET hidden = 1, manual_override = 1 WHERE tmdb_id < 0 AND hidden = 0`)
    .run()
  return Number(result.changes ?? 0)
}
