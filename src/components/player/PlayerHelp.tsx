import type { StreamInfo } from '../../hooks/usePlayerMedia'

type PlayerHelpProps = {
  kind: 'movie' | 'tv'
  streamInfo: StreamInfo | null
  onClose: () => void
}

export function PlayerHelp({ kind, streamInfo, onClose }: PlayerHelpProps) {
  return (
    <div className="player-help" role="dialog" aria-label="Keyboard shortcuts" onClick={onClose}>
      <div className="player-help-panel" onClick={(e) => e.stopPropagation()}>
        <h2>Shortcuts</h2>
        <ul>
          <li>
            <kbd>Space</kbd> / <kbd>K</kbd> Play / pause
          </li>
          <li>
            <kbd>J</kbd> / <kbd>L</kbd> or <kbd>←</kbd> / <kbd>→</kbd> Seek ±10s
          </li>
          <li>
            <kbd>↑</kbd> / <kbd>↓</kbd> Volume
          </li>
          <li>
            <kbd>&lt;</kbd> / <kbd>&gt;</kbd> Playback speed
          </li>
          <li>
            <kbd>0</kbd>–<kbd>9</kbd> Jump to %
          </li>
          <li>
            <kbd>F</kbd> Fullscreen
          </li>
          <li>
            <kbd>I</kbd> Picture-in-picture
          </li>
          <li>
            <kbd>M</kbd> Mute
          </li>
          <li>
            <kbd>C</kbd> Cycle subtitles
          </li>
          {kind === 'tv' ? (
            <li>
              <kbd>N</kbd> Next episode
            </li>
          ) : null}
          <li>
            <kbd>Esc</kbd> Dismiss overlay / exit
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
