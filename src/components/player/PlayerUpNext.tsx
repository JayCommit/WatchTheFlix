import { episodeLabel } from '../../utils/format'
import type { MediaFile } from '../../types'

type PlayerUpNextProps = {
  nextFile: MediaFile
  onPlayNow: () => void
  onDismiss: () => void
}

export function PlayerUpNext({ nextFile, onPlayNow, onDismiss }: PlayerUpNextProps) {
  return (
    <div className="up-next" role="dialog" aria-label="Up next">
      <div className="up-next-panel">
        <p className="muted">Up next</p>
        <h2>
          {episodeLabel(nextFile.season, nextFile.episode)}
          {nextFile.episodeName ? ` · ${nextFile.episodeName}` : ''}
        </h2>
        <div className="hero-actions">
          <button className="btn btn-primary" type="button" onClick={onPlayNow}>
            Play now
          </button>
          <button className="btn btn-ghost" type="button" onClick={onDismiss}>
            Dismiss
          </button>
        </div>
      </div>
    </div>
  )
}
