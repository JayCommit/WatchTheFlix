import { Link } from 'react-router-dom'
import type { ConvertNeedsFile } from '../../types'
import { copyText } from '../../utils/clipboard'
import { formatBytes } from '../../utils/format'
import { modeBadge } from './badges'
import { plannedAction } from './utils'

type Props = {
  needs: ConvertNeedsFile[]
  selected: Set<string>
  remuxCount: number
  transcodeCount: number
  enqueueing: boolean
  localMediaEnabled: boolean
  notify: (msg: string) => void
  onToggle: (path: string) => void
  onSelectBy: (kind: 'all' | 'remux' | 'transcode' | 'none') => void
  onEnqueueSelected: () => void
  onEnqueueOne: (path: string) => void
}

export function ConvertNeedsTable({
  needs,
  selected,
  remuxCount,
  transcodeCount,
  enqueueing,
  localMediaEnabled,
  notify,
  onToggle,
  onSelectBy,
  onEnqueueSelected,
  onEnqueueOne,
}: Props) {
  return (
    <section className="admin-card">
      <div className="section-head">
        <h2>Needs conversion</h2>
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
      {needs.length === 0 ? (
        <p className="muted">
          No incompatible files listed. Run <strong>Scan codecs</strong> above to detect which
          titles need remux or transcode.
        </p>
      ) : (
        <>
          <div className="convert-select-bar">
            <span className="muted">
              {needs.length} file{needs.length === 1 ? '' : 's'}
              {remuxCount ? ` · ${remuxCount} remux` : ''}
              {transcodeCount ? ` · ${transcodeCount} transcode` : ''}
            </span>
            <div className="admin-actions">
              <button className="btn btn-ghost btn-sm" type="button" onClick={() => onSelectBy('all')}>
                Select all
              </button>
              {remuxCount > 0 ? (
                <button
                  className="btn btn-ghost btn-sm"
                  type="button"
                  onClick={() => onSelectBy('remux')}
                  title="Only files that can stream-copy (H.264 remux)"
                >
                  Select remux
                </button>
              ) : null}
              {transcodeCount > 0 ? (
                <button
                  className="btn btn-ghost btn-sm"
                  type="button"
                  onClick={() => onSelectBy('transcode')}
                  title="Only files that need a full re-encode"
                >
                  Select transcode
                </button>
              ) : null}
              {selected.size > 0 ? (
                <button className="btn btn-ghost btn-sm" type="button" onClick={() => onSelectBy('none')}>
                  Clear
                </button>
              ) : null}
            </div>
          </div>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th />
                  <th>Title</th>
                  <th>File</th>
                  <th>Codecs</th>
                  <th>Best action</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {needs.map((f) => {
                  const plan = plannedAction(f)
                  return (
                    <tr key={f.path}>
                      <td>
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
                        <div className="muted">{f.kind}</div>
                      </td>
                      <td>
                        <div className="convert-path-row">
                          <span>{f.filename}</span>
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
                        <code>
                          {f.container || '?'} · {f.videoCodec || '?'} / {f.audioCodec || '?'}
                        </code>
                        {f.probeError ? (
                          <div
                            className="error-text"
                            style={{ fontSize: '0.78rem', marginTop: '0.25rem' }}
                          >
                            {f.probeError}
                          </div>
                        ) : null}
                      </td>
                      <td>
                        {modeBadge(
                          plan === 'unknown' ? f.playbackMode : plan,
                          f.canDirect,
                          f.probeError,
                        )}
                        <div className="muted" style={{ fontSize: '0.75rem', marginTop: '0.2rem' }}>
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
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}
