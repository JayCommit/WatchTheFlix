import { useCallback, useEffect, useRef, type MutableRefObject, type RefObject } from 'react'
import { api } from '../api'

type Mode = 'direct' | 'remux' | 'transcode'

type UsePlaybackProgressArgs = {
  videoRef: RefObject<HTMLVideoElement | null>
  pathRef: RefObject<string>
  startOffsetRef: RefObject<number>
  modeRef: RefObject<Mode>
  lastSaveRef: MutableRefObject<number>
  duration: number
  titleId: number
}

export function usePlaybackProgress({
  videoRef,
  pathRef,
  startOffsetRef,
  modeRef,
  lastSaveRef,
  duration,
  titleId,
}: UsePlaybackProgressArgs) {
  const absoluteTime = useCallback(() => {
    const video = videoRef.current
    if (!video) return startOffsetRef.current
    if (modeRef.current === 'direct') return video.currentTime
    return startOffsetRef.current + video.currentTime
  }, [videoRef, startOffsetRef, modeRef])

  const saveProgress = useCallback(async (force = false) => {
    const video = videoRef.current
    const p = pathRef.current
    if (!video || !p) return
    const now = Date.now()
    if (!force && now - lastSaveRef.current < 4000) return
    const t = modeRef.current === 'direct' ? video.currentTime : startOffsetRef.current + video.currentTime
    if (!Number.isFinite(t) || t < 1) return
    lastSaveRef.current = now
    const dur =
      modeRef.current === 'direct'
        ? video.duration || 0
        : duration || video.duration || 0
    try {
      await api.saveProgress(p, t, dur)
    } catch {
      /* best-effort */
    }
  }, [videoRef, pathRef, modeRef, startOffsetRef, lastSaveRef, duration])

  const sendHeartbeat = useCallback(
    async (state: 'playing' | 'paused' | 'stopped') => {
      const video = videoRef.current
      const p = pathRef.current
      if (!p) return
      const t = video
        ? modeRef.current === 'direct'
          ? video.currentTime
          : startOffsetRef.current + video.currentTime
        : 0
      const dur = video
        ? modeRef.current === 'direct'
          ? video.duration || duration || 0
          : duration || video.duration || 0
        : duration || 0
      try {
        await api.playbackHeartbeat({
          path: p,
          titleId: titleId || undefined,
          position: Number.isFinite(t) ? Math.max(0, t) : 0,
          duration: Number.isFinite(dur) ? dur : 0,
          state,
          playbackMode: modeRef.current,
        })
      } catch {
        /* best-effort */
      }
    },
    [videoRef, pathRef, modeRef, startOffsetRef, duration, titleId],
  )

  const saveProgressRef = useRef(saveProgress)
  const sendHeartbeatRef = useRef(sendHeartbeat)
  saveProgressRef.current = saveProgress
  sendHeartbeatRef.current = sendHeartbeat

  // True leave only — not remux seek reloads or callback identity changes.
  useEffect(() => {
    const onUnload = () => {
      void saveProgressRef.current(true)
      void sendHeartbeatRef.current('stopped')
    }
    window.addEventListener('pagehide', onUnload)
    return () => {
      window.removeEventListener('pagehide', onUnload)
      void saveProgressRef.current(true)
      void sendHeartbeatRef.current('stopped')
    }
  }, [])

  return { absoluteTime, saveProgress, sendHeartbeat }
}
