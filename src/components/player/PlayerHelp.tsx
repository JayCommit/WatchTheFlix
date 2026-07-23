import type { StreamInfo } from '../../hooks/usePlayerMedia'

type PlayerHelpProps = {
  kind: 'movie' | 'tv'
  streamInfo: StreamInfo | null
  onClose: () => void
}

export function PlayerHelp({ kind, streamInfo, onClose }: PlayerHelpProps) {
  return (
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
        <button className="btn btn-primary" type="button" onClick={onClose}>
          Got it
        </button>
      </div>
    </div>
  )
}
