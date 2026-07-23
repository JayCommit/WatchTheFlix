import { getConvertJob, getTitleById } from '../db.ts'
import { backdropUrl, posterUrl, type TmdbMatch } from '../tmdb.ts'

export function serializeTitle(row: ReturnType<typeof getTitleById>, extra?: Record<string, unknown>) {
  if (!row) return null
  return {
    id: row.id,
    kind: row.kind,
    tmdbId: row.tmdb_id,
    title: row.title,
    overview: row.overview,
    year: row.year,
    poster: posterUrl(row.poster_path),
    backdrop: backdropUrl(row.backdrop_path),
    posterPath: row.poster_path,
    backdropPath: row.backdrop_path,
    voteAverage: row.vote_average,
    genres: (() => {
      if (!row.genres) return [] as string[]
      try {
        const parsed = JSON.parse(row.genres) as unknown
        return Array.isArray(parsed) ? (parsed as string[]) : []
      } catch {
        return [] as string[]
      }
    })(),
    hidden: Boolean(row.hidden),
    manualOverride: Boolean(row.manual_override),
    ...extra,
  }
}

export function serializeTmdbMatch(m: TmdbMatch) {
  return {
    tmdbId: m.tmdbId,
    title: m.title,
    overview: m.overview,
    year: m.year,
    poster: posterUrl(m.posterPath),
    backdrop: backdropUrl(m.backdropPath),
    posterPath: m.posterPath,
    backdropPath: m.backdropPath,
    voteAverage: m.voteAverage,
    genres: m.genres,
  }
}

export function serializeNowPlaying(s: {
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
  status: 'watching' | 'paused' | 'stalled' | 'stopped'
  idleSeconds: number
  poster_path: string | null
  kind: 'movie' | 'tv' | null
  filename: string | null
}) {
  return {
    clientId: s.client_id,
    path: s.path,
    titleId: s.title_id,
    titleName: s.title_name,
    season: s.season,
    episode: s.episode,
    position: s.position,
    duration: s.duration,
    playbackMode: s.playback_mode,
    state: s.state,
    status: s.status,
    idleSeconds: s.idleSeconds,
    userAgent: s.user_agent,
    ip: s.ip,
    startedAt: s.started_at,
    lastSeenAt: s.last_seen_at,
    poster: posterUrl(s.poster_path),
    kind: s.kind,
    filename: s.filename,
    progressPct:
      s.duration > 0 ? Math.min(100, Math.round((s.position / s.duration) * 1000) / 10) : 0,
  }
}

export function serializeConvertJob(j: ReturnType<typeof getConvertJob>) {
  if (!j) return null
  return {
    id: j.id,
    path: j.path,
    titleId: j.title_id,
    titleName: j.title_name,
    status: j.status,
    mode: j.mode,
    replaceOriginal: Boolean(j.replace_original),
    deleteOriginal: Boolean(j.delete_original),
    progress: j.progress,
    container: j.container,
    videoCodec: j.video_codec,
    audioCodec: j.audio_codec,
    outputPath: j.output_path,
    quarantinedPath: j.quarantined_path,
    error: j.error,
    createdAt: j.created_at,
    startedAt: j.started_at,
    finishedAt: j.finished_at,
  }
}
