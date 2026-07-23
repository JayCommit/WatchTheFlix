import { db } from './connection.ts'
import { getProgress } from './progress.ts'
import { getTitleById } from './titles.ts'
import type { MediaFileRow } from './types.ts'

export function upsertMediaFile(input: {
  path: string
  filename: string
  size?: number | null
  titleId: number
  season?: number | null
  episode?: number | null
  episodeName?: string | null
  /** Keep existing episode_name when new value is null. */
  keepEpisodeName?: boolean
}): void {
  const existing = input.keepEpisodeName
    ? (db.prepare(`SELECT episode_name FROM media_files WHERE path = ?`).get(input.path) as
        | { episode_name: string | null }
        | undefined)
    : undefined
  const episodeName =
    input.episodeName ?? (input.keepEpisodeName ? (existing?.episode_name ?? null) : null)

  db.prepare(`
    INSERT INTO media_files (path, filename, size, title_id, season, episode, episode_name, scanned_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(path) DO UPDATE SET
      filename = excluded.filename,
      size = excluded.size,
      title_id = excluded.title_id,
      season = excluded.season,
      episode = excluded.episode,
      episode_name = excluded.episode_name,
      scanned_at = excluded.scanned_at
  `).run(
    input.path,
    input.filename,
    input.size ?? null,
    input.titleId,
    input.season ?? null,
    input.episode ?? null,
    episodeName,
    new Date().toISOString(),
  )
}

export function clearLibrary(): void {
  db.exec(`DELETE FROM media_files`)
  db.exec(`DELETE FROM titles`)
}

/** Remove files whose paths are not in the given set; prune empty non-override titles. */
export function pruneMissingFiles(seenPaths: Set<string>): void {
  const all = db.prepare(`SELECT path FROM media_files`).all() as Array<{ path: string }>
  for (const row of all) {
    if (!seenPaths.has(row.path)) deleteMediaFileRow(row.path)
  }
  db.exec(`
    DELETE FROM titles
    WHERE id NOT IN (SELECT DISTINCT title_id FROM media_files)
      AND manual_override = 0
  `)
}

export function listMediaFilesWithTitles(): Array<MediaFileRow & { manual_override: number; hidden: number }> {
  return db
    .prepare(
      `
      SELECT f.*, t.manual_override, t.hidden
      FROM media_files f
      JOIN titles t ON t.id = f.title_id
    `,
    )
    .all() as Array<MediaFileRow & { manual_override: number; hidden: number }>
}

export function getFilesForTitle(titleId: number): MediaFileRow[] {
  return db
    .prepare(
      `SELECT * FROM media_files WHERE title_id = ?
       ORDER BY CASE WHEN season IS NULL THEN 1 ELSE 0 END, season ASC,
                CASE WHEN episode IS NULL THEN 1 ELSE 0 END, episode ASC,
                filename ASC`,
    )
    .all(titleId) as MediaFileRow[]
}

export function getMediaFileByPath(path: string): MediaFileRow | undefined {
  return db.prepare(`SELECT * FROM media_files WHERE path = ?`).get(path) as
    | MediaFileRow
    | undefined
}

export function updateEpisodeName(path: string, episodeName: string | null): void {
  db.prepare(`UPDATE media_files SET episode_name = ? WHERE path = ?`).run(episodeName, path)
}

export function reassignMediaFile(path: string, titleId: number): MediaFileRow | undefined {
  const file = getMediaFileByPath(path)
  const title = getTitleById(titleId)
  if (!file || !title) return undefined
  db.prepare(`UPDATE media_files SET title_id = ? WHERE path = ?`).run(titleId, path)
  return getMediaFileByPath(path)
}

export function countFilesForTitle(titleId: number): number {
  return (
    db.prepare(`SELECT COUNT(*) AS c FROM media_files WHERE title_id = ?`).get(titleId) as {
      c: number
    }
  ).c
}

