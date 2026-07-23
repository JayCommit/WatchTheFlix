import { useEffect, type RefObject } from 'react'

type UseMediaSessionArgs = {
  videoRef: RefObject<HTMLVideoElement | null>
  title: string
  artist?: string
  artworkUrl?: string | null
  enabled: boolean
  onPlay: () => void
  onPause: () => void
  onSeekBy: (delta: number) => void
  onSeekTo: (seconds: number) => void
  onNext?: () => void
  hasNext?: boolean
  currentTime: number
  duration: number
  paused: boolean
}

export function useMediaSession({
  videoRef,
  title,
  artist = 'WatchTheFlix',
  artworkUrl,
  enabled,
  onPlay,
  onPause,
  onSeekBy,
  onSeekTo,
  onNext,
  hasNext,
  currentTime,
  duration,
  paused,
}: UseMediaSessionArgs) {
  useEffect(() => {
    if (!enabled || typeof navigator === 'undefined' || !('mediaSession' in navigator)) return

    const artwork = artworkUrl
      ? [{ src: artworkUrl, sizes: '512x512', type: 'image/jpeg' }]
      : []

    navigator.mediaSession.metadata = new MediaMetadata({
      title: title || 'Now playing',
      artist,
      artwork,
    })

    navigator.mediaSession.playbackState = paused ? 'paused' : 'playing'

    const setAction = (
      action: MediaSessionAction,
      handler: MediaSessionActionHandler | null,
    ) => {
      try {
        navigator.mediaSession.setActionHandler(action, handler)
      } catch {
        /* unsupported action on this browser */
      }
    }

    setAction('play', () => onPlay())
    setAction('pause', () => onPause())
    setAction('seekbackward', (details) => onSeekBy(-(details.seekOffset ?? 10)))
    setAction('seekforward', (details) => onSeekBy(details.seekOffset ?? 10))
    setAction('seekto', (details) => {
      if (typeof details.seekTime === 'number') onSeekTo(details.seekTime)
    })
    setAction('nexttrack', hasNext && onNext ? () => onNext() : null)
    setAction('previoustrack', null)

    return () => {
      setAction('play', null)
      setAction('pause', null)
      setAction('seekbackward', null)
      setAction('seekforward', null)
      setAction('seekto', null)
      setAction('nexttrack', null)
    }
  }, [
    enabled,
    title,
    artist,
    artworkUrl,
    onPlay,
    onPause,
    onSeekBy,
    onSeekTo,
    onNext,
    hasNext,
    paused,
  ])

  useEffect(() => {
    if (!enabled || typeof navigator === 'undefined' || !('mediaSession' in navigator)) return
    if (!duration || !Number.isFinite(duration)) return
    try {
      navigator.mediaSession.setPositionState({
        duration,
        playbackRate: videoRef.current?.playbackRate || 1,
        position: Math.min(duration, Math.max(0, currentTime)),
      })
    } catch {
      /* some browsers reject invalid position state */
    }
  }, [enabled, currentTime, duration, videoRef, paused])
}
