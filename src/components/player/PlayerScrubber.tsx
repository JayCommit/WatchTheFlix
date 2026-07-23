import { useCallback, useRef, useState } from 'react'
import { formatTime } from '../../utils/format'

type BufferedRange = { start: number; end: number }

type PlayerScrubberProps = {
  currentTime: number
  duration: number
  buffered: BufferedRange[]
  onSeekTo: (absoluteSeconds: number) => void
  onSeekEnd: () => void
  onInteract: () => void
}

export function PlayerScrubber({
  currentTime,
  duration,
  buffered,
  onSeekTo,
  onSeekEnd,
  onInteract,
}: PlayerScrubberProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [hoverPct, setHoverPct] = useState<number | null>(null)
  const [dragging, setDragging] = useState(false)

  const pct = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0

  const timeFromClientX = useCallback(
    (clientX: number) => {
      const el = trackRef.current
      if (!el || duration <= 0) return 0
      const rect = el.getBoundingClientRect()
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
      return ratio * duration
    },
    [duration],
  )

  const updateHover = useCallback(
    (clientX: number) => {
      const el = trackRef.current
      if (!el || duration <= 0) {
        setHoverPct(null)
        return
      }
      const rect = el.getBoundingClientRect()
      setHoverPct(Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100)))
    },
    [duration],
  )

  return (
    <div
      className={`player-scrubber ${dragging ? 'dragging' : ''}`}
      ref={trackRef}
      role="slider"
      tabIndex={0}
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={Math.floor(duration || 0)}
      aria-valuenow={Math.floor(currentTime || 0)}
      aria-valuetext={formatTime(currentTime)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
          e.preventDefault()
          onSeekTo(currentTime + 5)
          onInteract()
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
          e.preventDefault()
          onSeekTo(currentTime - 5)
          onInteract()
        } else if (e.key === 'Home') {
          e.preventDefault()
          onSeekTo(0)
          onInteract()
        } else if (e.key === 'End') {
          e.preventDefault()
          onSeekTo(duration)
          onInteract()
        }
      }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        setDragging(true)
        onSeekTo(timeFromClientX(e.clientX))
        updateHover(e.clientX)
        onInteract()
      }}
      onPointerMove={(e) => {
        updateHover(e.clientX)
        if (!dragging && !(e.buttons & 1)) return
        if (dragging) {
          onSeekTo(timeFromClientX(e.clientX))
          onInteract()
        }
      }}
      onPointerUp={(e) => {
        if (dragging) {
          onSeekTo(timeFromClientX(e.clientX))
          onSeekEnd()
        }
        setDragging(false)
      }}
      onPointerCancel={() => setDragging(false)}
      onPointerLeave={() => {
        if (!dragging) setHoverPct(null)
      }}
    >
      <div className="player-scrubber-rail">
        {buffered.map((range, i) => {
          if (duration <= 0) return null
          const left = (range.start / duration) * 100
          const width = ((range.end - range.start) / duration) * 100
          return (
            <i
              key={i}
              className="player-scrubber-buffered"
              style={{ left: `${left}%`, width: `${Math.max(0, width)}%` }}
            />
          )
        })}
        <i className="player-scrubber-played" style={{ width: `${pct}%` }} />
        <i className="player-scrubber-thumb" style={{ left: `${pct}%` }} />
      </div>
      {hoverPct != null && duration > 0 ? (
        <div className="player-scrubber-tip" style={{ left: `${hoverPct}%` }}>
          {formatTime((hoverPct / 100) * duration)}
        </div>
      ) : null}
    </div>
  )
}