export function updateMediaProbe(
  path: string,
  probe: {
    container?: string | null
    videoCodec?: string | null
    audioCodec?: string | null
    playbackMode?: string | null
    canDirect?: boolean | null
    probeError?: string | null
    duration?: number | null
    /** When true, only update error/canDirect fields — keep prior codec data. */
    errorOnly?: boolean
  },
): void {
  if (probe.errorOnly) {
    db.prepare(`
      UPDATE media_files SET
        can_direct = ?,
        probe_error = ?,
        probed_at = ?
      WHERE path = ?
    `).run(
      probe.canDirect == null ? 0 : probe.canDirect ? 1 : 0,
      probe.probeError ?? null,
      new Date().toISOString(),
      path,
    )
    return
  }

  db.prepare(`
    UPDATE media_files SET
      container = ?,
      video_codec = ?,
      audio_codec = ?,
      playback_mode = ?,
      can_direct = ?,
      probe_error = ?,
      probed_at = ?
    WHERE path = ?
  `).run(
    probe.container ?? null,
    probe.videoCodec ?? null,
    probe.audioCodec ?? null,
    probe.playbackMode ?? null,
    probe.canDirect == null ? null : probe.canDirect ? 1 : 0,
    probe.probeError ?? null,
    new Date().toISOString(),
    path,
  )
  // Intentionally do not write probe duration into progress — that inflated
  // "known runtime" stats and created fake continue-watching rows.
}

/** Point the library at a new file path after conversion; migrate progress. */
export function replaceMediaPath(
  oldPath: string,
  newPath: string,
  filename: string,
  size: number | null,
): void {
  const file = getMediaFileByPath(oldPath)
  if (!file) throw new Error(`Media file not found: ${oldPath}`)

  const progress = getProgress(oldPath)
  db.prepare(`DELETE FROM media_files WHERE path = ?`).run(newPath)
  db.prepare(`
    UPDATE media_files SET path = ?, filename = ?, size = ?, scanned_at = ? WHERE path = ?
  `).run(newPath, filename, size, new Date().toISOString(), oldPath)

  if (progress) {
    db.prepare(`DELETE FROM progress WHERE path = ?`).run(newPath)
    db.prepare(`
      INSERT INTO progress (path, position, duration, updated_at)
      VALUES (?, ?, ?, ?)
    `).run(newPath, progress.position, progress.duration, new Date().toISOString())
    db.prepare(`DELETE FROM progress WHERE path = ?`).run(oldPath)
  }

  db.prepare(`UPDATE playback_sessions SET path = ? WHERE path = ?`).run(newPath, oldPath)
}

const NEEDS_CONVERT_WHERE = `
  t.hidden = 0
  AND (
    f.can_direct = 0
    OR f.playback_mode IN ('remux', 'transcode')
    OR f.probe_error IS NOT NULL
    OR (f.probed_at IS NOT NULL AND f.video_codec IS NULL)
    OR (
      f.probed_at IS NULL AND (
        lower(f.filename) LIKE '%.mkv'
        OR lower(f.filename) LIKE '%.avi'
        OR lower(f.filename) LIKE '%.ts'
        OR lower(f.filename) LIKE '%.m2ts'
        OR lower(f.filename) LIKE '%.mts'
        OR lower(f.filename) LIKE '%.wmv'
        OR lower(f.filename) LIKE '%.flv'
      )
    )
  )
`

/** Remux candidates: H.264 or already classified remux (and not direct). */
const ACTION_REMUX_SQL = `
  (
    f.can_direct = 0
    AND f.probe_error IS NULL
    AND (
      f.playback_mode = 'remux'
      OR lower(COALESCE(f.video_codec, '')) = 'h264'
    )
  )
`

/** Transcode candidates: non-H.264 / classified transcode. */
const ACTION_TRANSCODE_SQL = `
  (
    f.can_direct = 0
    AND f.probe_error IS NULL
    AND (
      f.playback_mode = 'transcode'
      OR (
        f.video_codec IS NOT NULL
        AND lower(f.video_codec) != 'h264'
        AND COALESCE(f.playback_mode, '') != 'remux'
      )
    )
  )
`

