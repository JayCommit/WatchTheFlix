import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import type { TitleDetail } from '../types'
import { episodeLabel, formatTime, sortMediaFiles } from '../utils/format'

type StreamInfo = Awaited<ReturnType<typeof api.streamInfo>>

export function PlayerPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const videoRef = useRef<HTMLVideoElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const hideTimer = useRef<number | null>(null)
  const resumedRef = useRef(false)
  const lastSaveRef = useRef(0)
  const pathRef = useRef('')
  const startOffsetRef = useRef(0)
  const modeRef = useRef<'direct' | 'remux' | 'transcode'>('direct')
  const seekTimer = useRef<number | null>(null)

  const [detail, setDetail] = useState<TitleDetail | null>(null)
  const [path, setPath] = useState(params.get('path') || '')
  const [error, setError] = useState('')
  const [mediaError, setMediaError] = useState('')
  const [showChrome, setShowChrome] = useState(true)
  const [paused, setPaused] = useState(true)
  const [buffering, setBuffering] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
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
    // Keep current position when only switching audio tracks
    const holdAt = startOffsetRef.current > 1 ? startOffsetRef.current : resume

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
        } else if (mode === 'direct') {
          setStartOffset(0)
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
  }, [path, detail, params, audioIndex])

  const absoluteTime = useCallback(() => {
    const video = videoRef.current
    if (!video) return startOffsetRef.current
    if (modeRef.current === 'direct') return video.currentTime
    return startOffsetRef.current + video.currentTime
  }, [])

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
  }, [duration])

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
    [duration, titleId],
  )

  const reloadAt = useCallback((absoluteSeconds: number) => {
    const t = Math.max(0, absoluteSeconds)
    setStartOffset(t)
    setCurrentTime(t)
    setBuffering(true)
    setMediaError('')
    setSrcNonce((n) => n + 1)
  }, [])

  useEffect(() => {
    const video = videoRef.current
    if (!video || !path || !detail || !streamInfo) return

    const onTime = () => {
      const t =
        streamInfo.mode === 'direct'
          ? video.currentTime
          : startOffsetRef.current + video.currentTime
      setCurrentTime(t)
      void saveProgress()
      const dur =
        streamInfo.mode === 'direct'
          ? video.duration || duration || 0
          : duration || video.duration || 0
      if (dur > 0 && t >= dur - 35 && t < dur - 0.5) setShowUpNext(true)
    }
    const onDuration = () => {
      if (streamInfo.mode === 'direct' && video.duration) setDuration(video.duration)
    }
    const onPlay = () => {
      setPaused(false)
      setBuffering(false)
      void sendHeartbeat('playing')
    }
    const onPause = () => {
      setPaused(true)
      void saveProgress(true)
      void sendHeartbeat('paused')
    }
    const onWaiting = () => setBuffering(true)
    const onPlaying = () => setBuffering(false)
    const onCanPlay = () => setBuffering(false)
    const onVolume = () => {
      setVolume(video.volume)
      setMuted(video.muted)
    }
    const tryResumeDirect = () => {
      if (resumedRef.current) return
      resumedRef.current = true
      if (streamInfo.mode !== 'direct') {
        void video.play().catch(() => undefined)
        return
      }
      const fromStart = params.get('t') === '0'
      if (!fromStart) {
        const file = detail.files.find((f) => f.path === path)
        const resume = file?.progress?.position ?? 0
        if (resume > 30 && resume < (video.duration || Infinity) - 30) {
          video.currentTime = resume
          setCurrentTime(resume)
        }
      }
      if (video.duration) setDuration(video.duration)
      void video.play().catch(() => undefined)
    }
    const onError = () => {
      setBuffering(false)
      if (streamInfo.mode === 'direct' && streamInfo.ffmpegAvailable) {
        setMediaError('Direct play failed — retrying with FFmpeg compatibility mode…')
        setStreamInfo({ ...streamInfo, mode: 'remux', reason: 'Fallback remux after direct play failed' })
        setStartOffset(absoluteTime())
        setSrcNonce((n) => n + 1)
        return
      }
      setMediaError(
        streamInfo.ffmpegAvailable
          ? 'Playback failed even after remux/transcode. The file may be corrupt or use an exotic codec.'
          : 'Playback failed. Install/rebuild ffmpeg-static or use an MP4/H.264 copy.',
      )
    }

    video.addEventListener('timeupdate', onTime)
    video.addEventListener('durationchange', onDuration)
    video.addEventListener('loadedmetadata', tryResumeDirect)
    video.addEventListener('play', onPlay)
    video.addEventListener('pause', onPause)
    video.addEventListener('waiting', onWaiting)
    video.addEventListener('playing', onPlaying)
    video.addEventListener('canplay', onCanPlay)
    video.addEventListener('volumechange', onVolume)
    video.addEventListener('error', onError)

    const heartbeatTimer = window.setInterval(() => {
      if (!video.paused && !video.ended) void sendHeartbeat('playing')
    }, 18_000)
    // Initial presence ping once stream is ready
    if (!video.paused) void sendHeartbeat('playing')

    return () => {
      video.removeEventListener('timeupdate', onTime)
      video.removeEventListener('durationchange', onDuration)
      video.removeEventListener('loadedmetadata', tryResumeDirect)
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
      video.removeEventListener('waiting', onWaiting)
      video.removeEventListener('playing', onPlaying)
      video.removeEventListener('canplay', onCanPlay)
      video.removeEventListener('volumechange', onVolume)
      video.removeEventListener('error', onError)
      window.clearInterval(heartbeatTimer)
      // Keep Now Playing alive across remux/transcode seeks (src remounts).
      void saveProgress(true)
    }
  }, [path, detail, streamInfo, saveProgress, sendHeartbeat, params, srcNonce, absoluteTime, duration])

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

  const ordered = useMemo(() => (detail ? sortMediaFiles(detail.files) : []), [detail])
  const currentIndex = ordered.findIndex((f) => f.path === path)
  const nextFile = kind === 'tv' && currentIndex >= 0 ? ordered[currentIndex + 1] : undefined
  const current = ordered[currentIndex]

  const goNext = useCallback(() => {
    if (!nextFile || !detail) return
    setShowUpNext(false)
    setSubtitleKey('off')
    setAudioIndex(0)
    void saveProgress(true)
    const url = `/play?path=${encodeURIComponent(nextFile.path)}&titleId=${detail.id}&kind=tv`
    navigate(url)
    setPath(nextFile.path)
  }, [nextFile, detail, navigate, saveProgress])

  useEffect(() => {
    const video = videoRef.current
    if (!video || !nextFile) return
    const onEnded = () => goNext()
    video.addEventListener('ended', onEnded)
    return () => video.removeEventListener('ended', onEnded)
  }, [nextFile, goNext, srcNonce, path])

  const bumpChrome = useCallback(() => {
    setShowChrome(true)
    if (hideTimer.current) window.clearTimeout(hideTimer.current)
    const video = videoRef.current
    if (video && !video.paused) {
      hideTimer.current = window.setTimeout(() => setShowChrome(false), 2800)
    }
  }, [])

  const togglePlay = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) void video.play().catch(() => setMediaError('Could not start playback.'))
    else video.pause()
    bumpChrome()
  }, [bumpChrome])

  const seekTo = useCallback(
    (absoluteSeconds: number) => {
      const video = videoRef.current
      if (!video || !streamInfo) return
      const capped = Math.max(0, Math.min(duration || absoluteSeconds, absoluteSeconds))
      if (streamInfo.mode === 'direct') {
        video.currentTime = capped
        setCurrentTime(capped)
      } else {
        // Remux/transcode streams aren't byte-seekable — restart FFmpeg at offset
        if (seekTimer.current) window.clearTimeout(seekTimer.current)
        setCurrentTime(capped)
        seekTimer.current = window.setTimeout(() => reloadAt(capped), 180)
      }
      bumpChrome()
    },
    [streamInfo, duration, reloadAt, bumpChrome],
  )

  const seekBy = useCallback(
    (delta: number) => {
      seekTo(absoluteTime() + delta)
    },
    [seekTo, absoluteTime],
  )

  const toggleFullscreen = useCallback(() => {
    const stage = stageRef.current
    if (!stage) return
    if (document.fullscreenElement) void document.exitFullscreen()
    else void stage.requestFullscreen()
    bumpChrome()
  }, [bumpChrome])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      const video = videoRef.current
      if (!video) return

      if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        e.preventDefault()
        setShowHelp((v) => !v)
        return
      }
      if (e.key === ' ' || e.key.toLowerCase() === 'k') {
        e.preventDefault()
        togglePlay()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        seekBy(10)
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        seekBy(-10)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        video.volume = Math.min(1, video.volume + 0.05)
        bumpChrome()
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        video.volume = Math.max(0, video.volume - 0.05)
        bumpChrome()
      } else if (e.key.toLowerCase() === 'f') {
        e.preventDefault()
        toggleFullscreen()
      } else if (e.key.toLowerCase() === 'm') {
        e.preventDefault()
        video.muted = !video.muted
        bumpChrome()
      } else if (e.key.toLowerCase() === 'n' && nextFile) {
        e.preventDefault()
        goNext()
      } else if (e.key === 'Escape') {
        if (showHelp) {
          setShowHelp(false)
          return
        }
        if (document.fullscreenElement) {
          void document.exitFullscreen()
          return
        }
        void saveProgress(true)
        navigate(backPath)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    togglePlay,
    seekBy,
    toggleFullscreen,
    bumpChrome,
    nextFile,
    goNext,
    showHelp,
    navigate,
    backPath,
    saveProgress,
  ])

  if (error) {
    return (
      <div className="empty-state page-enter">
        <h2>Playback error</h2>
        <p>{error}</p>
        <Link className="btn btn-ghost" to="/">
          Back
        </Link>
      </div>
    )
  }

  if (!path || !detail) {
    return <div className="loading page-enter">Preparing stream…</div>
  }

  const label =
    current?.season != null && current?.episode != null
      ? `${detail.title} · ${episodeLabel(current.season, current.episode)}`
      : detail.title

  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0
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

  return (
    <div
      className={`player-page page-enter ${showChrome ? 'chrome-visible' : ''}`}
      onMouseMove={bumpChrome}
      onTouchStart={bumpChrome}
    >
      <div className={`player-top ${showChrome ? 'visible' : ''}`}>
        <button
          className="btn btn-ghost"
          type="button"
          onClick={() => {
            void saveProgress(true)
            navigate(backPath)
          }}
        >
          ← Back
        </button>
        <h1>{label}</h1>
        <div className="player-top-right">
          {streamInfo ? (
            <span className="playback-pill" title={streamInfo.reason}>
              {modeLabel}
              {streamInfo.videoCodec ? ` · ${streamInfo.videoCodec}` : ''}
              {streamInfo.audioCodec ? `/${streamInfo.audioCodec}` : ''}
            </span>
          ) : null}
          <button className="btn btn-ghost" type="button" onClick={() => setShowHelp((v) => !v)}>
            Shortcuts
          </button>
          {nextFile ? (
            <button className="btn btn-ghost" type="button" onClick={goNext}>
              Next episode
            </button>
          ) : null}
        </div>
      </div>

      <div
        className="player-stage"
        ref={stageRef}
        onDoubleClick={toggleFullscreen}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('.player-overlay, .player-error, button, input')) return
          togglePlay()
        }}
      >
        {videoSrc ? (
          <video
            ref={videoRef}
            key={`${path}:${srcNonce}:${streamInfo?.mode}:${Math.floor(startOffset)}:${audioIndex}`}
            src={videoSrc}
            autoPlay
            playsInline
            crossOrigin="use-credentials"
            onPlay={bumpChrome}
          >
            {activeSub ? (
              <track
                key={subtitleKey}
                kind="subtitles"
                src={api.subtitleUrl(path, activeSub)}
                srcLang={activeSub.language || 'en'}
                label={activeSub.title || activeSub.language || 'Subtitles'}
                default
              />
            ) : null}
          </video>
        ) : (
          <div className="player-buffering" aria-live="polite">
            <div className="spinner" />
            <span>Detecting codecs…</span>
          </div>
        )}

        {buffering && !mediaError && videoSrc ? (
          <div className="player-buffering" aria-live="polite">
            <div className="spinner" />
            <span>
              {streamInfo?.mode === 'transcode'
                ? 'Transcoding for browser…'
                : streamInfo?.mode === 'remux'
                  ? 'Remuxing stream…'
                  : 'Buffering…'}
            </span>
          </div>
        ) : null}

        {mediaError ? (
          <div className="player-error">
            <h2>Can’t play this file</h2>
            <p>{mediaError}</p>
            <div className="hero-actions">
              <Link className="btn btn-primary" to={backPath}>
                Back to title
              </Link>
              {streamInfo?.ffmpegAvailable ? (
                <button
                  className="btn btn-ghost"
                  type="button"
                  onClick={() => {
                    setMediaError('')
                    setStreamInfo((s) =>
                      s ? { ...s, mode: 'transcode', reason: 'Forced H.264/AAC transcode' } : s,
                    )
                    setSrcNonce((n) => n + 1)
                  }}
                >
                  Force transcode
                </button>
              ) : null}
              {nextFile ? (
                <button className="btn btn-ghost" type="button" onClick={goNext}>
                  Skip to next
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        {!mediaError && videoSrc ? (
          <div className={`player-overlay ${showChrome || paused ? 'visible' : ''}`}>
            <div className="player-scrub-wrap">
              <input
                className="scrub"
                type="range"
                min={0}
                max={duration || 0}
                step={0.1}
                value={Number.isFinite(currentTime) ? currentTime : 0}
                aria-label="Seek"
                onChange={(e) => seekTo(Number(e.target.value))}
                onMouseUp={() => void saveProgress(true)}
                onTouchEnd={() => void saveProgress(true)}
              />
            </div>
            <div className="player-controls">
              <div className="left">
                <button className="ctrl-btn" type="button" aria-label={paused ? 'Play' : 'Pause'} onClick={togglePlay}>
                  {paused ? '▶' : '❚❚'}
                </button>
                <button className="ctrl-btn" type="button" aria-label="Rewind 10 seconds" onClick={() => seekBy(-10)}>
                  −10
                </button>
                <button className="ctrl-btn" type="button" aria-label="Forward 10 seconds" onClick={() => seekBy(10)}>
                  +10
                </button>
                <span className="time-readout">
                  {formatTime(currentTime)} / {formatTime(duration)}
                </span>
              </div>
              <div className="right">
                {streamInfo && streamInfo.audioTracks.length > 1 ? (
                  <label className="track-select">
                    <span className="sr-only">Audio</span>
                    <select
                      value={audioIndex}
                      onChange={(e) => {
                        const next = Number(e.target.value)
                        setStartOffset(absoluteTime())
                        setAudioIndex(next)
                        setBuffering(true)
                      }}
                    >
                      {streamInfo.audioTracks.map((t) => (
                        <option key={t.index} value={t.index}>
                          {t.language || t.title || `Audio ${t.index + 1}`}
                          {t.codec ? ` (${t.codec})` : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                {streamInfo && streamInfo.subtitleTracks.length > 0 ? (
                  <label className="track-select">
                    <span className="sr-only">Subtitles</span>
                    <select
                      value={subtitleKey}
                      onChange={(e) => setSubtitleKey(e.target.value)}
                    >
                      <option value="off">Subs off</option>
                      {streamInfo.subtitleTracks.map((t) => (
                        <option
                          key={`${t.kind}:${t.index}:${t.path ?? ''}`}
                          value={`${t.kind}:${t.index}:${t.path ?? ''}`}
                        >
                          {t.kind === 'external' ? 'File · ' : ''}
                          {t.language || t.title || `Sub ${t.index + 1}`}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                {nextFile ? (
                  <button className="ctrl-btn" type="button" onClick={goNext}>
                    Next
                  </button>
                ) : null}
                <button
                  className="ctrl-btn"
                  type="button"
                  aria-label={muted ? 'Unmute' : 'Mute'}
                  onClick={() => {
                    const video = videoRef.current
                    if (video) video.muted = !video.muted
                  }}
                >
                  {muted || volume === 0 ? 'Muted' : 'Vol'}
                </button>
                <input
                  className="vol-scrub"
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={muted ? 0 : volume}
                  aria-label="Volume"
                  onChange={(e) => {
                    const video = videoRef.current
                    if (!video) return
                    const v = Number(e.target.value)
                    video.volume = v
                    video.muted = v === 0
                    bumpChrome()
                  }}
                />
                <button className="ctrl-btn" type="button" aria-label="Fullscreen" onClick={toggleFullscreen}>
                  Full
                </button>
              </div>
            </div>
            <div className="player-progress-track" aria-hidden>
              <i style={{ width: `${progressPct}%` }} />
            </div>
          </div>
        ) : null}
      </div>

      {showUpNext && nextFile && detail ? (
        <div className="up-next" role="dialog" aria-label="Up next">
          <div className="up-next-panel">
            <p className="muted">Up next</p>
            <h2>
              {episodeLabel(nextFile.season, nextFile.episode)}
              {nextFile.episodeName ? ` · ${nextFile.episodeName}` : ''}
            </h2>
            <div className="hero-actions">
              <button className="btn btn-primary" type="button" onClick={goNext}>
                Play now
              </button>
              <button
                className="btn btn-ghost"
                type="button"
                onClick={() => setShowUpNext(false)}
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showHelp ? (
        <div className="player-help" role="dialog" aria-label="Keyboard shortcuts">
          <div className="player-help-panel">
            <h2>Shortcuts</h2>
            <ul>
              <li>
                <kbd>Space</kbd> / <kbd>K</kbd> Play / pause
              </li>
              <li>
                <kbd>←</kbd> / <kbd>→</kbd> Seek ±10s
              </li>
              <li>
                <kbd>↑</kbd> / <kbd>↓</kbd> Volume
              </li>
              <li>
                <kbd>F</kbd> Fullscreen
              </li>
              <li>
                <kbd>M</kbd> Mute
              </li>
              {kind === 'tv' ? (
                <li>
                  <kbd>N</kbd> Next episode
                </li>
              ) : null}
              <li>
                <kbd>Esc</kbd> Exit / back
              </li>
              <li>
                <kbd>?</kbd> Toggle this help
              </li>
            </ul>
            {streamInfo ? <p className="muted">{streamInfo.reason}</p> : null}
            <button className="btn btn-primary" type="button" onClick={() => setShowHelp(false)}>
              Got it
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
