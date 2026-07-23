import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import {
  PlayerControls,
  PlayerHelp,
  PlayerLoadError,
  PlayerMediaError,
  PlayerPreparing,
  PlayerUpNext,
} from '../components/player'
import { usePlaybackProgress } from '../hooks/usePlaybackProgress'
import { usePlayerChrome } from '../hooks/usePlayerChrome'
import { usePlayerKeyboard } from '../hooks/usePlayerKeyboard'
import { usePlayerMedia } from '../hooks/usePlayerMedia'

export function PlayerPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const videoRef = useRef<HTMLVideoElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)

  const [paused, setPaused] = useState(true)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const [showHelp, setShowHelp] = useState(false)

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

  const { showChrome, bumpChrome, toggleFullscreen } = usePlayerChrome({ videoRef, stageRef })

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
  ])

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
    if (video.paused) void video.play().catch(() => setMediaError('Could not start playback.'))
    else video.pause()
    bumpChrome()
  }, [bumpChrome, setMediaError])

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
    [streamInfo, duration, reloadAt, bumpChrome, seekTimer],
  )

  const seekBy = useCallback(
    (delta: number) => {
      seekTo(absoluteTime() + delta)
    },
    [seekTo, absoluteTime],
  )

  usePlayerKeyboard({
    videoRef,
    togglePlay,
    seekBy,
    toggleFullscreen,
    bumpChrome,
    nextFile,
    goNext,
    showHelp,
    setShowHelp,
    navigate,
    backPath,
    saveProgress,
  })

  if (error) {
    return <PlayerLoadError message={error} />
  }

  if (!path || !detail) {
    return <PlayerPreparing />
  }

  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0

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
            volume={volume}
            muted={muted}
            progressPct={progressPct}
            streamInfo={streamInfo}
            audioIndex={audioIndex}
            subtitleKey={subtitleKey}
            hasNext={Boolean(nextFile)}
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
          />
        ) : null}
      </div>

      {showUpNext && nextFile && detail ? (
        <PlayerUpNext
          nextFile={nextFile}
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
