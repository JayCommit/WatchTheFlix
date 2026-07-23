import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { api } from '../api'
import type { TitleDetail } from '../types'
import { episodeLabel, sortMediaFiles } from '../utils/format'

export type StreamInfo = Awaited<ReturnType<typeof api.streamInfo>>

type UsePlayerMediaArgs = {
  params: URLSearchParams
  setCurrentTime: Dispatch<SetStateAction<number>>
  setDuration: Dispatch<SetStateAction<number>>
}

export function usePlayerMedia({ params, setCurrentTime, setDuration }: UsePlayerMediaArgs) {
  const pathRef = useRef('')
  const startOffsetRef = useRef(0)
  const modeRef = useRef<'direct' | 'remux' | 'transcode'>('direct')
  const seekTimer = useRef<number | null>(null)
  const resumedRef = useRef(false)
  const upNextDismissedRef = useRef(false)
  const pathForProbeRef = useRef('')
  const audioOnlyReloadRef = useRef(false)
  const lastSaveRef = useRef(0)

  const [detail, setDetail] = useState<TitleDetail | null>(null)
  const [path, setPath] = useState(params.get('path') || '')
  const [error, setError] = useState('')
  const [mediaError, setMediaError] = useState('')
  const [buffering, setBuffering] = useState(false)
  const [streamInfo, setStreamInfo] = useState<StreamInfo | null>(null)
  const [startOffset, setStartOffset] = useState(0)
  const [srcNonce, setSrcNonce] = useState(0)
  const [audioIndex, setAudioIndex] = useState(0)
  const [subtitleKey, setSubtitleKey] = useState<string>('off')
  const [showUpNext, setShowUpNext] = useState(false)

  const titleId = Number(params.get('titleId'))
  const kind = (params.get('kind') as 'movie' | 'tv') || 'movie'

  pathRef.current = path
  startOffsetRef.current = startOffset
  modeRef.current = streamInfo?.mode ?? 'direct'

  const backPath = kind === 'movie' ? `/movie/${titleId}` : `/tv/${titleId}`
  const compatMode = streamInfo?.mode === 'remux' || streamInfo?.mode === 'transcode'

  useEffect(() => {
    if (!titleId) {
      setError('Missing title')
      return
    }
    let cancelled = false
    const load = kind === 'movie' ? api.movie(titleId) : api.tv(titleId)
    load
      .then((d) => {
        if (cancelled) return
        setDetail(d)
        const fromQuery = params.get('path')
        if (fromQuery) {
          setPath(fromQuery)
          return
        }
        const ordered = sortMediaFiles(d.files)
        const resume = [...ordered]
          .filter((f) => f.progress && f.progress.position > 30)
          .sort((a, b) => (b.progress?.updated_at ?? '').localeCompare(a.progress?.updated_at ?? ''))
        const pick = resume[0] ?? ordered[0]
        if (pick) {
          setPath(pick.path)
          return
        }
        setError('No playable files for this title')
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load')
      })
    return () => {
      cancelled = true
    }
  }, [titleId, kind, params])

  useEffect(() => {
    const p = params.get('path')
    if (p) setPath(p)
  }, [params])

  useEffect(() => {
    if (!path || !detail) return
    let cancelled = false
    resumedRef.current = false
    setMediaError('')
    setBuffering(true)
    setStreamInfo(null)
    setCurrentTime(0)
    lastSaveRef.current = 0

    const fromStart = params.get('t') === '0'
    const file = detail.files.find((f) => f.path === path)
    const resume = !fromStart && file?.progress?.position && file.progress.position > 30
      ? file.progress.position
      : 0
    const samePath = pathForProbeRef.current === path
    const audioOnly = samePath && audioOnlyReloadRef.current
    audioOnlyReloadRef.current = false
    pathForProbeRef.current = path
    if (!samePath) {
      upNextDismissedRef.current = false
      setShowUpNext(false)
      setStartOffset(0)
    }
    // Keep current position only when switching audio on the same file
    const holdAt = audioOnly && startOffsetRef.current > 1 ? startOffsetRef.current : resume

    api
      .streamInfo(path, audioIndex)
      .then((info) => {
        if (cancelled) return
        setStreamInfo(info)
        if (info.duration && info.duration > 0) setDuration(info.duration)
        const mode = info.mode
        if ((mode === 'remux' || mode === 'transcode') && holdAt > 0) {
          setStartOffset(holdAt)
          setCurrentTime(holdAt)
        } else if (!audioOnly) {
          setStartOffset(mode === 'direct' ? 0 : holdAt > 0 ? holdAt : 0)
          if (mode === 'direct') setCurrentTime(0)
        }
        setSrcNonce((n) => n + 1)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setMediaError(err instanceof Error ? err.message : 'Could not probe media')
        setBuffering(false)
      })

    return () => {
      cancelled = true
    }
  }, [path, detail, params, audioIndex, setCurrentTime, setDuration])

  const reloadAt = useCallback((absoluteSeconds: number) => {
    const t = Math.max(0, absoluteSeconds)
    setStartOffset(t)
    setCurrentTime(t)
    setBuffering(true)
    setMediaError('')
    setSrcNonce((n) => n + 1)
  }, [setCurrentTime])

  const ordered = useMemo(() => (detail ? sortMediaFiles(detail.files) : []), [detail])
  const currentIndex = ordered.findIndex((f) => f.path === path)
  const nextFile = kind === 'tv' && currentIndex >= 0 ? ordered[currentIndex + 1] : undefined
  const current = ordered[currentIndex]

  const label =
    detail && current?.season != null && current?.episode != null
      ? `${detail.title} · ${episodeLabel(current.season, current.episode)}`
      : detail?.title ?? ''

  const videoSrc =
    streamInfo
      ? api.streamUrl(path, {
          mode: streamInfo.mode,
          start: compatMode ? startOffset : 0,
          audio: audioIndex,
        })
      : undefined

  const activeSub =
    subtitleKey !== 'off' && streamInfo?.subtitleTracks
      ? streamInfo.subtitleTracks.find(
          (t) => `${t.kind}:${t.index}:${t.path ?? ''}` === subtitleKey,
        )
      : null

  const modeLabel =
    streamInfo?.mode === 'transcode'
      ? 'Transcoding'
      : streamInfo?.mode === 'remux'
        ? 'Remuxing'
        : 'Direct'

  return {
    detail,
    path,
    setPath,
    error,
    mediaError,
    setMediaError,
    buffering,
    setBuffering,
    streamInfo,
    setStreamInfo,
    startOffset,
    setStartOffset,
    srcNonce,
    setSrcNonce,
    audioIndex,
    setAudioIndex,
    subtitleKey,
    setSubtitleKey,
    showUpNext,
    setShowUpNext,
    titleId,
    kind,
    backPath,
    compatMode,
    pathRef,
    startOffsetRef,
    modeRef,
    seekTimer,
    resumedRef,
    upNextDismissedRef,
    pathForProbeRef,
    audioOnlyReloadRef,
    lastSaveRef,
    reloadAt,
    ordered,
    currentIndex,
    nextFile,
    current,
    label,
    videoSrc,
    activeSub,
    modeLabel,
  }
}
