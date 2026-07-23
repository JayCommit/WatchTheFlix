import { Link } from 'react-router-dom'
import type { StreamInfo } from '../../hooks/usePlayerMedia'

type LoadErrorProps = {
  message: string
}

export function PlayerLoadError({ message }: LoadErrorProps) {
  return (
    <div className="empty-state page-enter">
      <h2>Playback error</h2>
      <p>{message}</p>
      <Link className="btn btn-ghost" to="/">
        Back
      </Link>
    </div>
  )
}

export function PlayerPreparing() {
  return <div className="loading page-enter">Preparing stream…</div>
}

type MediaErrorProps = {
  mediaError: string
  backPath: string
  streamInfo: StreamInfo | null
  nextFile: boolean
  onForceTranscode: () => void
  onSkipNext: () => void
}

export function PlayerMediaError({
  mediaError,
  backPath,
  streamInfo,
  nextFile,
  onForceTranscode,
  onSkipNext,
}: MediaErrorProps) {
  return (
    <div className="player-error">
      <h2>Can’t play this file</h2>
      <p>{mediaError}</p>
      <div className="hero-actions">
        <Link className="btn btn-primary" to={backPath}>
          Back to title
        </Link>
        {streamInfo?.ffmpegAvailable ? (
          <button className="btn btn-ghost" type="button" onClick={onForceTranscode}>
            Force transcode
          </button>
        ) : null}
        {nextFile ? (
          <button className="btn btn-ghost" type="button" onClick={onSkipNext}>
            Skip to next
          </button>
        ) : null}
      </div>
    </div>
  )
}
