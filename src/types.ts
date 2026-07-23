export type Title = {
  id: number
  kind: 'movie' | 'tv'
  tmdbId: number
  title: string
  overview: string | null
  year: number | null
  poster: string | null
  backdrop: string | null
  voteAverage: number | null
  genres: string[]
}

export type Progress = {
  path: string
  position: number
  duration: number
  updated_at?: string
}

export type MediaFile = {
  path: string
  filename: string
  size: number | null
  season?: number | null
  episode?: number | null
  episodeName?: string | null
  label?: string
  progress: Progress | null
}

export type AudioTrack = {
  index: number
  codec: string | null
  language: string | null
  title: string | null
  channels: number | null
}

export type SubtitleTrack = {
  index: number
  codec: string | null
  language: string | null
  title: string | null
  kind: 'embedded' | 'external'
  path?: string
}

export type ContinueItem = {
  path: string
  position: number
  duration: number
  updatedAt: string
  filename: string
  titleId: number
  kind: 'movie' | 'tv'
  title: string
  poster: string | null
  backdrop: string | null
  season: number | null
  episode: number | null
}

export type LibraryResponse = {
  movies: Title[]
  shows: Title[]
  recent: Title[]
  continueWatching: ContinueItem[]
  lastScan: string | null
  counts: { titles: number; files: number }
}

export type TitleDetail = Title & { files: MediaFile[] }

export type AdminTitle = Title & {
  hidden: boolean
  unmatched: boolean
  fileCount: number
  scannedAt?: string
  files?: Array<{
    path: string
    filename: string
    size: number | null
    season?: number | null
    episode?: number | null
    episodeName?: string | null
    progress?: Progress | null
    container?: string | null
    videoCodec?: string | null
    audioCodec?: string | null
    playbackMode?: string | null
    canDirect?: boolean | null
    probedAt?: string | null
  }>
}

export type ConvertJob = {
  id: number
  path: string
  titleId: number | null
  titleName: string | null
  status: string
  mode: string
  replaceOriginal: boolean
  deleteOriginal: boolean
  progress: number
  container: string | null
  videoCodec: string | null
  audioCodec: string | null
  outputPath: string | null
  quarantinedPath: string | null
  error: string | null
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
}

export type ConvertNeedsFile = {
  path: string
  filename: string
  size: number | null
  titleId: number
  title: string
  kind: 'movie' | 'tv'
  poster: string | null
  season: number | null
  episode: number | null
  container: string | null
  videoCodec: string | null
  audioCodec: string | null
  playbackMode: string | null
  canDirect: boolean | null
  probedAt: string | null
}

export type TmdbSearchResult = {
  tmdbId: number
  title: string
  year: number | null
  overview: string
  poster: string | null
  voteAverage: number
}

export type NowPlayingSession = {
  clientId: string
  path: string
  titleId: number | null
  titleName: string | null
  season: number | null
  episode: number | null
  position: number
  duration: number
  playbackMode: string | null
  state: string
  status: 'watching' | 'paused' | 'stalled' | 'stopped'
  idleSeconds: number
  userAgent: string | null
  ip: string | null
  startedAt: string
  lastSeenAt: string
  poster: string | null
  kind: 'movie' | 'tv' | null
  filename: string | null
  progressPct: number
}

export type AdminOverview = {
  stats: {
    movies: number
    shows: number
    unmatched: number
    hidden: number
    files: number
    movieFiles: number
    tvFiles: number
    knownDurationSeconds: number
    knownDurationHours: number
    progressRows: number
    titles: number
  }
  lastScan: string | null
  ffmpegAvailable: boolean
  nowPlayingCount: number
  nowPlaying: NowPlayingSession[]
  recent: AdminTitle[]
}

export type ActivityEvent = {
  id: number
  clientId: string | null
  path: string | null
  titleId: number | null
  titleName: string | null
  season: number | null
  episode: number | null
  position: number | null
  duration: number | null
  eventType: string
  detail: string | null
  createdAt: string
}

export type ActivityProgress = {
  path: string
  position: number
  duration: number
  updatedAt: string
  filename: string
  titleId: number
  kind: 'movie' | 'tv'
  title: string
  poster: string | null
  season: number | null
  episode: number | null
}
