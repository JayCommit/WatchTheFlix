import { Link } from 'react-router-dom'
import type { AdminTitle, TmdbSearchResult } from '../../types'
import { AdminSkeleton } from './AdminSkeleton'
import { RematchPanel } from './RematchPanel'

export function AdminLibrarySection(props: {
  section: 'library' | 'unmatched'
  titles: AdminTitle[]
  loading: boolean
  error: string
  q: string
  onQ: (v: string) => void
  kind: 'movie' | 'tv' | ''
  onKind: (v: 'movie' | 'tv' | '') => void
  matchFilter: 'all' | 'matched' | 'unmatched'
  onMatchFilter: (v: 'all' | 'matched' | 'unmatched') => void
  showHidden: boolean
  onShowHidden: (v: boolean) => void
  selected: Set<number>
  onSelected: (next: Set<number> | ((prev: Set<number>) => Set<number>)) => void
  editId: number | null
  editTitle: string
  editYear: string
  onEditTitle: (v: string) => void
  onEditYear: (v: string) => void
  onSaveEdit: () => void
  onCancelEdit: () => void
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
  busyId: number | null
  onRetry: () => void
  onBulkHideSelected: () => void
  onBulkHideAllUnmatched: () => void
  onOpenDrawer: (id: number) => void
  onOpenEdit: (t: AdminTitle) => void
  onOpenRematch: (t: AdminTitle) => void
  onToggleHide: (t: AdminTitle) => void
}) {
  const { section, titles, loading, error } = props

  return (
    <>
      <div className="admin-toolbar">
        <input
          id="wtf-admin-search"
          className="admin-input"
          type="search"
          placeholder="Search title or TMDB id…"
          value={props.q}
          onChange={(e) => props.onQ(e.target.value)}
          autoFocus
        />
        <select
          className="admin-select"
          value={props.kind}
          onChange={(e) => props.onKind(e.target.value as 'movie' | 'tv' | '')}
        >
          <option value="">All kinds</option>
          <option value="movie">Movies</option>
          <option value="tv">TV</option>
        </select>
        {section === 'library' ? (
          <>
            <select
              className="admin-select"
              value={props.matchFilter}
              onChange={(e) =>
                props.onMatchFilter(e.target.value as 'all' | 'matched' | 'unmatched')
              }
            >
              <option value="all">All match states</option>
              <option value="matched">Matched</option>
              <option value="unmatched">Unmatched</option>
            </select>
            <label className="admin-check">
              <input
                type="checkbox"
                checked={props.showHidden}
                onChange={(e) => props.onShowHidden(e.target.checked)}
              />
              Show hidden
            </label>
          </>
        ) : (
          <div className="admin-toolbar-actions">
            <button
              className="btn btn-ghost btn-sm"
              type="button"
              disabled={props.selected.size === 0 || props.busyId === -1}
              onClick={props.onBulkHideSelected}
            >
              Hide selected ({props.selected.size})
            </button>
            <button
              className="btn btn-ghost btn-sm"
              type="button"
              disabled={props.busyId === -1 || titles.length === 0}
              onClick={props.onBulkHideAllUnmatched}
            >
              Hide all unmatched
            </button>
          </div>
        )}
        <span className="muted admin-count">
          {loading ? 'Loading…' : `${titles.length} titles`}
        </span>
      </div>

      {error ? (
        <div className="empty-state admin-empty">
          <h2>Couldn’t load titles</h2>
          <p>{error}</p>
          <button className="btn btn-primary" type="button" onClick={props.onRetry}>
            Retry
          </button>
        </div>
      ) : loading ? (
        <AdminSkeleton rows={8} />
      ) : titles.length === 0 ? (
        <div className="empty-state admin-empty">
          <h2>{section === 'unmatched' ? 'No unmatched titles' : 'No titles found'}</h2>
          <p>
            {section === 'unmatched'
              ? 'Everything has a TMDB id, or the library hasn’t been scanned yet.'
              : 'Try a different search, or run a library scan from Tools.'}
          </p>
        </div>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                {section === 'unmatched' ? (
                  <th className="col-check">
                    <input
                      type="checkbox"
                      aria-label="Select all"
                      checked={props.selected.size > 0 && props.selected.size === titles.length}
                      onChange={(e) => {
                        props.onSelected(
                          e.target.checked ? new Set(titles.map((t) => t.id)) : new Set(),
                        )
                      }}
                    />
                  </th>
                ) : null}
                <th className="col-poster" />
                <th>Title</th>
                <th>Kind</th>
                <th>Year</th>
                <th>Files</th>
                <th>TMDB</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {titles.map((t) => {
                const detailPath = t.kind === 'movie' ? `/movie/${t.id}` : `/tv/${t.id}`
                const isEditing = props.editId === t.id
                const isRematching = props.rematchId === t.id
                return (
                  <tr
                    key={t.id}
                    className={[t.unmatched ? 'is-unmatched' : '', t.hidden ? 'is-hidden' : '']
                      .filter(Boolean)
                      .join(' ')}
                  >
                    {section === 'unmatched' ? (
                      <td className="col-check">
                        <input
                          type="checkbox"
                          checked={props.selected.has(t.id)}
                          onChange={(e) => {
                            props.onSelected((prev) => {
                              const next = new Set(prev)
                              if (e.target.checked) next.add(t.id)
                              else next.delete(t.id)
                              return next
                            })
                          }}
                        />
                      </td>
                    ) : null}
                    <td className="col-poster">
                      <button
                        type="button"
                        className="admin-thumb-btn"
                        onClick={() => props.onOpenDrawer(t.id)}
                        title="Details"
                      >
                        <div className="admin-thumb">
                          {t.poster ? (
                            <img src={t.poster} alt="" loading="lazy" />
                          ) : (
                            <span>?</span>
                          )}
                        </div>
                      </button>
                    </td>
                    <td>
                      <div className="admin-title-cell">
                        <button
                          type="button"
                          className="linkish admin-title-link"
                          onClick={() => props.onOpenDrawer(t.id)}
                        >
                          <strong>{t.title}</strong>
                        </button>
                        {section === 'unmatched' && t.files?.length ? (
                          <span className="muted" style={{ fontSize: '0.8rem' }}>
                            {t.files
                              .slice(0, 3)
                              .map((f) => f.filename)
                              .join(' · ')}
                            {t.files.length > 3 ? ` · +${t.files.length - 3} more` : ''}
                          </span>
                        ) : null}
                        <div className="admin-badges">
                          {t.unmatched ? <span className="badge warn">Unmatched</span> : null}
                          {t.hidden ? <span className="badge muted-badge">Hidden</span> : null}
                        </div>
                      </div>
                      {isEditing ? (
                        <div className="admin-inline-form">
                          <input
                            className="admin-input"
                            value={props.editTitle}
                            onChange={(e) => props.onEditTitle(e.target.value)}
                            placeholder="Title"
                          />
                          <input
                            className="admin-input admin-input-year"
                            value={props.editYear}
                            onChange={(e) => props.onEditYear(e.target.value)}
                            placeholder="Year"
                            inputMode="numeric"
                          />
                          <button
                            className="btn btn-primary btn-sm"
                            type="button"
                            disabled={props.busyId === t.id}
                            onClick={props.onSaveEdit}
                          >
                            Save
                          </button>
                          <button
                            className="btn btn-ghost btn-sm"
                            type="button"
                            onClick={props.onCancelEdit}
                          >
                            Cancel
                          </button>
                        </div>
                      ) : null}
                      {isRematching ? (
                        <RematchPanel
                          query={props.rematchQuery}
                          kind={props.rematchKind}
                          results={props.rematchResults}
                          searching={props.rematchSearching}
                          error={props.rematchError}
                          busy={props.busyId === t.id}
                          onQuery={props.onRematchQuery}
                          onKind={props.onRematchKind}
                          onSearch={props.onRematchSearch}
                          onApply={props.onRematchApply}
                          onAuto={props.onRematchAuto}
                          onCancel={props.onRematchCancel}
                        />
                      ) : null}
                    </td>
                    <td>
                      <span className="kind-pill">{t.kind}</span>
                    </td>
                    <td>{t.year ?? '—'}</td>
                    <td>
                      <button
                        className="linkish"
                        type="button"
                        onClick={() => props.onOpenDrawer(t.id)}
                      >
                        {t.fileCount}
                      </button>
                    </td>
                    <td>
                      <code className={t.unmatched ? 'error-text' : ''}>
                        {t.unmatched ? '—' : t.tmdbId}
                      </code>
                    </td>
                    <td>
                      <div className="admin-actions">
                        <button
                          className="btn btn-ghost btn-sm"
                          type="button"
                          onClick={() => props.onOpenEdit(t)}
                        >
                          Edit
                        </button>
                        <button
                          className="btn btn-ghost btn-sm"
                          type="button"
                          onClick={() => props.onOpenRematch(t)}
                        >
                          Rematch
                        </button>
                        <button
                          className="btn btn-ghost btn-sm"
                          type="button"
                          disabled={props.busyId === t.id}
                          onClick={() => props.onToggleHide(t)}
                        >
                          {t.hidden ? 'Unhide' : 'Hide'}
                        </button>
                        {!t.hidden ? (
                          <Link className="btn btn-ghost btn-sm" to={detailPath}>
                            Open
                          </Link>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
