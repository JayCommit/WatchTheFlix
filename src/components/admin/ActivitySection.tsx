import { Link } from 'react-router-dom'
import type { ActivityEvent, ActivityProgress } from '../../types'
import { episodeLabel, formatTime } from '../../utils/format'
import { relativeAge } from '../../utils/relativeAge'

export function ActivitySection(props: {
  events: ActivityEvent[]
  progress: ActivityProgress[]
  tab: 'events' | 'progress'
  onTab: (t: 'events' | 'progress') => void
  onRefresh: () => void
  onOpenTitle?: (id: number) => void
  onClear?: (path: string) => void
  onMarkWatched?: (path: string, duration?: number) => void
}) {
  return (
    <div className="admin-activity">
      <div className="admin-toolbar">
        <button
          type="button"
          className={`btn btn-sm ${props.tab === 'progress' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => props.onTab('progress')}
        >
          Watch history
        </button>
        <button
          type="button"
          className={`btn btn-sm ${props.tab === 'events' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => props.onTab('events')}
        >
          Session events
        </button>
        <button className="btn btn-ghost btn-sm" type="button" onClick={props.onRefresh}>
          Refresh
        </button>
      </div>

      {props.tab === 'progress' ? (
        props.progress.length === 0 ? (
          <div className="empty-state admin-empty">
            <h2>No watch history yet</h2>
            <p>Progress updates from the player show up here.</p>
          </div>
        ) : (
          <ul className="admin-activity-list">
            {props.progress.map((p) => {
              const pct =
                p.duration > 0 ? Math.round((p.position / p.duration) * 100) : 0
              const playHref = `/play?path=${encodeURIComponent(p.path)}&titleId=${p.titleId}&kind=${p.kind}`
              return (
                <li key={`${p.path}-${p.updatedAt}`}>
                  <div className="admin-thumb sm">
                    {p.poster ? <img src={p.poster} alt="" /> : <span>?</span>}
                  </div>
                  <div>
                    <strong>
                      {p.title}
                      {p.kind === 'tv' && p.season != null
                        ? ` · ${episodeLabel(p.season, p.episode)}`
                        : ''}
                    </strong>
                    <span className="muted">
                      {formatTime(p.position)}
                      {p.duration > 0 ? ` / ${formatTime(p.duration)} (${pct}%)` : ''}
                      {' · '}
                      {relativeAge(p.updatedAt)}
                    </span>
                    <div className="admin-actions" style={{ marginTop: '0.4rem' }}>
                      {props.onOpenTitle ? (
                        <button
                          className="btn btn-ghost btn-sm"
                          type="button"
                          onClick={() => props.onOpenTitle?.(p.titleId)}
                        >
                          Open
                        </button>
                      ) : null}
                      <Link className="btn btn-ghost btn-sm" to={playHref}>
                        Play
                      </Link>
                      {props.onClear ? (
                        <button
                          className="btn btn-ghost btn-sm"
                          type="button"
                          onClick={() => props.onClear?.(p.path)}
                        >
                          Clear
                        </button>
                      ) : null}
                      {props.onMarkWatched ? (
                        <button
                          className="btn btn-ghost btn-sm"
                          type="button"
                          onClick={() => props.onMarkWatched?.(p.path, p.duration)}
                        >
                          Mark watched
                        </button>
                      ) : null}
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )
      ) : props.events.length === 0 ? (
        <div className="empty-state admin-empty">
          <h2>No session events</h2>
          <p>Play / pause / stop heartbeats will appear here.</p>
        </div>
      ) : (
        <ul className="admin-activity-list">
          {props.events.map((e) => (
            <li key={e.id}>
              <div>
                <strong>
                  <span className="badge">{e.eventType}</span>{' '}
                  {e.titleName || e.path || '—'}
                  {e.season != null && e.episode != null
                    ? ` · ${episodeLabel(e.season, e.episode)}`
                    : ''}
                </strong>
                <span className="muted">
                  {relativeAge(e.createdAt)}
                  {e.detail ? ` · ${e.detail}` : ''}
                  {e.clientId ? ` · ${e.clientId.slice(0, 8)}…` : ''}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
