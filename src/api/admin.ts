import type {
  ActivityEvent,
  ActivityProgress,
  AdminOverview,
  AdminTitle,
  AuthUser,
  NowPlayingSession,
  TmdbSearchResult,
} from '../types'
import { normalizeAdminTitle, request } from './client'

export const adminApi = {
  adminUsers: () => request<{ users: AuthUser[] }>('/api/admin/users'),
  adminCreateUser: (body: { username: string; password: string; role?: 'admin' | 'user' }) =>
    request<{ user: AuthUser }>('/api/admin/users', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  adminPatchUser: (
    id: number,
    body: { role?: 'admin' | 'user'; disabled?: boolean; password?: string },
  ) =>
    request<{ user: AuthUser }>(`/api/admin/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  adminDeleteUser: (id: number) =>
    request<{ ok: boolean }>(`/api/admin/users/${id}`, { method: 'DELETE' }),
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
  mergeTitle: (sourceId: number, targetId: number) =>
    request<{ ok: boolean; moved: number; target: AdminTitle }>(
      `/api/admin/titles/${sourceId}/merge`,
      {
        method: 'POST',
        body: JSON.stringify({ targetId }),
      },
    ).then((r) => ({ ...r, target: normalizeAdminTitle(r.target as AdminTitle) })),
  reassignFile: (path: string, titleId: number) =>
    request<{ ok: boolean }>('/api/admin/files/reassign', {
      method: 'POST',
      body: JSON.stringify({ path, titleId }),
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
}
