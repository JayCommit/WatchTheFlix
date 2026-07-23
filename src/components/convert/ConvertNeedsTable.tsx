import { Link } from 'react-router-dom'
import type { ConvertNeedsFile } from '../../types'
import { copyText } from '../../utils/clipboard'
import { formatBytes } from '../../utils/format'
import { modeBadge } from './badges'
import { plannedAction } from './utils'

export type NeedsActionFilter = 'all' | 'remux' | 'transcode' | 'unknown'
export type NeedsKindFilter = '' | 'movie' | 'tv'

type Props = {
  needs: ConvertNeedsFile[]
  total: number
  page: number
  pageSize: number
  query: string
  action: NeedsActionFilter
  kind: NeedsKindFilter
  remuxCount: number
  transcodeCount: number
  unknownCount: number
  selected: Set<string>
  enqueueing: boolean
  localMediaEnabled: boolean
  notify: (msg: string) => void
  onQueryChange: (q: string) => void
  onActionChange: (action: NeedsActionFilter) => void
  onKindChange: (kind: NeedsKindFilter) => void
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
  onToggle: (path: string) => void
  onSelectPage: () => void
  onClearSelection: () => void
  onEnqueueSelected: () => void
  onEnqueueOne: (path: string) => void
}

export function ConvertNeedsTable({
  needs,
  total,
  page,
  pageSize,
  query,
  action,
  kind,
  remuxCount,
  transcodeCount,
  unknownCount,
  selected,
  enqueueing,
  localMediaEnabled,
  notify,
  onQueryChange,
  onActionChange,
  onKindChange,
  onPageChange,
  onPageSizeChange,
  onToggle,
  onSelectPage,
  onClearSelection,
  onEnqueueSelected,
  onEnqueueOne,
}: Props) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const safePage = Math.min(page, pageCount - 1)
  const from = total === 0 ? 0 : safePage * pageSize + 1
  const to = Math.min(total, (safePage + 1) * pageSize)
  const pageSelected = needs.length > 0 && needs.every((f) => selected.has(f.path))

  return (
    <section className="admin-card convert-needs-card" id="convert-needs">
      <div className="section-head">
        <div className="convert-jobs-heading">
          <h2>Needs conversion</h2>
          <span className="muted convert-jobs-summary">
            {total} file{total === 1 ? '' : 's'}
            {remuxCount ? ` · ${remuxCount} remux` : ''}
            {transcodeCount ? ` · ${transcodeCount} transcode` : ''}
            {unknownCount ? ` · ${unknownCount} unknown` : ''}
          </span>
        </div>
        <div className="admin-actions">
          <button
            className="btn btn-primary"
            type="button"
            disabled={!selected.size || !localMediaEnabled || enqueueing}
            onClick={() => void onEnqueueSelected()}
            title={!localMediaEnabled ? 'Set LOCAL_MEDIA_ROOT first' : undefined}
          >
            {enqueueing ? 'Queuing…' : `Queue selected (${selected.size})`}
          </button>
        </div>
      </div>

      {total === 0 && !query && action === 'all' && !kind ? (
        <p className="muted">
          No incompatible files listed. Run <strong>Scan codecs</strong> above to detect which titles
          need remux or transcode.
        </p>
      ) : (
        <>
          <div className="convert-needs-toolbar">
            <input
              className="admin-input"
              type="search"
              placeholder="Search title or filename…"
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              aria-label="Search files needing conversion"
            />
            <select
              className="admin-select"
              value={kind}
              onChange={(e) => onKindChange(e.target.value as NeedsKindFilter)}
              aria-label="Filter by kind"
            >
              <option value="">All kinds</option>
              <option value="movie">Movies</option>
              <option value="tv">TV</option>
            </select>
            <select
              className="admin-select"
              value={action}
              onChange={(e) => onActionChange(e.target.value as NeedsActionFilter)}
              aria-label="Filter by action"
            >
              <option value="all">All actions</option>
              <option value="remux">Remux only</option>
              <option value="transcode">Transcode only</option>
              <option value="unknown">Unknown / probe needed</option>
            </select>
            <select
              className="admin-select"
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value) || 25)}
              aria-label="Page size"
            >
              <option value={25}>25 / page</option>
              <option value={50}>50 / page</option>
              <option value={100}>100 / page</option>
            </select>
          </div>

          <div className="convert-select-bar">
            <span className="muted">
              {total ? `Showing ${from}–${to} of ${total}` : 'No matches'}
              {selected.size ? ` · ${selected.size} selected` : ''}
            </span>
            <div className="admin-actions">
              <button
                className="btn btn-ghost btn-sm"
                type="button"
                disabled={!needs.length}
                onClick={onSelectPage}
              >
                {pageSelected ? 'Reselect page' : 'Select page'}
              </button>
              {selected.size > 0 ? (
                <button className="btn btn-ghost btn-sm" type="button" onClick={onClearSelection}>
                  Clear selection
                </button>
              ) : null}
            </div>
          </div>

          <div className="admin-table-wrap convert-needs-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th className="convert-check-col" />
                  <th>Title</th>
                  <th>File</th>
                  <th>Codecs</th>
                  <th>Best action</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {needs.length === 0 ? (
                  <tr>
                    <td colSpan={6}>
                      <p className="muted convert-needs-empty">No files match this filter.</p>
                    </td>
                  </tr>
                ) : (
                  needs.map((f) => {
                    const plan = plannedAction(f)
                    return (
                      <tr key={f.path}>
                        <td className="convert-check-col">
                          <input
                            type="checkbox"
                            checked={selected.has(f.path)}
                            onChange={() => onToggle(f.path)}
                            aria-label={`Select ${f.title}`}
                          />
                        </td>
                        <td>
                          <Link
                            className="convert-title-link"
                            to={f.kind === 'tv' ? `/tv/${f.titleId}` : `/movie/${f.titleId}`}
                          >
                            <strong>{f.title}</strong>
                          </Link>
                          <div className="muted">
                            {f.kind}
                            {f.kind === 'tv' && f.season != null && f.episode != null
                              ? ` · S${f.season}E${f.episode}`
                              : ''}
                          </div>
                        </td>
                        <td>
                          <div className="convert-path-row">
                            <span className="convert-filename" title={f.path}>
                              {f.filename}
                            </span>
                            <button
                              className="btn btn-ghost btn-sm"
                              type="button"
                              title="Copy path"
                              onClick={() => {
                                void copyText(f.path).then((ok) =>
                                  notify(ok ? 'Path copied' : 'Could not copy path'),
                                )
                              }}
                            >
                              Copy
                            </button>
                          </div>
                          <div className="muted">{formatBytes(f.size)}</div>
                        </td>
                        <td>
                          <code className="convert-codec-code">
                            {f.container || '?'} · {f.videoCodec || '?'} / {f.audioCodec || '?'}
                          </code>
                          {f.probeError ? (
                            <div className="error-text convert-probe-error">{f.probeError}</div>
                          ) : null}
                        </td>
                        <td>
                          {modeBadge(
                            plan === 'unknown' ? f.playbackMode : plan,
                            f.canDirect,
                            f.probeError,
                          )}
                          <div className="muted convert-action-hint">
                            {plan === 'remux'
                              ? 'Fast stream-copy'
                              : plan === 'transcode'
                                ? 'Full re-encode'
                                : 'Probe needed'}
                          </div>
                        </td>
                        <td>
                          <button
                            className="btn btn-ghost btn-sm"
                            type="button"
                            disabled={!localMediaEnabled || enqueueing}
                            onClick={() => void onEnqueueOne(f.path)}
                          >
                            Convert
                          </button>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="convert-pager">
            <button
              className="btn btn-ghost btn-sm"
              type="button"
              disabled={safePage <= 0}
              onClick={() => onPageChange(safePage - 1)}
            >
              Previous
            </button>
            <span className="muted convert-pager-status">
              Page {total ? safePage + 1 : 0} of {total ? pageCount : 0}
            </span>
            <button
              className="btn btn-ghost btn-sm"
              type="button"
              disabled={safePage >= pageCount - 1 || total === 0}
              onClick={() => onPageChange(safePage + 1)}
            >
              Next
            </button>
          </div>

          {selected.size > 0 ? (
            <div className="convert-selection-dock">
              <span>
                <strong>{selected.size}</strong> selected
              </span>
              <div className="admin-actions">
                <button className="btn btn-ghost btn-sm" type="button" onClick={onClearSelection}>
                  Clear
                </button>
                <button
                  className="btn btn-primary btn-sm"
                  type="button"
                  disabled={!localMediaEnabled || enqueueing}
                  onClick={() => void onEnqueueSelected()}
                >
                  {enqueueing ? 'Queuing…' : 'Queue selected'}
                </button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </section>
  )
}