const ACTION_UNKNOWN_SQL = `
  (
    f.probe_error IS NOT NULL
    OR f.video_codec IS NULL
    OR f.playback_mode IS NULL
    OR f.can_direct IS NULL
  )
`

export type NeedsConvertActionFilter = 'all' | 'remux' | 'transcode' | 'unknown'

export type NeedsConvertQuery = {
  limit?: number
  offset?: number
  q?: string
  action?: NeedsConvertActionFilter
  kind?: 'movie' | 'tv' | ''
}

export type NeedsConvertFileRow = MediaFileRow & {
  title: string
  kind: string
  poster_path: string | null
}

function actionFilterSql(action: NeedsConvertActionFilter | undefined): string {
  if (action === 'remux') return `AND ${ACTION_REMUX_SQL}`
  if (action === 'transcode') return `AND ${ACTION_TRANSCODE_SQL}`
  if (action === 'unknown') return `AND ${ACTION_UNKNOWN_SQL}`
  return ''
}

function buildNeedsConvertFilters(opts: NeedsConvertQuery = {}): {
  where: string
  params: Array<string | number>
} {
  const params: Array<string | number> = []
  let where = NEEDS_CONVERT_WHERE
  where += ` ${actionFilterSql(opts.action)}`
  if (opts.kind === 'movie' || opts.kind === 'tv') {
    where += ` AND t.kind = ?`
    params.push(opts.kind)
  }
  const q = (opts.q || '').trim()
  if (q) {
    where += ` AND (t.title LIKE ? OR f.filename LIKE ? OR f.path LIKE ?)`
    const like = `%${q.replace(/[%_]/g, '')}%`
    params.push(like, like, like)
  }
  return { where, params }
}

export function queryFilesNeedingConvert(opts: NeedsConvertQuery = {}): {
  files: NeedsConvertFileRow[]
  total: number
  remuxCount: number
  transcodeCount: number
  unknownCount: number
} {
  const limit = Math.min(200, Math.max(1, Number(opts.limit ?? 50) || 50))
  const offset = Math.max(0, Number(opts.offset ?? 0) || 0)
  const { where, params } = buildNeedsConvertFilters(opts)

  const total = (
    db
      .prepare(
        `
        SELECT COUNT(*) AS c
        FROM media_files f
        JOIN titles t ON t.id = f.title_id
        WHERE ${where}
      `,
      )
      .get(...params) as { c: number }
  ).c

  const files = db
    .prepare(
      `
      SELECT f.*, t.title, t.kind, t.poster_path
      FROM media_files f
      JOIN titles t ON t.id = f.title_id
      WHERE ${where}
      ORDER BY t.title ASC, f.filename ASC
      LIMIT ? OFFSET ?
    `,
    )
    .all(...params, limit, offset) as NeedsConvertFileRow[]

  // Action breakdown ignores the action filter so chips stay useful while filtering.
  const base = buildNeedsConvertFilters({ ...opts, action: 'all' })
  const remuxCount = (
    db
      .prepare(
        `
        SELECT COUNT(*) AS c
        FROM media_files f
        JOIN titles t ON t.id = f.title_id
        WHERE ${base.where} AND ${ACTION_REMUX_SQL}
      `,
      )
      .get(...base.params) as { c: number }
  ).c
  const transcodeCount = (
    db
      .prepare(
        `
        SELECT COUNT(*) AS c
        FROM media_files f
        JOIN titles t ON t.id = f.title_id
        WHERE ${base.where} AND ${ACTION_TRANSCODE_SQL}
      `,
      )
      .get(...base.params) as { c: number }
  ).c
  const unknownCount = (
    db
      .prepare(
        `
        SELECT COUNT(*) AS c
        FROM media_files f
        JOIN titles t ON t.id = f.title_id
        WHERE ${base.where} AND ${ACTION_UNKNOWN_SQL}
      `,
      )
      .get(...base.params) as { c: number }
  ).c

  return { files, total, remuxCount, transcodeCount, unknownCount }
}

