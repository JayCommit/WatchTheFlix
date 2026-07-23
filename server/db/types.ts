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

export type ProfileRow = {
  id: number
  name: string
  created_at: string
  user_id: number | null
}
