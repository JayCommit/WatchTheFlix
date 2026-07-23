import type { RefObject } from 'react'
import type { StreamInfo } from '../../hooks/usePlayerMedia'
import { formatTime } from '../../utils/format'

type PlayerControlsProps = {
  videoRef: RefObject<HTMLVideoElement | null>
  showChrome: boolean
  paused: boolean
  currentTime: number
  duration: number
  volume: number
  muted: boolean
  progressPct: number
  streamInfo: StreamInfo | null
  audioIndex: number
  subtitleKey: string
  hasNext: boolean
  onSeekTo: (absoluteSeconds: number) => void
  onSeekBy: (delta: number) => void
  onTogglePlay: () => void
  onSaveProgress: (force?: boolean) => void
  onAudioChange: (next: number) => void
  onSubtitleChange: (key: string) => void
  onGoNext: () => void
  onBumpChrome: () => void
  onToggleFullscreen: () => void
}

export function PlayerControls({
  videoRef,
  showChrome,
  paused,
  currentTime,
  duration,
  volume,
  muted,
  progressPct,
  streamInfo,
  audioIndex,
  subtitleKey,
  hasNext,
  onSeekTo,
  onSeekBy,
  onTogglePlay,
  onSaveProgress,
  onAudioChange,
  onSubtitleChange,
  onGoNext,
  onBumpChrome,
  onToggleFullscreen,
}: PlayerControlsProps) {
  return (
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
          onChange={(e) => onSeekTo(Number(e.target.value))}
          onMouseUp={() => void onSaveProgress(true)}
          onTouchEnd={() => void onSaveProgress(true)}
        />
      </div>
      <div className="player-controls">
        <div className="left">
          <button className="ctrl-btn" type="button" aria-label={paused ? 'Play' : 'Pause'} onClick={onTogglePlay}>
            {paused ? '▶' : '❚❚'}
          </button>
          <button className="ctrl-btn" type="button" aria-label="Rewind 10 seconds" onClick={() => onSeekBy(-10)}>
            −10
          </button>
          <button className="ctrl-btn" type="button" aria-label="Forward 10 seconds" onClick={() => onSeekBy(10)}>
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
                onChange={(e) => onAudioChange(Number(e.target.value))}
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
                onChange={(e) => onSubtitleChange(e.target.value)}
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
          {hasNext ? (
            <button className="ctrl-btn" type="button" onClick={onGoNext}>
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
              onBumpChrome()
            }}
          />
          <button className="ctrl-btn" type="button" aria-label="Fullscreen" onClick={onToggleFullscreen}>
            Full
          </button>
        </div>
      </div>
      <div className="player-progress-track" aria-hidden>
        <i style={{ width: `${progressPct}%` }} />
      </div>
    </div>
  )
}
