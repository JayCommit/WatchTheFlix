import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import {
  PlayerControls,
  PlayerHelp,
  PlayerHud,
  PlayerLoadError,
  PlayerMediaError,
  PlayerPreparing,
  PlayerUpNext,
} from '../components/player'
import type { HudKind } from '../components/player/PlayerHud'
import { IconBack } from '../components/player/PlayerIcons'
import { useMediaSession } from '../hooks/useMediaSession'
import { usePlaybackProgress } from '../hooks/usePlaybackProgress'
import { usePlayerChrome } from '../hooks/usePlayerChrome'
import { usePlayerKeyboard } from '../hooks/usePlayerKeyboard'
import { usePlayerMedia } from '../hooks/usePlayerMedia'
import { usePlayerPrefs, type PlaybackRate } from '../hooks/usePlayerPrefs'

export function PlayerPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const videoRef = useRef<HTMLVideoElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const lastTapRef = useRef<{ t: number; x: number } | null>(null)

  const [paused, setPaused] = useState(true)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [buffered, setBuffered] = useState<{ start: number; end: number }[]>([])
  const [showHelp, setShowHelp] = useState(false)
  const [hud, setHud] = useState<{ kind: HudKind; value?: string; key: number }>({
    kind: null,
    key: 0,
  })
  const [pipSupported] = useState(
    () => typeof document !== 'undefined' && 'pictureInPictureEnabled' in document && document.pictureInPictureEnabled,
  )

  const { prefs, setVolume, setMuted, setRate, cycleRate, toggleRemaining } = usePlayerPrefs()
  const prefsRef = useRef(prefs)
  prefsRef.current = prefs

  const media = usePlayerMedia({ params, setCurrentTime, setDuration })
  const {
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
    pathRef,
    startOffsetRef,
    modeRef,
    seekTimer,
    resumedRef,
    upNextDismissedRef,
    audioOnlyReloadRef,
    lastSaveRef,
    reloadAt,
    nextFile,
    label,
    videoSrc,
    activeSub,
    modeLabel,
  } = media

  const { absoluteTime, saveProgress, sendHeartbeat } = usePlaybackProgress({
    videoRef,
    pathRef,
    startOffsetRef,
    modeRef,
    lastSaveRef,
    duration,
    titleId,
  })

  const { showChrome, bumpChrome, toggleFullscreen, isFullscreen } = usePlayerChrome({
    videoRef,
    stageRef,
  })

  const flashHud = useCallback((kind: HudKind, value?: string) => {
    setHud((h) => ({ kind, value, key: h.key + 1 }))
  }, [])

  const updateBuffered = useCallback(() => {
    const video = videoRef.current
    if (!video || !streamInfo) {
      setBuffered([])
      return
    }
    const ranges: { start: number; end: number }[] = []
    const offset = streamInfo.mode === 'direct' ? 0 : startOffsetRef.current
    try {
      for (let i = 0; i < video.buffered.length; i++) {
        ranges.push({
          start: offset + video.buffered.start(i),
          end: offset + video.buffered.end(i),
        })
      }
    } catch {
      /* InvalidStateError while metadata loads */
    }
    setBuffered(ranges)
  }, [streamInfo, startOffsetRef])

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
      updateBuffered()
      const dur =
        streamInfo.mode === 'direct'
          ? video.duration || duration || 0
          : duration || video.duration || 0
      if (dur > 0 && t >= dur - 35 && t < dur - 0.5) {
        if (!upNextDismissedRef.current) setShowUpNext(true)
      } else if (dur > 0 && t < dur - 35) {
        setShowUpNext(false)
      }
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
    const onRateChange = () => {
      const r = video.playbackRate
      if ([0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].includes(r)) {
        setRate(r as PlaybackRate)
      }
    }
    const tryResumeDirect = () => {
      if (resumedRef.current) return
      resumedRef.current = true
      const p = prefsRef.current
      video.volume = p.volume
      video.muted = p.muted
      video.playbackRate = p.rate
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
    video.addEventListener('progress', updateBuffered)
    video.addEventListener('play', onPlay)
    video.addEventListener('pause', onPause)
    video.addEventListener('waiting', onWaiting)
    video.addEventListener('playing', onPlaying)
    video.addEventListener('canplay', onCanPlay)
    video.addEventListener('volumechange', onVolume)
    video.addEventListener('ratechange', onRateChange)
    video.addEventListener('error', onError)

    const heartbeatTimer = window.setInterval(() => {
      if (!video.paused && !video.ended) void sendHeartbeat('playing')
    }, 18_000)
    if (!video.paused) void sendHeartbeat('playing')

    return () => {
      video.removeEventListener('timeupdate', onTime)
      video.removeEventListener('durationchange', onDuration)
      video.removeEventListener('loadedmetadata', tryResumeDirect)
      video.removeEventListener('progress', updateBuffered)
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
      video.removeEventListener('waiting', onWaiting)
      video.removeEventListener('playing', onPlaying)
      video.removeEventListener('canplay', onCanPlay)
      video.removeEventListener('volumechange', onVolume)
      video.removeEventListener('ratechange', onRateChange)
      video.removeEventListener('error', onError)
      window.clearInterval(heartbeatTimer)
      void saveProgress(true)
    }
  }, [
    path,
    detail,
    streamInfo,
    saveProgress,
    sendHeartbeat,
    params,
    srcNonce,
    absoluteTime,
    duration,
    setBuffering,
    upNextDismissedRef,
    setShowUpNext,
    setStreamInfo,
    resumedRef,
    startOffsetRef,
    setMediaError,
    setSrcNonce,
    setStartOffset,
    setVolume,
    setMuted,
    setRate,
    updateBuffered,
  ])

  // Keep client-side prefs applied when the element already exists
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (Math.abs(video.volume - prefs.volume) > 0.001) video.volume = prefs.volume
    if (video.muted !== prefs.muted) video.muted = prefs.muted
    if (video.playbackRate !== prefs.rate) video.playbackRate = prefs.rate
  }, [prefs.volume, prefs.muted, prefs.rate, srcNonce, path])

  const goNext = useCallback(() => {
    if (!nextFile || !detail) return
    setShowUpNext(false)
    upNextDismissedRef.current = false
    setSubtitleKey('off')
    setAudioIndex(0)
    setStartOffset(0)
    startOffsetRef.current = 0
    void saveProgress(true)
    const url = `/play?path=${encodeURIComponent(nextFile.path)}&titleId=${detail.id}&kind=tv`
    navigate(url)
    setPath(nextFile.path)
  }, [
    nextFile,
    detail,
    navigate,
    saveProgress,
    upNextDismissedRef,
    setShowUpNext,
    setAudioIndex,
    startOffsetRef,
    setSubtitleKey,
    setStartOffset,
    setPath,
  ])

  useEffect(() => {
    const video = videoRef.current
    if (!video || !nextFile) return
    const onEnded = () => goNext()
    video.addEventListener('ended', onEnded)
    return () => video.removeEventListener('ended', onEnded)
  }, [nextFile, goNext, srcNonce, path])

  const togglePlay = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) {
      void video.play().catch(() => setMediaError('Could not start playback.'))
      flashHud('play')
    } else {
      video.pause()
      flashHud('pause')
    }
    bumpChrome()
  }, [bumpChrome, setMediaError, flashHud])

  const seekTo = useCallback(
    (absoluteSeconds: number) => {
      const video = videoRef.current
      if (!video || !streamInfo) return
      const capped = Math.max(0, Math.min(duration || absoluteSeconds, absoluteSeconds))
      if (streamInfo.mode === 'direct') {
        video.currentTime = capped
        setCurrentTime(capped)
      } else {
        if (seekTimer.current) window.clearTimeout(seekTimer.current)
        setCurrentTime(capped)
        seekTimer.current = window.setTimeout(() => reloadAt(capped), 180)
      }
      bumpChrome()
    },
    [streamInfo, duration, reloadAt, bumpChrome, seekTimer],
  )

  const seekBy = useCallback(
    (delta: number) => {
      seekTo(absoluteTime() + delta)
    },
    [seekTo, absoluteTime],
  )

  const togglePip = useCallback(async () => {
    const video = videoRef.current
    if (!video || !pipSupported) return
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture()
      else await video.requestPictureInPicture()
    } catch {
      /* user gesture / unsupported */
    }
    bumpChrome()
  }, [pipSupported, bumpChrome])

  const cycleSubtitles = useCallback(() => {
    if (!streamInfo?.subtitleTracks.length) return
    const keys = ['off', ...streamInfo.subtitleTracks.map((t) => `${t.kind}:${t.index}:${t.path ?? ''}`)]
    const idx = keys.indexOf(subtitleKey)
    const next = keys[(idx + 1) % keys.length] ?? 'off'
    setSubtitleKey(next)
  }, [streamInfo, subtitleKey, setSubtitleKey])

  usePlayerKeyboard({
    videoRef,
    togglePlay,
    seekBy,
    seekTo,
    toggleFullscreen,
    togglePip,
    bumpChrome,
    nextFile,
    goNext,
    showHelp,
    setShowHelp,
    showUpNext,
    onDismissUpNext: () => {
      upNextDismissedRef.current = true
      setShowUpNext(false)
    },
    navigate,
    backPath,
    saveProgress,
    duration,
    cycleRate,
    onVolumeHud: (pct) => flashHud('volume', String(pct)),
    onSeekHud: (delta) => flashHud(delta >= 0 ? 'seek-forward' : 'seek-back', String(Math.abs(delta))),
    onRateHud: (rate) => flashHud('rate', String(rate)),
    cycleSubtitles,
  })

  useMediaSession({
    videoRef,
    title: label,
    artworkUrl: detail?.poster ?? detail?.backdrop,
    enabled: Boolean(path && detail && videoSrc),
    onPlay: () => {
      const video = videoRef.current
      if (video) void video.play().catch(() => undefined)
    },
    onPause: () => videoRef.current?.pause(),
    onSeekBy: seekBy,
    onSeekTo: seekTo,
    onNext: goNext,
    hasNext: Boolean(nextFile),
    currentTime,
    duration,
    paused,
  })

  const onStagePointer = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if ((e.target as HTMLElement).closest('.player-overlay, .player-error, .up-next, button, input, .player-settings-menu')) {
        return
      }
      if (e.pointerType === 'touch') {
        const now = Date.now()
        const prev = lastTapRef.current
        const stage = stageRef.current
        if (prev && now - prev.t < 320 && stage) {
          const width = stage.clientWidth || 1
          const third = width / 3
          if (e.clientX < third) {
            seekBy(-10)
            flashHud('seek-back', '10')
          } else if (e.clientX > width - third) {
            seekBy(10)
            flashHud('seek-forward', '10')
          } else {
            togglePlay()
          }
          lastTapRef.current = null
          e.preventDefault()
          return
        }
        lastTapRef.current = { t: now, x: e.clientX }
        // Single tap still toggles after a short delay unless double-tapped
        window.setTimeout(() => {
          const latest = lastTapRef.current
          if (latest && latest.t === now) {
            togglePlay()
            lastTapRef.current = null
          }
        }, 280)
        return
      }
      togglePlay()
    },
    [seekBy, togglePlay, flashHud],
  )

  if (error) {
    return <PlayerLoadError message={error} />
  }

  if (!path || !detail) {
    return <PlayerPreparing />
  }

  return (
    <div
      className={`player-page page-enter ${showChrome ? 'chrome-visible' : ''}`}
      onMouseMove={bumpChrome}
      onTouchStart={bumpChrome}
    >
      <div className={`player-top ${showChrome ? 'visible' : ''}`}>
        <button
          className="btn btn-ghost player-back"
          type="button"
          aria-label="Back to title"
          onClick={() => {
            void saveProgress(true)
            navigate(backPath)
          }}
        >
          <IconBack size={18} />
          <span>Back</span>
        </button>
        <div className="player-title-block">
          <h1>{label}</h1>
          {streamInfo ? (
            <span className="playback-pill mobile-only-pill" title={streamInfo.reason}>
              {modeLabel}
            </span>
          ) : null}
        </div>
        <div className="player-top-right">
          {streamInfo ? (
            <span className="playback-pill desktop-pill" title={streamInfo.reason}>
              {modeLabel}
              {streamInfo.videoCodec ? ` · ${streamInfo.videoCodec}` : ''}
              {streamInfo.audioCodec ? `/${streamInfo.audioCodec}` : ''}
              {prefs.rate !== 1 ? ` · ${prefs.rate}×` : ''}
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
        onDoubleClick={(e) => {
          if ((e.target as HTMLElement).closest('.player-overlay, button, input')) return
          toggleFullscreen()
        }}
        onPointerUp={onStagePointer}
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

        <PlayerHud kind={hud.kind} value={hud.value} flashKey={hud.key} />

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
          <PlayerMediaError
            mediaError={mediaError}
            backPath={backPath}
            streamInfo={streamInfo}
            nextFile={Boolean(nextFile)}
            onForceTranscode={() => {
              setMediaError('')
              setStreamInfo((s) =>
                s ? { ...s, mode: 'transcode', reason: 'Forced H.264/AAC transcode' } : s,
              )
              setSrcNonce((n) => n + 1)
            }}
            onSkipNext={goNext}
          />
        ) : null}

        {!mediaError && videoSrc ? (
          <PlayerControls
            videoRef={videoRef}
            showChrome={showChrome}
            paused={paused}
            currentTime={currentTime}
            duration={duration}
            volume={prefs.volume}
            muted={prefs.muted}
            rate={prefs.rate}
            showRemaining={prefs.showRemaining}
            buffered={buffered}
            streamInfo={streamInfo}
            audioIndex={audioIndex}
            subtitleKey={subtitleKey}
            hasNext={Boolean(nextFile)}
            pipSupported={pipSupported}
            isFullscreen={isFullscreen}
            onSeekTo={seekTo}
            onSeekBy={seekBy}
            onTogglePlay={togglePlay}
            onSaveProgress={saveProgress}
            onAudioChange={(next) => {
              const at = absoluteTime()
              setStartOffset(at)
              startOffsetRef.current = at
              audioOnlyReloadRef.current = true
              setAudioIndex(next)
              setBuffering(true)
            }}
            onSubtitleChange={setSubtitleKey}
            onGoNext={goNext}
            onBumpChrome={bumpChrome}
            onToggleFullscreen={toggleFullscreen}
            onTogglePip={() => void togglePip()}
            onVolumeChange={setVolume}
            onMutedChange={setMuted}
            onRateChange={(next) => {
              const video = videoRef.current
              if (video) video.playbackRate = next
              setRate(next)
            }}
            onToggleRemaining={toggleRemaining}
          />
        ) : null}
      </div>

      {showUpNext && nextFile && detail ? (
        <PlayerUpNext
          nextFile={nextFile}
          secondsRemaining={duration > 0 ? duration - currentTime : 999}
          onPlayNow={goNext}
          onDismiss={() => {
            upNextDismissedRef.current = true
            setShowUpNext(false)
          }}
        />
      ) : null}

      {showHelp ? (
        <PlayerHelp kind={kind} streamInfo={streamInfo} onClose={() => setShowHelp(false)} />
      ) : null}
    </div>
  )
}
