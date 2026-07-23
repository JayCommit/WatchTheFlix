import { Link } from 'react-router-dom'
import type { AdminTitle, TmdbSearchResult } from '../../types'
import { episodeLabel, formatBytes } from '../../utils/format'
import { AdminSkeleton } from './AdminSkeleton'
import { RematchPanel } from './RematchPanel'
import type { DrawerHealth } from './types'

export function AdminTitleDrawer(props: {
  drawer: AdminTitle | null
  drawerLoading: boolean
  drawerHealth: DrawerHealth | null
  rematchId: number | null
  rematchQuery: string
  rematchKind: 'movie' | 'tv'
  rematchResults: TmdbSearchResult[]
  rematchSearching: boolean
  rematchError: string
  onRematchQuery: (v: string) => void
  onRematchKind: (v: 'movie' | 'tv') => void
  onRematchSearch: () => void
  onRematchApply: (tmdbId?: number) => void
  onRematchAuto: () => void
  onRematchCancel: () => void
  mergeTargetId: string
  onMergeTargetId: (v: string) => void
  onMerge: () => void
  reassignTargets: Record<string, string>
  onReassignTarget: (path: string, value: string) => void
  onReassign: (path: string) => void
  busyId: number | null
  onClose: () => void
  onOpenRematch: (t: AdminTitle) => void
  onToggleHide: (t: AdminTitle) => void
  onMarkTitleWatched: (titleId: number) => void
  onClearTitleProgress: (titleId: number) => void
  onMarkFileWatched: (path: string, duration?: number) => void
  onClearFileProgress: (path: string) => void
  onPrefer: (path: string) => void
  onDeleteFile: (path: string) => void
  onConvertEnqueue: (path: string) => void
  onNotify: (msg: string) => void
}) {
  const { drawer, drawerLoading } = props
  if (!drawer && !drawerLoading) return null

  return (
    <aside className="admin-drawer" role="dialog" aria-modal="true" aria-label="Title details">
      <div className="admin-drawer-head">
        <h2>{drawer?.title ?? 'Loading…'}</h2>
        <button className="btn btn-ghost btn-sm" type="button" onClick={props.onClose}>
          Close
        </button>
      </div>
      {drawerLoading && !drawer ? (
        <AdminSkeleton rows={4} />
      ) : drawer ? (
        <div className="admin-drawer-body">
          <div className="admin-drawer-meta">
            <div className="admin-thumb lg">
              {drawer.poster ? <img src={drawer.poster} alt="" /> : <span>?</span>}
            </div>
            <div>
              <p className="muted">
                {drawer.kind.toUpperCase()}
                {drawer.year ? ` · ${drawer.year}` : ''}
                {drawer.unmatched ? ' · unmatched' : ` · TMDB ${drawer.tmdbId}`}
              </p>
              <div className="admin-actions" style={{ marginTop: '0.65rem' }}>
                <button
                  className="btn btn-ghost btn-sm"
                  type="button"
                  onClick={() => props.onOpenRematch(drawer)}
                >
                  Rematch
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  type="button"
                  disabled={props.busyId === drawer.id}
                  onClick={() => props.onToggleHide(drawer)}
                >
                  {drawer.hidden ? 'Unhide' : 'Hide'}
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  type="button"
                  disabled={props.busyId === drawer.id}
                  onClick={() => props.onMarkTitleWatched(drawer.id)}
                >
                  Mark watched
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  type="button"
                  disabled={props.busyId === drawer.id}
                  onClick={() => props.onClearTitleProgress(drawer.id)}
                >
                  Clear progress
                </button>
                {!drawer.hidden ? (
                  <Link
                    className="btn btn-primary btn-sm"
                    to={drawer.kind === 'movie' ? `/movie/${drawer.id}` : `/tv/${drawer.id}`}
                  >
                    Open
                  </Link>
                ) : null}
              </div>
              <div className="admin-inline-form" style={{ marginTop: '0.75rem' }}>
                <input
                  className="admin-input admin-input-year"
                  type="number"
                  inputMode="numeric"
                  placeholder="Merge into title id"
                  value={props.mergeTargetId}
                  onChange={(e) => props.onMergeTargetId(e.target.value)}
                  aria-label="Merge into title id"
                />
                <button
                  className="btn btn-ghost btn-sm"
                  type="button"
                  disabled={props.busyId === drawer.id || !props.mergeTargetId.trim()}
                  onClick={props.onMerge}
                >
                  Merge
                </button>
              </div>
            </div>
          </div>

          {drawer.kind === 'tv' && !drawer.unmatched && props.drawerHealth ? (
            <div className="admin-drawer-health">
              <h3 className="admin-drawer-sub">
                Episode health{' '}
                <span className="muted">
                  {props.drawerHealth.present}/{props.drawerHealth.expected}
                </span>
              </h3>
              {props.drawerHealth.expected === 0 ? (
                <p className="muted">No episode list available.</p>
              ) : props.drawerHealth.missing.length === 0 ? (
                <p className="muted">All known episodes present.</p>
              ) : (
                <ul className="missing-list">
                  {props.drawerHealth.missing.slice(0, 20).map((m) => (
                    <li key={`${m.season}x${m.episode}`}>
                      S{String(m.season).padStart(2, '0')}E
                      {String(m.episode).padStart(2, '0')} · {m.name}
                    </li>
                  ))}
                  {props.drawerHealth.missing.length > 20 ? (
                    <li className="muted">…and {props.drawerHealth.missing.length - 20} more</li>
                  ) : null}
                </ul>
              )}
            </div>
          ) : null}

          {props.rematchId === drawer.id ? (
            <RematchPanel
              query={props.rematchQuery}
              kind={props.rematchKind}
              results={props.rematchResults}
              searching={props.rematchSearching}
              error={props.rematchError}
              busy={props.busyId === drawer.id}
              onQuery={props.onRematchQuery}
              onKind={props.onRematchKind}
              onSearch={props.onRematchSearch}
              onApply={props.onRematchApply}
              onAuto={props.onRematchAuto}
              onCancel={props.onRematchCancel}
            />
          ) : null}

          <h3 className="admin-drawer-sub">Files ({drawer.files?.length ?? 0})</h3>
          {!drawer.files?.length ? (
            <p className="muted">No files linked.</p>
          ) : (
            <ul className="admin-file-detail">
              {drawer.files.map((f) => {
                const pct =
                  f.progress && f.progress.duration > 0
                    ? Math.round((f.progress.position / f.progress.duration) * 100)
                    : null
                return (
                  <li key={f.path}>
                    <div className="admin-file-detail-main">
                      <strong>
                        {drawer.kind === 'tv' ? episodeLabel(f.season, f.episode) : f.filename}
                        {f.preferred ? (
                          <span className="version-pill preferred" style={{ marginLeft: '0.4rem' }}>
                            Preferred
                          </span>
                        ) : null}
                      </strong>
                      <span className="muted">
                        {drawer.kind === 'tv' ? f.filename : formatBytes(f.size)}
                        {f.episodeName ? ` · ${f.episodeName}` : ''}
                      </span>
                      <div className="codec-row">
                        {f.preferred ? <span className="codec-badge ok">Preferred</span> : null}
                        {f.canDirect ? (
                          <span className="codec-badge ok">Direct</span>
                        ) : f.playbackMode === 'remux' ? (
                          <span className="codec-badge warn">Remux</span>
                        ) : f.playbackMode === 'transcode' ? (
                          <span className="codec-badge bad">Transcode</span>
                        ) : (
                          <span className="codec-badge muted">Unknown</span>
                        )}
                        {(f.videoCodec || f.audioCodec || f.container) && (
                          <span className="muted" style={{ fontSize: '0.78rem' }}>
                            {[f.container, f.videoCodec, f.audioCodec].filter(Boolean).join(' · ')}
                          </span>
                        )}
                      </div>
                      {pct != null ? (
                        <div className="admin-mini-bar" title={`${pct}%`}>
                          <i style={{ width: `${pct}%` }} />
                        </div>
                      ) : (
                        <span className="muted" style={{ fontSize: '0.78rem' }}>
                          No progress
                        </span>
                      )}
                    </div>
                    <div className="admin-actions">
                      <Link
                        className="btn btn-ghost btn-sm"
                        to={`/play?path=${encodeURIComponent(f.path)}&titleId=${drawer.id}&kind=${drawer.kind}`}
                      >
                        Play
                      </Link>
                      <button
                        className="btn btn-ghost btn-sm"
                        type="button"
                        title={f.path}
                        onClick={() => {
                          void navigator.clipboard.writeText(f.path).then(
                            () => props.onNotify('Path copied'),
                            () => props.onNotify('Could not copy path'),
                          )
                        }}
                      >
                        Copy path
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        type="button"
                        onClick={() => props.onConvertEnqueue(f.path)}
                      >
                        Convert
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        type="button"
                        onClick={() => props.onDeleteFile(f.path)}
                      >
                        Delete
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        type="button"
                        disabled={Boolean(f.preferred)}
                        onClick={() => props.onPrefer(f.path)}
                      >
                        {f.preferred ? 'Preferred' : 'Prefer'}
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        type="button"
                        onClick={() => props.onMarkFileWatched(f.path, f.progress?.duration)}
                      >
                        Watched
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        type="button"
                        onClick={() => props.onClearFileProgress(f.path)}
                      >
                        Clear
                      </button>
                    </div>
                    <div className="admin-inline-form" style={{ marginTop: '0.45rem' }}>
                      <input
                        className="admin-input admin-input-year"
                        type="number"
                        inputMode="numeric"
                        placeholder="Title id"
                        value={props.reassignTargets[f.path] ?? ''}
                        onChange={(e) => props.onReassignTarget(f.path, e.target.value)}
                        aria-label={`Reassign ${f.filename} to title id`}
                      />
                      <button
                        className="btn btn-ghost btn-sm"
                        type="button"
                        disabled={!props.reassignTargets[f.path]?.trim()}
                        onClick={() => props.onReassign(f.path)}
                      >
                        Reassign
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      ) : null}
    </aside>
  )
}
