import { db } from './connection.ts'
import { getFilesForTitle } from './media-files.ts'
import type { ProgressRow } from './types.ts'

export function upsertProgress(path: string, position: number, duration: number): void {
  db.prepare(`
    INSERT INTO progress (path, position, duration, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(path) DO UPDATE SET
      position = excluded.position,
      duration = excluded.duration,
      updated_at = excluded.updated_at
  `).run(path, position, duration, new Date().toISOString())
}

export function getProgress(path: string): ProgressRow | undefined {
  return db.prepare(`SELECT * FROM progress WHERE path = ?`).get(path) as ProgressRow | undefined
}

export function listContinueWatching(limit = 20): Array<{
  path: string
  position: number
  duration: number
  updated_at: string
  filename: string
  title_id: number
  kind: 'movie' | 'tv'
  title: string
  poster_path: string | null
  backdrop_path: string | null
  season: number | null
  episode: number | null
}> {
  return db
    .prepare(
      `
      SELECT
        p.path, p.position, p.duration, p.updated_at,
        f.filename, f.title_id, f.season, f.episode,
        t.kind, t.title, t.poster_path, t.backdrop_path
      FROM progress p
      JOIN media_files f ON f.path = p.path
      JOIN titles t ON t.id = f.title_id
      WHERE t.hidden = 0
        AND p.position > 30 AND (p.duration = 0 OR p.position / p.duration < 0.92)
      ORDER BY p.updated_at DESC
      LIMIT ?
    `,
    )
    .all(limit) as Array<{
    path: string
    position: number
    duration: number
    updated_at: string
    filename: string
    title_id: number
    kind: 'movie' | 'tv'
    title: string
    poster_path: string | null
    backdrop_path: string | null
    season: number | null
    episode: number | null
  }>
}

export function listRecentProgressActivity(limit = 50): Array<{
  path: string
  position: number
  duration: number
  updated_at: string
  filename: string
  title_id: number
  kind: 'movie' | 'tv'
  title: string
  poster_path: string | null
  season: number | null
  episode: number | null
}> {
  return db
    .prepare(
      `
      SELECT
        p.path, p.position, p.duration, p.updated_at,
        f.filename, f.title_id, f.season, f.episode,
        t.kind, t.title, t.poster_path
      FROM progress p
      JOIN media_files f ON f.path = p.path
      JOIN titles t ON t.id = f.title_id
      ORDER BY p.updated_at DESC
      LIMIT ?
    `,
    )
    .all(limit) as Array<{
    path: string
    position: number
    duration: number
    updated_at: string
    filename: string
    title_id: number
    kind: 'movie' | 'tv'
    title: string
    poster_path: string | null
    season: number | null
    episode: number | null
  }>
}

export function clearProgress(path: string): boolean {
  const result = db.prepare(`DELETE FROM progress WHERE path = ?`).run(path)
  return Number(result.changes ?? 0) > 0
}

export function clearProgressForTitle(titleId: number): number {
  const result = db
    .prepare(
      `
      DELETE FROM progress WHERE path IN (
        SELECT path FROM media_files WHERE title_id = ?
      )
    `,
    )
    .run(titleId)
  return Number(result.changes ?? 0)
}

export function markProgressWatched(path: string, durationHint = 0): ProgressRow | undefined {
  const existing = getProgress(path)
  const duration = durationHint > 0 ? durationHint : (existing?.duration ?? 0)
  // Without a known duration, use a 1/1 sentinel so UI treats the file as finished.
  if (duration <= 0) {
    upsertProgress(path, 1, 1)
  } else {
    const position = Math.max(duration * 0.97, duration - 5)
    upsertProgress(path, position, duration)
  }
  return getProgress(path)
}

export function markTitleWatched(titleId: number): number {
  const files = getFilesForTitle(titleId)
  let n = 0
  for (const f of files) {
    const existing = getProgress(f.path)
    const duration = existing?.duration ?? 0
    markProgressWatched(f.path, duration)
    n += 1
  }
  return n
}
