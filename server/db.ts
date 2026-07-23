import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dataDir = join(__dirname, '..', 'data')
mkdirSync(dataDir, { recursive: true })

const db = new DatabaseSync(join(dataDir, 'library.db'))

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS titles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL CHECK(kind IN ('movie', 'tv')),
    tmdb_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    overview TEXT,
    year INTEGER,
    poster_path TEXT,
    backdrop_path TEXT,
    vote_average REAL,
    genres TEXT,
    UNIQUE(kind, tmdb_id)
  );

  CREATE TABLE IF NOT EXISTS media_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT NOT NULL UNIQUE,
    filename TEXT NOT NULL,
    size INTEGER,
    title_id INTEGER NOT NULL,
    season INTEGER,
    episode INTEGER,
    episode_name TEXT,
    scanned_at TEXT NOT NULL,
    FOREIGN KEY(title_id) REFERENCES titles(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS progress (
    path TEXT PRIMARY KEY,
    position REAL NOT NULL DEFAULT 0,
    duration REAL NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS scan_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS playback_sessions (
    client_id TEXT PRIMARY KEY,
    path TEXT NOT NULL,
    title_id INTEGER,
    title_name TEXT,
    season INTEGER,
    episode INTEGER,
    position REAL NOT NULL DEFAULT 0,
    duration REAL NOT NULL DEFAULT 0,
    playback_mode TEXT,
    state TEXT NOT NULL DEFAULT 'playing',
    user_agent TEXT,
    ip TEXT,
    started_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS activity_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id TEXT,
    path TEXT,
    title_id INTEGER,
    title_name TEXT,
    season INTEGER,
    episode INTEGER,
    position REAL,
    duration REAL,
    event_type TEXT NOT NULL,
    detail TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS convert_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT NOT NULL,
    title_id INTEGER,
    title_name TEXT,
    status TEXT NOT NULL DEFAULT 'queued',
    mode TEXT NOT NULL DEFAULT 'auto',
    replace_original INTEGER NOT NULL DEFAULT 1,
    delete_original INTEGER NOT NULL DEFAULT 0,
    progress REAL NOT NULL DEFAULT 0,
    container TEXT,
    video_codec TEXT,
    audio_codec TEXT,
    output_path TEXT,
    quarantined_path TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT
  );
`)

function columnExists(table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  return rows.some((r) => r.name === column)
}

function migrate(): void {
  if (!columnExists('titles', 'hidden')) {
    db.exec(`ALTER TABLE titles ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0`)
  }
  if (!columnExists('titles', 'manual_override')) {
    db.exec(`ALTER TABLE titles ADD COLUMN manual_override INTEGER NOT NULL DEFAULT 0`)
  }
  if (!columnExists('media_files', 'container')) {
    db.exec(`ALTER TABLE media_files ADD COLUMN container TEXT`)
  }
  if (!columnExists('media_files', 'video_codec')) {
    db.exec(`ALTER TABLE media_files ADD COLUMN video_codec TEXT`)
  }
  if (!columnExists('media_files', 'audio_codec')) {
    db.exec(`ALTER TABLE media_files ADD COLUMN audio_codec TEXT`)
  }
  if (!columnExists('media_files', 'playback_mode')) {
    db.exec(`ALTER TABLE media_files ADD COLUMN playback_mode TEXT`)
  }
  if (!columnExists('media_files', 'can_direct')) {
    db.exec(`ALTER TABLE media_files ADD COLUMN can_direct INTEGER`)
  }
  if (!columnExists('media_files', 'probe_error')) {
    db.exec(`ALTER TABLE media_files ADD COLUMN probe_error TEXT`)
  }
  if (!columnExists('media_files', 'probed_at')) {
    db.exec(`ALTER TABLE media_files ADD COLUMN probed_at TEXT`)
  }
}

migrate()

export type TitleRow = {
  id: number
  kind: 'movie' | 'tv'
  tmdb_id: number
  title: string
  overview: string | null
  year: number | null
  poster_path: string | null
  backdrop_path: string | null
  vote_average: number | null
  genres: string | null
  hidden: number
  manual_override: number
}

export type MediaFileRow = {
  id: number
  path: string
  filename: string
  size: number | null
  title_id: number
  season: number | null
  episode: number | null
  episode_name: string | null
  scanned_at: string
  container?: string | null
  video_codec?: string | null
  audio_codec?: string | null
  playback_mode?: string | null
  can_direct?: number | null
  probe_error?: string | null
  probed_at?: string | null
}

export type ConvertJobRow = {
  id: number
  path: string
  title_id: number | null
  title_name: string | null
  status: string
  mode: string
  replace_original: number
  delete_original: number
  progress: number
  container: string | null
  video_codec: string | null
  audio_codec: string | null
  output_path: string | null
  quarantined_path: string | null
  error: string | null
  created_at: string
  started_at: string | null
  finished_at: string | null
}

export type ProgressRow = {
  path: string
  position: number
  duration: number
  updated_at: string
}

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
  const del = db.prepare(`DELETE FROM media_files WHERE path = ?`)
  for (const row of all) {
    if (!seenPaths.has(row.path)) del.run(row.path)
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

export function setScanMeta(key: string, value: string): void {
  db.prepare(`
    INSERT INTO scan_meta (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value)
}

export function getScanMeta(key: string): string | null {
  const row = db.prepare(`SELECT value FROM scan_meta WHERE key = ?`).get(key) as
    | { value: string }
    | undefined
  return row?.value ?? null
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

export function reassignMediaFile(path: string, titleId: number): MediaFileRow | undefined {
  const file = getMediaFileByPath(path)
  const title = getTitleById(titleId)
  if (!file || !title) return undefined
  db.prepare(`UPDATE media_files SET title_id = ? WHERE path = ?`).run(titleId, path)
  return getMediaFileByPath(path)
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

export function countFilesForTitle(titleId: number): number {
  return (
    db.prepare(`SELECT COUNT(*) AS c FROM media_files WHERE title_id = ?`).get(titleId) as {
      c: number
    }
  ).c
}

export type PlaybackSessionRow = {
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
}

export type ActivityEventRow = {
  id: number
  client_id: string | null
  path: string | null
  title_id: number | null
  title_name: string | null
  season: number | null
  episode: number | null
  position: number | null
  duration: number | null
  event_type: string
  detail: string | null
  created_at: string
}

const WATCHING_WINDOW_MS = 2 * 60 * 1000

export function upsertPlaybackSession(input: {
  clientId: string
  path: string
  titleId?: number | null
  titleName?: string | null
  season?: number | null
  episode?: number | null
  position: number
  duration: number
  playbackMode?: string | null
  state: 'playing' | 'paused' | 'stopped'
  userAgent?: string | null
  ip?: string | null
}): PlaybackSessionRow {
  const now = new Date().toISOString()
  const existing = db
    .prepare(`SELECT * FROM playback_sessions WHERE client_id = ?`)
    .get(input.clientId) as PlaybackSessionRow | undefined

  const startedAt =
    existing && existing.path === input.path && input.state !== 'stopped'
      ? existing.started_at
      : now

  if (input.state === 'stopped') {
    if (existing) {
      db.prepare(`
        UPDATE playback_sessions SET
          path = ?, title_id = ?, title_name = ?, season = ?, episode = ?,
          position = ?, duration = ?, playback_mode = ?, state = ?,
          user_agent = COALESCE(?, user_agent), ip = COALESCE(?, ip),
          last_seen_at = ?
        WHERE client_id = ?
      `).run(
        input.path,
        input.titleId ?? null,
        input.titleName ?? null,
        input.season ?? null,
        input.episode ?? null,
        input.position,
        input.duration,
        input.playbackMode ?? null,
        'stopped',
        input.userAgent ?? null,
        input.ip ?? null,
        now,
        input.clientId,
      )
    }
  } else {
    db.prepare(`
      INSERT INTO playback_sessions (
        client_id, path, title_id, title_name, season, episode,
        position, duration, playback_mode, state, user_agent, ip, started_at, last_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(client_id) DO UPDATE SET
        path = excluded.path,
        title_id = excluded.title_id,
        title_name = excluded.title_name,
        season = excluded.season,
        episode = excluded.episode,
        position = excluded.position,
        duration = excluded.duration,
        playback_mode = excluded.playback_mode,
        state = excluded.state,
        user_agent = COALESCE(excluded.user_agent, playback_sessions.user_agent),
        ip = COALESCE(excluded.ip, playback_sessions.ip),
        started_at = excluded.started_at,
        last_seen_at = excluded.last_seen_at
    `).run(
      input.clientId,
      input.path,
      input.titleId ?? null,
      input.titleName ?? null,
      input.season ?? null,
      input.episode ?? null,
      input.position,
      input.duration,
      input.playbackMode ?? null,
      input.state,
      input.userAgent ?? null,
      input.ip ?? null,
      startedAt,
      now,
    )
  }

  return (
    (db
      .prepare(`SELECT * FROM playback_sessions WHERE client_id = ?`)
      .get(input.clientId) as PlaybackSessionRow | undefined) ?? {
      client_id: input.clientId,
      path: input.path,
      title_id: input.titleId ?? null,
      title_name: input.titleName ?? null,
      season: input.season ?? null,
      episode: input.episode ?? null,
      position: input.position,
      duration: input.duration,
      playback_mode: input.playbackMode ?? null,
      state: input.state,
      user_agent: input.userAgent ?? null,
      ip: input.ip ?? null,
      started_at: startedAt,
      last_seen_at: now,
    }
  )
}

export function getPlaybackSession(clientId: string): PlaybackSessionRow | undefined {
  return db.prepare(`SELECT * FROM playback_sessions WHERE client_id = ?`).get(clientId) as
    | PlaybackSessionRow
    | undefined
}

export function listNowPlaying(opts?: { includeStale?: boolean }): Array<
  PlaybackSessionRow & {
    status: 'watching' | 'paused' | 'stalled' | 'stopped'
    idleSeconds: number
    poster_path: string | null
    kind: 'movie' | 'tv' | null
    filename: string | null
  }
> {
  const includeStale = opts?.includeStale ?? false
  const rows = db
    .prepare(`SELECT * FROM playback_sessions ORDER BY last_seen_at DESC`)
    .all() as PlaybackSessionRow[]
  const now = Date.now()
  const out: Array<
    PlaybackSessionRow & {
      status: 'watching' | 'paused' | 'stalled' | 'stopped'
      idleSeconds: number
      poster_path: string | null
      kind: 'movie' | 'tv' | null
      filename: string | null
    }
  > = []

  for (const row of rows) {
    const idleMs = Math.max(0, now - new Date(row.last_seen_at).getTime())
    const fresh = idleMs <= WATCHING_WINDOW_MS
    let status: 'watching' | 'paused' | 'stalled' | 'stopped'
    if (row.state === 'stopped') status = 'stopped'
    else if (!fresh) status = 'stalled'
    else if (row.state === 'paused') status = 'paused'
    else status = 'watching'

    if (!includeStale && (status === 'stopped' || status === 'stalled')) continue

    const title = row.title_id != null ? getTitleById(row.title_id) : undefined
    const file = getMediaFileByPath(row.path)

    out.push({
      ...row,
      status,
      idleSeconds: Math.round(idleMs / 1000),
      poster_path: title?.poster_path ?? null,
      kind: title?.kind ?? null,
      filename: file?.filename ?? null,
    })
  }
  return out
}

export function pruneOldSessions(maxAgeHours = 24): void {
  const cutoff = new Date(Date.now() - maxAgeHours * 3600 * 1000).toISOString()
  db.prepare(`DELETE FROM playback_sessions WHERE last_seen_at < ?`).run(cutoff)
}

export function insertActivityEvent(input: {
  clientId?: string | null
  path?: string | null
  titleId?: number | null
  titleName?: string | null
  season?: number | null
  episode?: number | null
  position?: number | null
  duration?: number | null
  eventType: string
  detail?: string | null
}): void {
  db.prepare(`
    INSERT INTO activity_events (
      client_id, path, title_id, title_name, season, episode,
      position, duration, event_type, detail, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.clientId ?? null,
    input.path ?? null,
    input.titleId ?? null,
    input.titleName ?? null,
    input.season ?? null,
    input.episode ?? null,
    input.position ?? null,
    input.duration ?? null,
    input.eventType,
    input.detail ?? null,
    new Date().toISOString(),
  )
}

export function listActivityEvents(limit = 50): ActivityEventRow[] {
  return db
    .prepare(`SELECT * FROM activity_events ORDER BY id DESC LIMIT ?`)
    .all(limit) as ActivityEventRow[]
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
  const position = duration > 0 ? Math.max(duration * 0.97, duration - 5) : 1
  upsertProgress(path, position, duration)
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
  const knownDurationSeconds = (
    db.prepare(`SELECT COALESCE(SUM(duration), 0) AS s FROM progress WHERE duration > 0`).get() as {
      s: number
    }
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
  },
): void {
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
  if (probe.duration != null && probe.duration > 0) {
    const existing = getProgress(path)
    if (!existing || !existing.duration) {
      upsertProgress(path, existing?.position ?? 0, probe.duration)
    }
  }
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

export function enqueueConvertJob(input: {
  path: string
  titleId?: number | null
  titleName?: string | null
  mode?: string
  replaceOriginal?: boolean
  deleteOriginal?: boolean
  container?: string | null
  videoCodec?: string | null
  audioCodec?: string | null
}): ConvertJobRow {
  const active = db
    .prepare(
      `SELECT id FROM convert_jobs WHERE path = ? AND status IN ('queued', 'running') LIMIT 1`,
    )
    .get(input.path) as { id: number } | undefined
  if (active) {
    throw new Error(`Convert job already active for this file (id ${active.id})`)
  }

  const created = new Date().toISOString()
  const result = db
    .prepare(
      `
      INSERT INTO convert_jobs (
        path, title_id, title_name, status, mode, replace_original, delete_original,
        progress, container, video_codec, audio_codec, created_at
      ) VALUES (?, ?, ?, 'queued', ?, ?, ?, 0, ?, ?, ?, ?)
    `,
    )
    .run(
      input.path,
      input.titleId ?? null,
      input.titleName ?? null,
      input.mode ?? 'auto',
      input.replaceOriginal === false ? 0 : 1,
      input.deleteOriginal ? 1 : 0,
      input.container ?? null,
      input.videoCodec ?? null,
      input.audioCodec ?? null,
      created,
    )

  return getConvertJob(Number(result.lastInsertRowid))!
}

export function getConvertJob(id: number): ConvertJobRow | undefined {
  return db.prepare(`SELECT * FROM convert_jobs WHERE id = ?`).get(id) as ConvertJobRow | undefined
}

export function listConvertJobs(limit = 100): ConvertJobRow[] {
  return db
    .prepare(`SELECT * FROM convert_jobs ORDER BY created_at DESC LIMIT ?`)
    .all(limit) as ConvertJobRow[]
}

export function listQueuedConvertJobs(limit = 10): ConvertJobRow[] {
  return db
    .prepare(
      `SELECT * FROM convert_jobs WHERE status = 'queued' ORDER BY created_at ASC LIMIT ?`,
    )
    .all(limit) as ConvertJobRow[]
}

export function countRunningConvertJobs(): number {
  return (
    db.prepare(`SELECT COUNT(*) AS c FROM convert_jobs WHERE status = 'running'`).get() as {
      c: number
    }
  ).c
}

export function updateConvertJob(
  id: number,
  patch: Partial<{
    status: string
    mode: string
    progress: number
    outputPath: string | null
    quarantinedPath: string | null
    error: string | null
    startedAt: string | null
    finishedAt: string | null
    container: string | null
    videoCodec: string | null
    audioCodec: string | null
  }>,
): void {
  const cur = getConvertJob(id)
  if (!cur) return
  db.prepare(`
    UPDATE convert_jobs SET
      status = ?,
      mode = ?,
      progress = ?,
      output_path = ?,
      quarantined_path = ?,
      error = ?,
      started_at = ?,
      finished_at = ?,
      container = ?,
      video_codec = ?,
      audio_codec = ?
    WHERE id = ?
  `).run(
    patch.status ?? cur.status,
    patch.mode ?? cur.mode,
    patch.progress ?? cur.progress,
    patch.outputPath !== undefined ? patch.outputPath : cur.output_path,
    patch.quarantinedPath !== undefined ? patch.quarantinedPath : cur.quarantined_path,
    patch.error !== undefined ? patch.error : cur.error,
    patch.startedAt !== undefined ? patch.startedAt : cur.started_at,
    patch.finishedAt !== undefined ? patch.finishedAt : cur.finished_at,
    patch.container !== undefined ? patch.container : cur.container,
    patch.videoCodec !== undefined ? patch.videoCodec : cur.video_codec,
    patch.audioCodec !== undefined ? patch.audioCodec : cur.audio_codec,
    id,
  )
}

export function cancelConvertJob(id: number): ConvertJobRow | undefined {
  const job = getConvertJob(id)
  if (!job) return undefined
  if (job.status === 'queued') {
    updateConvertJob(id, {
      status: 'cancelled',
      finishedAt: new Date().toISOString(),
      error: 'Cancelled',
    })
  } else if (job.status === 'running') {
    updateConvertJob(id, { status: 'cancelling', error: 'Cancel requested' })
  }
  return getConvertJob(id)
}

export function listFilesNeedingConvert(limit = 200): Array<
  MediaFileRow & { title: string; kind: string; poster_path: string | null }
> {
  return db
    .prepare(
      `
      SELECT f.*, t.title, t.kind, t.poster_path
      FROM media_files f
      JOIN titles t ON t.id = f.title_id
      WHERE t.hidden = 0
        AND (
          f.can_direct = 0
          OR f.playback_mode IN ('remux', 'transcode')
          OR (f.probed_at IS NULL AND lower(f.filename) LIKE '%.mkv')
          OR (f.probed_at IS NULL AND lower(f.filename) LIKE '%.avi')
        )
      ORDER BY f.filename ASC
      LIMIT ?
    `,
    )
    .all(limit) as Array<MediaFileRow & { title: string; kind: string; poster_path: string | null }>
}

export function convertJobStats(): {
  queued: number
  running: number
  done: number
  failed: number
} {
  const row = (status: string) =>
    (
      db.prepare(`SELECT COUNT(*) AS c FROM convert_jobs WHERE status = ?`).get(status) as {
        c: number
      }
    ).c
  return {
    queued: row('queued'),
    running: row('running') + row('cancelling'),
    done: row('done'),
    failed: row('failed'),
  }
}
