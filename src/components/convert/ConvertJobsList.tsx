import type { ConvertJob } from '../../types'
import { copyText } from '../../utils/clipboard'
import { modeBadge, statusBadge } from './badges'
import { formatProgress } from './utils'

type Props = {
  jobs: ConvertJob[]
  enqueueing: boolean
  localMediaEnabled: boolean
  notify: (msg: string) => void
  onRefresh: () => void
  onCancelJob: (id: number) => void
  onRetry: (path: string) => void
}

export function ConvertJobsList({
  jobs,
  enqueueing,
  localMediaEnabled,
  notify,
  onRefresh,
  onCancelJob,
  onRetry,
}: Props) {
  return (
    <section className="admin-card">
      <div className="section-head">
        <h2>Active & recent jobs</h2>
        <button className="btn btn-ghost" type="button" onClick={() => void onRefresh()}>
          Refresh
        </button>
      </div>
      {jobs.length === 0 ? (
        <p className="muted">No convert jobs yet. Scan codecs, then queue files below.</p>
      ) : (
        <ul className="admin-job-list">
          {jobs.slice(0, 40).map((job) => {
            const active =
              job.status === 'running' || job.status === 'queued' || job.status === 'cancelling'
            const pct = Math.min(100, Math.max(0, job.progress || 0))
            return (
              <li key={job.id}>
                <div className="admin-job-main">
                  <div className="admin-job-title-row">
                    <strong>
                      #{job.id} · {job.titleName || 'Untitled'}
                    </strong>
                    <span className="admin-job-badges">
                      {statusBadge(job.status)}
                      {modeBadge(
                        job.mode === 'auto' ? null : job.mode,
                        job.mode === 'direct',
                        null,
                      )}
                    </span>
                  </div>
                  <span className="muted">
                    {job.videoCodec || '?'}
                    {job.audioCodec ? ` / ${job.audioCodec}` : ''}
                    {job.container ? ` · ${job.container}` : ''}
                  </span>
                  <div className="convert-path-row">
                    <span className="muted convert-path-line">{job.path}</span>
                    <button
                      className="btn btn-ghost btn-sm"
                      type="button"
                      title="Copy path"
                      onClick={() => {
                        void copyText(job.path).then((ok) =>
                          notify(ok ? 'Path copied' : 'Could not copy path'),
                        )
                      }}
                    >
                      Copy path
                    </button>
                  </div>
                  {active ? (
                    <div className="convert-progress-block compact">
                      <div className="convert-progress-head">
                        <span className="muted">
                          {job.status === 'queued'
                            ? 'Waiting in queue…'
                            : job.mode === 'remux'
                              ? 'Remuxing…'
                              : job.mode === 'transcode'
                                ? 'Transcoding…'
                                : 'Converting…'}
                        </span>
                        <strong className="convert-progress-pct">{formatProgress(pct)}</strong>
                      </div>
                      <div
                        className={`admin-progress-bar${job.status === 'queued' ? ' indeterminate' : ''}`}
                        aria-valuenow={pct}
                        aria-valuemin={0}
                        aria-valuemax={100}
                      >
                        <i style={{ width: `${job.status === 'queued' ? 100 : pct}%` }} />
                      </div>
                    </div>
                  ) : null}
                  {job.error ? (
                    <span className={job.status === 'failed' ? 'error-text' : 'muted'}>
                      {job.error}
                    </span>
                  ) : null}
                  {job.outputPath ? (
                    <span className="ok-text" style={{ fontSize: '0.85rem' }}>
                      → {job.outputPath}
                    </span>
                  ) : null}
                </div>
                {(job.status === 'queued' ||
                  job.status === 'running' ||
                  job.status === 'cancelling') && (
                  <button
                    className="btn btn-ghost btn-sm"
                    type="button"
                    onClick={() => void onCancelJob(job.id)}
                  >
                    Cancel
                  </button>
                )}
                {job.status === 'failed' ? (
                  <button
                    className="btn btn-ghost btn-sm"
                    type="button"
                    disabled={enqueueing || !localMediaEnabled}
                    title={!localMediaEnabled ? 'Set LOCAL_MEDIA_ROOT first' : 'Retry convert'}
                    onClick={() => void onRetry(job.path)}
                  >
                    Retry
                  </button>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
