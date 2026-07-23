import { useEffect, useRef, useState } from 'react'
import { episodeLabel } from '../../utils/format'
import type { MediaFile } from '../../types'

const AUTO_SECONDS = 8

type PlayerUpNextProps = {
  nextFile: MediaFile
  secondsRemaining: number
  onPlayNow: () => void
  onDismiss: () => void
}

export function PlayerUpNext({
  nextFile,
  secondsRemaining,
  onPlayNow,
  onDismiss,
}: PlayerUpNextProps) {
  const [left, setLeft] = useState<number | null>(null)
  const fired = useRef(false)

  useEffect(() => {
    fired.current = false
    setLeft(null)
  }, [nextFile.path])

  useEffect(() => {
    if (secondsRemaining > AUTO_SECONDS || secondsRemaining < 0) return
    const nextLeft = Math.max(0, Math.ceil(secondsRemaining))
    setLeft(nextLeft)
    if (nextLeft <= 0 && !fired.current) {
      fired.current = true
      onPlayNow()
    }
  }, [secondsRemaining, onPlayNow])

  const pct =
    left == null ? 0 : Math.min(100, ((AUTO_SECONDS - left) / AUTO_SECONDS) * 100)

  return (
    <div className="up-next" role="dialog" aria-label="Up next">
      <div className="up-next-panel">
        <div className="up-next-head">
          <p className="muted">
            Up next{left != null ? ` · ${left}s` : ''}
          </p>
          {left != null ? (
            <div className="up-next-bar" aria-hidden>
              <i style={{ width: `${pct}%` }} />
            </div>
          ) : null}
        </div>
        <h2>
          {episodeLabel(nextFile.season, nextFile.episode)}
          {nextFile.episodeName ? ` · ${nextFile.episodeName}` : ''}
        </h2>
        <div className="hero-actions">
          <button className="btn btn-primary" type="button" onClick={onPlayNow}>
            Play now
          </button>
          <button
            className="btn btn-ghost"
            type="button"
            onClick={() => {
              fired.current = true
              onDismiss()
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