/** @deprecated Prefer queryFilesNeedingConvert — kept for probe enqueue helpers. */
export function listFilesNeedingConvert(limit = 200): NeedsConvertFileRow[] {
  return queryFilesNeedingConvert({ limit, offset: 0 }).files
}

/** Paths to ffprobe for codec detection (unprobed / failed, or entire library when force). */
export function listPathsForCodecProbe(opts?: { force?: boolean }): string[] {
  if (opts?.force) {
    return (
      db
        .prepare(
          `
          SELECT f.path
          FROM media_files f
          JOIN titles t ON t.id = f.title_id
          WHERE t.hidden = 0
          ORDER BY f.path ASC
        `,
        )
        .all() as Array<{ path: string }>
    ).map((r) => r.path)
  }

  return (
    db
      .prepare(
        `
        SELECT f.path
        FROM media_files f
        JOIN titles t ON t.id = f.title_id
        WHERE t.hidden = 0
          AND (
            f.probed_at IS NULL
            OR f.probe_error IS NOT NULL
            OR f.video_codec IS NULL
            OR f.playback_mode IS NULL
            OR f.can_direct IS NULL
          )
        ORDER BY f.path ASC
      `,
      )
      .all() as Array<{ path: string }>
  ).map((r) => r.path)
}

export function countProbeCoverage(): {
  total: number
  probed: number
  unprobed: number
  needsConvert: number
  direct: number
} {
  const total = (
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM media_files f JOIN titles t ON t.id = f.title_id WHERE t.hidden = 0`,
      )
      .get() as { c: number }
  ).c
  const probed = (
    db
      .prepare(
        `
        SELECT COUNT(*) AS c FROM media_files f
        JOIN titles t ON t.id = f.title_id
        WHERE t.hidden = 0
          AND f.probed_at IS NOT NULL
          AND f.video_codec IS NOT NULL
          AND f.probe_error IS NULL
      `,
      )
      .get() as { c: number }
  ).c
  const needsConvert = (
    db
      .prepare(
        `
        SELECT COUNT(*) AS c FROM media_files f
        JOIN titles t ON t.id = f.title_id
        WHERE t.hidden = 0
          AND f.can_direct = 0
          AND f.playback_mode IN ('remux', 'transcode')
      `,
      )
      .get() as { c: number }
  ).c
  const direct = (
    db
      .prepare(
        `
        SELECT COUNT(*) AS c FROM media_files f
        JOIN titles t ON t.id = f.title_id
        WHERE t.hidden = 0 AND f.can_direct = 1
      `,
      )
      .get() as { c: number }
  ).c
  return { total, probed, unprobed: Math.max(0, total - probed), needsConvert, direct }
}

export function deleteMediaFileRow(path: string): boolean {
  db.prepare(`DELETE FROM progress WHERE path = ?`).run(path)
  db.prepare(`DELETE FROM profile_progress WHERE path = ?`).run(path)
  db.prepare(`DELETE FROM playback_sessions WHERE path = ?`).run(path)
  db.prepare(`DELETE FROM preferred_files WHERE path = ?`).run(path)
  const result = db.prepare(`DELETE FROM media_files WHERE path = ?`).run(path)
  return Number(result.changes ?? 0) > 0
}

export function setPreferredFile(
  titleId: number,
  path: string,
  season: number | null,
  episode: number | null,
): void {
  const s = season ?? -1
  const e = episode ?? -1
  db.prepare(`
    INSERT INTO preferred_files (title_id, season, episode, path)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(title_id, season, episode) DO UPDATE SET path = excluded.path
  `).run(titleId, s, e, path)
}

export function getPreferredFile(
  titleId: number,
  season: number | null,
  episode: number | null,
): string | null {
  const row = db
    .prepare(`SELECT path FROM preferred_files WHERE title_id = ? AND season = ? AND episode = ?`)
    .get(titleId, season ?? -1, episode ?? -1) as { path: string } | undefined
  return row?.path ?? null
}
