import type {
  ActivityEvent,
  ActivityProgress,
  AdminOverview,
  AdminTitle,
  ConvertJob,
  ConvertNeedsFile,
  LibraryResponse,
  NowPlayingSession,
  TitleDetail,
  TmdbSearchResult,
} from './types'
import { getClientId } from './utils/clientId'

export class AuthError extends Error {
  constructor(message = 'Session expired') {
    super(message)
    this.name = 'AuthError'
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  if (init?.body != null && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  const res = await fetch(url, {
    ...init,
    credentials: 'include',
    headers,
  })
  // /api/me returns 200 with { authed: false } — only treat protected routes as session loss
  if (res.status === 401 && !url.endsWith('/api/me') && !url.includes('/api/login')) {
    window.dispatchEvent(new Event('wtf:unauthorized'))
    throw new AuthError('Session expired — please sign in again')
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error || `Request failed (${res.status})`)
  }
  return res.json() as Promise<T>
}

function normalizeAdminTitle(t: AdminTitle & { fileCount?: number; unmatched?: boolean }): AdminTitle {
  return {
    ...t,
    fileCount: t.fileCount ?? 0,
    unmatched: t.unmatched ?? t.tmdbId < 0,
    hidden: Boolean(t.hidden),
  }
}

export const api = {
  me: () => request<{ authed: boolean }>('/api/me'),
  login: (password: string) =>
    request<{ ok: boolean }>('/api/login', {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),
  logout: () => request<{ ok: boolean }>('/api/logout', { method: 'POST' }),
  library: () => request<LibraryResponse>('/api/library'),
  diagnostics: () =>
    request<{
      config: {
        webdavHost: string
        webdavUrlSet: boolean
        webdavUserSet: boolean
        webdavPasswordSet: boolean
        mediaRoot: string
        tmdbKeySet: boolean
      }
      webdav: {
        ok: boolean
        mediaRoot: string
        rootEntries: Array<{ type: string; name: string }>
        mediaEntries: Array<{ type: string; name: string }>
        error?: string
      }
      playback: { ffmpegAvailable: boolean }
    }>('/api/diagnostics'),
  scan: () =>
    request<{
      filesFound: number
      matched: number
      unmatched: number
      titles: number
      files: number
      dirsScanned?: number
      mediaRoot?: string
      errors?: string[]
      warning?: string
    }>('/api/scan', { method: 'POST' }),
  movie: (id: number) => request<TitleDetail>(`/api/movie/${id}`),
  tv: (id: number) => request<TitleDetail>(`/api/tv/${id}`),
  saveProgress: (path: string, position: number, duration: number) =>
    // Profile-scoped write (server also mirrors to legacy progress for profile 1)
    request<{ ok: boolean }>('/api/progress/profile', {
      method: 'PUT',
      body: JSON.stringify({ path, position, duration, clientId: getClientId() }),
    }),
  playbackHeartbeat: (body: {
    path: string
    titleId?: number
    position: number
    duration: number
    state: 'playing' | 'paused' | 'stopped'
    playbackMode?: string
  }) =>
    request<{ ok: boolean; session: NowPlayingSession }>('/api/playback/heartbeat', {
      method: 'POST',
      body: JSON.stringify({ ...body, clientId: getClientId() }),
    }),
  streamInfo: (path: string, audio = 0) => {
    const sp = new URLSearchParams({ path })
    if (audio > 0) sp.set('audio', String(audio))
    return request<{
      mode: 'direct' | 'remux' | 'transcode'
      ffmpegAvailable: boolean
      container: string | null
      videoCodec: string | null
      audioCodec: string | null
      duration: number | null
      width: number | null
      height: number | null
      reason: string
      canDirect: boolean
      audioTracks: import('./types').AudioTrack[]
      subtitleTracks: import('./types').SubtitleTrack[]
      hwEncoder: string | null
    }>(`/api/stream/info?${sp}`)
  },
  streamUrl: (
    path: string,
    opts?: {
      mode?: 'direct' | 'remux' | 'transcode' | 'auto'
      start?: number
      audio?: number
    },
  ) => {
    const params = new URLSearchParams({ path })
    if (opts?.mode && opts.mode !== 'auto') params.set('mode', opts.mode)
    if (opts?.start && opts.start > 0.5) params.set('t', String(Math.floor(opts.start)))
    if (opts?.audio && opts.audio > 0) params.set('audio', String(opts.audio))
    return `/api/stream?${params.toString()}`
  },
  subtitleUrl: (
    path: string,
    track: { kind: string; index: number; path?: string },
  ) => {
    const sp = new URLSearchParams({
      path,
      kind: track.kind,
      index: String(track.index),
    })
    if (track.path) sp.set('sidecar', track.path)
    return `/api/stream/subtitle?${sp}`
  },
  titleExtras: (id: number) =>
    request<{
      onWatchlist: boolean
      trailers: Array<{ key: string; name: string; url: string; type: string }>
      cast: Array<{ id: number; name: string; character: string; profile: string | null }>
      health: {
        missing: Array<{ season: number; episode: number; name: string; airDate: string | null }>
        present: number
        expected: number
      } | null
    }>(`/api/title/${id}/extras`),
  profiles: () =>
    request<{ profiles: Array<{ id: number; name: string }>; activeId: number }>('/api/profiles'),
  selectProfile: (id: number) =>
    request<{ ok: boolean }>(`/api/profiles/${id}/select`, { method: 'POST' }),
  createProfile: (name: string) =>
    request<{ profile: { id: number; name: string } }>('/api/profiles', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
  watchlist: () =>
    request<{ items: import('./types').Title[] }>('/api/watchlist'),
  addWatchlist: (titleId: number) =>
    request<{ ok: boolean }>(`/api/watchlist/${titleId}`, { method: 'POST' }),
  removeWatchlist: (titleId: number) =>
    request<{ ok: boolean }>(`/api/watchlist/${titleId}`, { method: 'DELETE' }),
  adminDeleteFile: (path: string, deleteDisk: boolean) =>
    request<{ ok: boolean; diskDeleted: boolean }>('/api/admin/files', {
      method: 'DELETE',
      body: JSON.stringify({ path, deleteDisk }),
    }),
  adminPreferFile: (titleId: number, path: string) =>
    request<{ ok: boolean }>('/api/admin/files/prefer', {
      method: 'POST',
      body: JSON.stringify({ titleId, path }),
    }),
  titleHealth: (id: number) =>
    request<{
      missing: Array<{ season: number; episode: number; name: string }>
      present: number
      expected: number
    }>(`/api/admin/titles/${id}/health`),

  adminTitles: async (params?: {
    q?: string
    kind?: 'movie' | 'tv' | ''
    includeHidden?: boolean
  }) => {
    const sp = new URLSearchParams()
    if (params?.q) sp.set('q', params.q)
    if (params?.kind) sp.set('kind', params.kind)
    if (params?.includeHidden) sp.set('includeHidden', '1')
    const qs = sp.toString()
    const res = await request<{ titles: AdminTitle[] }>(`/api/admin/titles${qs ? `?${qs}` : ''}`)
    return { titles: res.titles.map(normalizeAdminTitle), count: res.titles.length }
  },
  adminUnmatched: async () => {
    const res = await request<{ titles: AdminTitle[] }>('/api/admin/unmatched')
    return { titles: res.titles.map(normalizeAdminTitle), count: res.titles.length }
  },
  adminTitle: async (id: number) => {
    const t = await request<AdminTitle>(`/api/admin/titles/${id}`)
    return normalizeAdminTitle(t)
  },
  patchAdminTitle: async (
    id: number,
    body: { title?: string; year?: number | null; overview?: string | null; hidden?: boolean },
  ) => {
    const t = await request<AdminTitle>(`/api/admin/titles/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    })
    return normalizeAdminTitle(t)
  },
  rematchTitle: async (
    id: number,
    body: { query?: string; tmdbId?: number; kind?: 'movie' | 'tv' },
  ) => {
    const t = await request<AdminTitle & { mergedIntoId?: number }>(
      `/api/admin/titles/${id}/rematch`,
      {
        method: 'POST',
        body: JSON.stringify(body),
      },
    )
    return { ...normalizeAdminTitle(t), mergedIntoId: t.mergedIntoId }
  },
  hideTitle: async (id: number, hidden = true) => {
    const t = await request<AdminTitle>(`/api/admin/titles/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ hidden }),
    })
    return normalizeAdminTitle(t)
  },
  deleteTitle: (id: number) =>
    request<{ ok: boolean; title?: AdminTitle }>(`/api/admin/titles/${id}`, {
      method: 'DELETE',
    }),
  tmdbSearch: (q: string, kind: 'movie' | 'tv', year?: number | null) => {
    const sp = new URLSearchParams({ q, kind })
    if (year) sp.set('year', String(year))
    return request<{ results: TmdbSearchResult[] }>(`/api/admin/tmdb/search?${sp}`)
  },
  adminOverview: () => request<AdminOverview>('/api/admin/overview'),
  adminNowPlaying: (includeStale = false) => {
    const qs = includeStale ? '?includeStale=1' : ''
    return request<{ sessions: NowPlayingSession[]; watchingWindowSeconds: number }>(
      `/api/admin/now-playing${qs}`,
    )
  },
  adminActivity: (limit = 50) =>
    request<{ events: ActivityEvent[]; progress: ActivityProgress[] }>(
      `/api/admin/activity?limit=${limit}`,
    ),
  bulkHideUnmatched: (opts: { ids?: number[]; all?: boolean }) =>
    request<{ ok: boolean; hidden: number }>('/api/admin/unmatched/bulk-hide', {
      method: 'POST',
      body: JSON.stringify(opts),
    }),
  clearProgress: (opts: { path?: string; titleId?: number }) =>
    request<{ ok: boolean; cleared: number }>('/api/admin/progress/clear', {
      method: 'POST',
      body: JSON.stringify(opts),
    }),
  markWatched: (opts: { path?: string; titleId?: number; duration?: number }) =>
    request<{ ok: boolean; marked?: number }>('/api/admin/progress/watched', {
      method: 'POST',
      body: JSON.stringify(opts),
    }),

