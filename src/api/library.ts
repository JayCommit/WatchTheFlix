import type { LibraryResponse, TitleDetail } from '../types'
import { request } from './client'

export const libraryApi = {
  library: () => request<LibraryResponse>('/api/library'),
  movie: (id: number) => request<TitleDetail>(`/api/movie/${id}`),
  tv: (id: number) => request<TitleDetail>(`/api/tv/${id}`),
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
  watchlist: () => request<{ items: import('../types').Title[] }>('/api/watchlist'),
  addWatchlist: (titleId: number) =>
    request<{ ok: boolean }>(`/api/watchlist/${titleId}`, { method: 'POST' }),
  removeWatchlist: (titleId: number) =>
    request<{ ok: boolean }>(`/api/watchlist/${titleId}`, { method: 'DELETE' }),
}
