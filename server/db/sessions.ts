import { db } from './connection.ts'
import { getMediaFileByPath } from './media-files.ts'
import { getTitleById } from './titles.ts'
import type { ActivityEventRow, PlaybackSessionRow } from './types.ts'

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
