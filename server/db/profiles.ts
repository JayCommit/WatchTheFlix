import { db } from './connection.ts'
import { upsertProgress } from './progress.ts'
import type { ProfileRow, ProgressRow, TitleRow } from './types.ts'

export function listProfiles(): ProfileRow[] {
  return db.prepare(`SELECT * FROM profiles ORDER BY id ASC`).all() as ProfileRow[]
}

export function listProfilesForUser(userId: number): ProfileRow[] {
  return db
    .prepare(`SELECT * FROM profiles WHERE user_id = ? ORDER BY id ASC`)
    .all(userId) as ProfileRow[]
}

export function getProfile(id: number): ProfileRow | undefined {
  return db.prepare(`SELECT * FROM profiles WHERE id = ?`).get(id) as ProfileRow | undefined
}

export function userOwnsProfile(userId: number, profileId: number): boolean {
  const row = db
    .prepare(`SELECT id FROM profiles WHERE id = ? AND user_id = ?`)
    .get(profileId, userId) as { id: number } | undefined
  return Boolean(row)
}

export function createProfile(name: string, userId: number): ProfileRow {
  const trimmed = name.trim().slice(0, 40)
  if (!trimmed) throw new Error('Name required')
  const count = (
    db.prepare(`SELECT COUNT(*) AS c FROM profiles WHERE user_id = ?`).get(userId) as { c: number }
  ).c
  if (count >= 5) throw new Error('Maximum of 5 profiles')
  const result = db
    .prepare(`INSERT INTO profiles (name, created_at, user_id) VALUES (?, ?, ?)`)
    .run(trimmed, new Date().toISOString(), userId)
  return getProfile(Number(result.lastInsertRowid))!
}

export function deleteProfile(id: number, userId: number): boolean {
  if (!userOwnsProfile(userId, id)) throw new Error('Profile not found')
  const count = (
    db.prepare(`SELECT COUNT(*) AS c FROM profiles WHERE user_id = ?`).get(userId) as { c: number }
  ).c
  if (count <= 1) throw new Error('Cannot delete your only profile')
  const result = db.prepare(`DELETE FROM profiles WHERE id = ? AND user_id = ?`).run(id, userId)
  return Number(result.changes ?? 0) > 0
}

export function getProfileProgress(profileId: number, path: string): ProgressRow | undefined {
  return db
    .prepare(
      `SELECT path, position, duration, updated_at FROM profile_progress WHERE profile_id = ? AND path = ?`,
    )
    .get(profileId, path) as ProgressRow | undefined
}

export function upsertProfileProgress(
  profileId: number,
  path: string,
  position: number,
  duration: number,
): void {
  db.prepare(`
    INSERT INTO profile_progress (profile_id, path, position, duration, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(profile_id, path) DO UPDATE SET
      position = excluded.position,
      duration = excluded.duration,
      updated_at = excluded.updated_at
  `).run(profileId, path, position, duration, new Date().toISOString())
  // Keep legacy progress in sync for profile 1 (older APIs / continue watching)
  if (profileId === 1) upsertProgress(path, position, duration)
}

export function listProfileContinueWatching(profileId: number, limit = 24) {
  return db
    .prepare(
      `
      SELECT p.path, p.position, p.duration, p.updated_at,
             f.filename, f.season, f.episode, f.title_id,
             t.kind, t.title, t.poster_path, t.backdrop_path
      FROM profile_progress p
      JOIN media_files f ON f.path = p.path
      JOIN titles t ON t.id = f.title_id
      WHERE p.profile_id = ?
        AND t.hidden = 0
        AND p.position > 30
        AND (p.duration <= 0 OR p.position / p.duration < 0.92)
      ORDER BY p.updated_at DESC
      LIMIT ?
    `,
    )
    .all(profileId, limit)
}

export function listWatchlist(profileId: number) {
  return db
    .prepare(
      `
      SELECT t.*, w.added_at
      FROM watchlist w
      JOIN titles t ON t.id = w.title_id
      WHERE w.profile_id = ? AND t.hidden = 0
      ORDER BY w.added_at DESC
    `,
    )
    .all(profileId) as Array<TitleRow & { added_at: string }>
}

export function addToWatchlist(profileId: number, titleId: number): void {
  db.prepare(
    `INSERT OR IGNORE INTO watchlist (profile_id, title_id, added_at) VALUES (?, ?, ?)`,
  ).run(profileId, titleId, new Date().toISOString())
}

export function removeFromWatchlist(profileId: number, titleId: number): void {
  db.prepare(`DELETE FROM watchlist WHERE profile_id = ? AND title_id = ?`).run(
    profileId,
    titleId,
  )
}

export function isOnWatchlist(profileId: number, titleId: number): boolean {
  const row = db
    .prepare(`SELECT 1 AS ok FROM watchlist WHERE profile_id = ? AND title_id = ?`)
    .get(profileId, titleId) as { ok: number } | undefined
  return Boolean(row)
}