  convertJobs: () =>
    request<{
      jobs: ConvertJob[]
      stats: { queued: number; running: number; done: number; failed: number }
      localMediaEnabled: boolean
      deleteOriginalDefault: boolean
    }>('/api/admin/convert/jobs'),
  convertNeeds: (limit = 200) =>
    request<{ files: ConvertNeedsFile[]; localMediaEnabled: boolean }>(
      `/api/admin/convert/needs?limit=${limit}`,
    ),
  convertProbe: (body?: { paths?: string[]; limit?: number }) =>
    request<{
      probed: number
      results: Array<{ path: string; ok: boolean; error?: string }>
      localMediaEnabled: boolean
    }>('/api/admin/convert/probe', {
      method: 'POST',
      body: JSON.stringify(body ?? {}),
    }),
  convertEnqueue: (body: {
    path?: string
    paths?: string[]
    mode?: 'auto' | 'remux' | 'transcode'
    replaceOriginal?: boolean
    deleteOriginal?: boolean
  }) =>
    request<{
      enqueued: number
      jobs: Array<{ job: ConvertJob | null }>
      errors: string[]
      stats: { queued: number; running: number; done: number; failed: number }
    }>('/api/admin/convert/enqueue', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  convertCancel: (id: number) =>
    request<{ job: ConvertJob }>(`/api/admin/convert/jobs/${id}/cancel`, { method: 'POST' }),
}
