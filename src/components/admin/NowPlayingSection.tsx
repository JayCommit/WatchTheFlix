import { Link } from 'react-router-dom'
import type { NowPlayingSession } from '../../types'
import { episodeLabel, formatTime } from '../../utils/format'
import { relativeAge } from '../../utils/relativeAge'

export function NowPlayingSection(props: {
  sessions: NowPlayingSession[]
  includeStale: boolean
  onIncludeStale: (v: boolean) => void
  onRefresh: () => void
  onOpenTitle?: (id: number) => void
  onClear?: (path: string) => void
}) {
  return (
    <div className="admin-now">
      <div className="admin-toolbar">
        <label className="admin-check">
          <input
            type="checkbox"
            checked={props.includeStale}
            onChange={(e) => props.onIncludeStale(e.target.checked)}
          />
          Show stalled / stopped
        </label>
        <button className="btn btn-ghost btn-sm" type="button" onClick={props.onRefresh}>
          Refresh
        </button>
        <span className="muted admin-count">
          Active if heartbeat within ~2 minutes. Remote force-stop isn’t available — last heartbeat
          shown below.
        </span>
      </div>
      {props.sessions.length === 0 ? (
        <div className="empty-state admin-empty">
          <h2>Nothing playing</h2>
          <p>Open the player on any device — heartbeats appear here within a few seconds.</p>
        </div>
      ) : (
        <ul className="admin-np-list">
          {props.sessions.map((s) => (
            <NowPlayingRow
              key={s.clientId}
              session={s}
              detailed
              onOpenTitle={props.onOpenTitle}
              onClear={props.onClear}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

export function NowPlayingRow(props: {
  session: NowPlayingSession
  detailed?: boolean
  onOpenTitle?: (id: number) => void
  onPlay?: (path: string, titleId: number) => void
  onClear?: (path: string) => void
}) {
  const s = props.session
  const ep =
    s.kind === 'tv' && s.season != null && s.episode != null
      ? episodeLabel(s.season, s.episode)
      : null
  const playHref =
    s.path && s.titleId != null
      ? `/play?path=${encodeURIComponent(s.path)}&titleId=${s.titleId}${s.kind ? `&kind=${s.kind}` : ''}`
      : null
  return (
    <li className={`admin-np-row status-${s.status}`}>
      <div className="admin-thumb">
        {s.poster ? <img src={s.poster} alt="" /> : <span>?</span>}
      </div>
      <div className="admin-np-body">
        <div className="admin-np-title">
          <strong>{s.titleName || s.filename || 'Unknown title'}</strong>
          {ep ? <span className="badge">{ep}</span> : null}
          <span className={`badge status-badge ${s.status}`}>{s.status}</span>
        </div>
        <div className="admin-mini-bar">
          <i style={{ width: `${s.progressPct}%` }} />
        </div>
        <div className="muted admin-np-meta">
          {formatTime(s.position)}
          {s.duration > 0 ? ` / ${formatTime(s.duration)}` : ''}
          {s.playbackMode ? ` · ${s.playbackMode}` : ''}
          {' · '}
          heartbeat {relativeAge(s.lastSeenAt)}
          {props.detailed && s.idleSeconds >= 0 ? ` (${s.idleSeconds}s idle)` : ''}
        </div>
        {props.detailed ? (
          <div className="muted admin-np-meta">
            Client {s.clientId.slice(0, 8)}…
            {s.ip ? ` · ${s.ip}` : ''}
            {s.userAgent ? ` · ${s.userAgent.slice(0, 64)}` : ''}
          </div>
        ) : null}
        <div className="admin-actions" style={{ marginTop: '0.45rem' }}>
          {s.titleId != null && props.onOpenTitle ? (
            <button
              className="btn btn-ghost btn-sm"
              type="button"
              onClick={() => props.onOpenTitle?.(s.titleId!)}
            >
              Open
            </button>
          ) : null}
          {props.detailed && playHref ? (
            <Link
              className="btn btn-ghost btn-sm"
              to={playHref}
              onClick={() => {
                if (s.path && s.titleId != null) props.onPlay?.(s.path, s.titleId)
              }}
            >
              Play
            </Link>
          ) : null}
          {props.detailed && s.path && props.onClear ? (
            <button
              className="btn btn-ghost btn-sm"
              type="button"
              onClick={() => props.onClear?.(s.path)}
            >
              Clear progress
            </button>
          ) : null}
        </div>
      </div>
    </li>
  )
}
