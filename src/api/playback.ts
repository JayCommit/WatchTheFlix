import type { NowPlayingSession } from '../types'
import { getClientId } from '../utils/clientId'
import { request } from './client'

export const playbackApi = {
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
      audioTracks: import('../types').AudioTrack[]
      subtitleTracks: import('../types').SubtitleTrack[]
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
}
