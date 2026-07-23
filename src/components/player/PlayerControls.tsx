import { useEffect, useMemo, useState, type RefObject } from 'react'
import type { StreamInfo } from '../../hooks/usePlayerMedia'
import type { PlaybackRate } from '../../hooks/usePlayerPrefs'
import { formatTime } from '../../utils/format'
import {
  IconForward10,
  IconFullscreen,
  IconNext,
  IconPause,
  IconPip,
  IconPlay,
  IconRewind10,
  IconVolume,
} from './PlayerIcons'
import { PlayerScrubber } from './PlayerScrubber'
import { PlayerSettingsMenu } from './PlayerSettingsMenu'

type BufferedRange = { start: number; end: number }

type PlayerControlsProps = {
  videoRef: RefObject<HTMLVideoElement | null>
  showChrome: boolean
  paused: boolean
  currentTime: number
  duration: number
  volume: number
  muted: boolean
  rate: PlaybackRate
  showRemaining: boolean
  buffered: BufferedRange[]
  streamInfo: StreamInfo | null
  audioIndex: number
  subtitleKey: string
  hasNext: boolean
  pipSupported: boolean
  isFullscreen: boolean
  onSeekTo: (absoluteSeconds: number) => void
  onSeekBy: (delta: number) => void
  onTogglePlay: () => void
  onSaveProgress: (force?: boolean) => void
  onAudioChange: (next: number) => void
  onSubtitleChange: (key: string) => void
  onGoNext: () => void
  onBumpChrome: () => void
  onToggleFullscreen: () => void
  onTogglePip: () => void
  onVolumeChange: (volume: number) => void
  onMutedChange: (muted: boolean) => void
  onRateChange: (rate: PlaybackRate) => void
  onToggleRemaining: () => void
}

export function PlayerControls({
  videoRef,
  showChrome,
  paused,
  currentTime,
  duration,
  volume,
  muted,
  rate,
  showRemaining,
  buffered,
  streamInfo,
  audioIndex,
  subtitleKey,
  hasNext,
  pipSupported,
  isFullscreen,
  onSeekTo,
  onSeekBy,
  onTogglePlay,
  onSaveProgress,
  onAudioChange,
  onSubtitleChange,
  onGoNext,
  onBumpChrome,
  onToggleFullscreen,
  onTogglePip,
  onVolumeChange,
  onMutedChange,
  onRateChange,
  onToggleRemaining,
}: PlayerControlsProps) {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [volOpen, setVolOpen] = useState(false)

  useEffect(() => {
    if (!showChrome && !paused) {
      setSettingsOpen(false)
      setVolOpen(false)
    }
  }, [showChrome, paused])

  const volumeLevel = muted || volume === 0 ? 'off' : volume < 0.45 ? 'low' : 'high'
  const timeLabel = useMemo(() => {
    if (showRemaining && duration > 0) {
      return `${formatTime(currentTime)} / −${formatTime(Math.max(0, duration - currentTime))}`
    }
    return `${formatTime(currentTime)} / ${formatTime(duration)}`
  }, [currentTime, duration, showRemaining])

  return (
    <div className={`player-overlay ${showChrome || paused || settingsOpen ? 'visible' : ''}`}>
      <PlayerScrubber
        currentTime={currentTime}
        duration={duration}
        buffered={buffered}
        onSeekTo={onSeekTo}
        onSeekEnd={() => void onSaveProgress(true)}
        onInteract={onBumpChrome}
      />

      <div className="player-controls">
        <div className="left">
          <button
            className="ctrl-btn ctrl-icon ctrl-play"
            type="button"
            aria-label={paused ? 'Play' : 'Pause'}
            onClick={onTogglePlay}
          >
            {paused ? <IconPlay size={24} /> : <IconPause size={24} />}
          </button>
          <button
            className="ctrl-btn ctrl-icon"
            type="button"
            aria-label="Rewind 10 seconds"
            onClick={() => onSeekBy(-10)}
          >
            <IconRewind10 size={22} />
          </button>
          <button
            className="ctrl-btn ctrl-icon"
            type="button"
            aria-label="Forward 10 seconds"
            onClick={() => onSeekBy(10)}
          >
            <IconForward10 size={22} />
          </button>
          <button
            className="time-readout time-toggle"
            type="button"
            title="Toggle remaining time"
            aria-label={
              showRemaining
                ? `Elapsed ${formatTime(currentTime)}, remaining ${formatTime(Math.max(0, duration - currentTime))}. Click to show duration.`
                : `Elapsed ${formatTime(currentTime)} of ${formatTime(duration)}. Click to show remaining.`
            }
            onClick={() => {
              onToggleRemaining()
              onBumpChrome()
            }}
          >
            {timeLabel}
          </button>
        </div>

        <div className="right">
          <div
            className={`player-volume ${volOpen ? 'open' : ''}`}
            onMouseEnter={() => setVolOpen(true)}
            onMouseLeave={() => setVolOpen(false)}
            onFocus={() => setVolOpen(true)}
          >
            <button
              className="ctrl-btn ctrl-icon"
              type="button"
              aria-label={muted ? 'Unmute' : 'Mute'}
              onClick={() => {
                const video = videoRef.current
                if (!video) return
                const next = !video.muted
                video.muted = next
                onMutedChange(next)
                onBumpChrome()
              }}
            >
              <IconVolume level={volumeLevel} size={20} />
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
                onVolumeChange(v)
                onMutedChange(v === 0)
                onBumpChrome()
              }}
            />
          </div>

          <PlayerSettingsMenu
            open={settingsOpen}
            onOpenChange={setSettingsOpen}
            rate={rate}
            onRateChange={(next) => {
              const video = videoRef.current
              if (video) video.playbackRate = next
              onRateChange(next)
            }}
            streamInfo={streamInfo}
            audioIndex={audioIndex}
            subtitleKey={subtitleKey}
            onAudioChange={onAudioChange}
            onSubtitleChange={onSubtitleChange}
            onInteract={onBumpChrome}
          />

          {hasNext ? (
            <button className="ctrl-btn ctrl-icon" type="button" aria-label="Next episode" onClick={onGoNext}>
              <IconNext size={20} />
            </button>
          ) : null}

          {pipSupported ? (
            <button
              className="ctrl-btn ctrl-icon"
              type="button"
              aria-label="Picture in picture"
              onClick={onTogglePip}
            >
              <IconPip size={20} />
            </button>
          ) : null}

          <button
            className="ctrl-btn ctrl-icon"
            type="button"
            aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            onClick={onToggleFullscreen}
          >
            <IconFullscreen exit={isFullscreen} size={20} />
          </button>
        </div>
      </div>
    </div>
  )
}
