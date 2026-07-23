import { useMemo, useState } from 'react'
import type { ConvertJob } from '../../types'
import { copyText } from '../../utils/clipboard'
import { modeBadge, statusBadge } from './badges'
import { formatProgress, jobFilename, jobRelativeTime, jobSortKey } from './utils'

type Props = {
  jobs: ConvertJob[]
  enqueueing: boolean
  localMediaEnabled: boolean
  notify: (msg: string) => void
  onRefresh: () => void
  onCancelJob: (id: number) => void
  onRetry: (path: string) => void
}

const FAILED_PREVIEW = 5
const RECENT_PREVIEW = 8

function isActive(status: string) {
  return status === 'running' || status === 'queued' || status === 'cancelling'
}

function statusVerb(job: ConvertJob): string {
  if (job.status === 'queued') return 'Waiting'
  if (job.status === 'cancelling') return 'Cancelling'
  if (job.mode === 'remux') return 'Remuxing'
  if (job.mode === 'transcode') return 'Transcoding'
  return 'Converting'
}

function JobRow({
  job,
  compact,
  enqueueing,
  localMediaEnabled,
  notify,
  onCancelJob,
  onRetry,
}: {
  job: ConvertJob
  compact?: boolean
  enqueueing: boolean
  localMediaEnabled: boolean
  notify: (msg: string) => void
  onCancelJob: (id: number) => void
  onRetry: (path: string) => void
}) {
  const active = isActive(job.status)
  const pct = Math.min(100, Math.max(0, job.progress || 0))
  const filename = jobFilename(job.path)
  const showError = Boolean(job.error) && (job.status === 'failed' || job.status === 'skipped')

  return (
    <li className={`convert-job-row${active ? ' is-active' : ''}${compact ? ' is-compact' : ''}`}>
      <div className="convert-job-body">
        <div className="convert-job-top">
          <div className="convert-job-identity">
            <strong className="convert-job-title" title={job.path}>
              {job.titleName || filename || `Job #${job.id}`}
            </strong>
            <span className="convert-job-file muted" title={job.path}>
              {filename}
            </span>
          </div>
          <div className="convert-job-meta">
            <span className="admin-job-badges">
              {statusBadge(job.status)}
              {modeBadge(job.mode === 'auto' ? null : job.mode, job.mode === 'direct', null)}
            </span>
            {active ? (
              <strong className="convert-progress-pct">{formatProgress(pct)}</strong>
            ) : (
              <span className="muted convert-job-time">{jobRelativeTime(job)}</span>
            )}
          </div>
        </div>

        {active ? (
          <div className="convert-job-progress">
            <span className="muted convert-job-verb">{statusVerb(job)}</span>
            <div
              className={`admin-progress-bar slim${job.status === 'queued' ? ' indeterminate' : ''}`}
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <i style={{ width: `${job.status === 'queued' ? 100 : pct}%` }} />
            </div>
          </div>
        ) : null}

        {showError ? (
          <p
            className={`convert-job-error${job.status === 'failed' ? ' is-fail' : ''}`}
            title={job.error || ''}
          >
            {job.error}
          </p>
        ) : null}

        {!compact && (job.videoCodec || job.container) ? (
          <span className="muted convert-job-codecs">
            {[job.videoCodec, job.audioCodec].filter(Boolean).join(' / ') || '—'}
            {job.container ? ` · ${job.container}` : ''}
          </span>
        ) : null}
      </div>

      <div className="convert-job-actions">
        <button
          className="btn btn-ghost btn-sm"
          type="button"
          title="Copy path"
          onClick={() => {
            void copyText(job.path).then((ok) => notify(ok ? 'Path copied' : 'Could not copy path'))
          }}
        >
          Copy
        </button>
        {active ? (
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => void onCancelJob(job.id)}>
            Cancel
          </button>
        ) : null}
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
      </div>
    </li>
  )
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
  const [showAllFailed, setShowAllFailed] = useState(false)
  const [showAllRecent, setShowAllRecent] = useState(false)

  const { active, recent, failed } = useMemo(() => {
    const sorted = [...jobs].sort((a, b) => {
      const d = jobSortKey(a) - jobSortKey(b)
      if (d !== 0) return d
      return (b.createdAt || '').localeCompare(a.createdAt || '')
    })
    return {
      active: sorted.filter((j) => isActive(j.status)),
      failed: sorted.filter((j) => j.status === 'failed'),
      recent: sorted.filter((j) => !isActive(j.status) && j.status !== 'failed'),
    }
  }, [jobs])

  const visibleFailed = showAllFailed ? failed : failed.slice(0, FAILED_PREVIEW)
  const hiddenFailed = Math.max(0, failed.length - visibleFailed.length)
  const visibleRecent = showAllRecent ? recent : recent.slice(0, RECENT_PREVIEW)
  const hiddenRecent = Math.max(0, recent.length - visibleRecent.length)
  const empty = jobs.length === 0

  return (
    <section className="admin-card convert-jobs-card" id="convert-jobs">
      <div className="section-head">
        <div className="convert-jobs-heading">
          <h2>Jobs</h2>
          {!empty ? (
            <span className="muted convert-jobs-summary">
              {active.length ? `${active.length} active` : 'Idle'}
              {failed.length ? ` · ${failed.length} failed` : ''}
              {recent.length ? ` · ${recent.length} recent` : ''}
            </span>
          ) : null}
        </div>
        <button className="btn btn-ghost btn-sm" type="button" onClick={() => void onRefresh()}>
          Refresh
        </button>
      </div>

      {empty ? (
        <p className="muted">No convert jobs yet. Scan codecs, then queue files below.</p>
      ) : (
        <div className="convert-jobs-groups">
          {active.length ? (
            <div className="convert-jobs-group">
              <h3 className="convert-jobs-group-label">Active</h3>
              <ul className="convert-job-list convert-job-list-scroll">
                {active.map((job) => (
                  <JobRow
                    key={job.id}
                    job={job}
                    enqueueing={enqueueing}
                    localMediaEnabled={localMediaEnabled}
                    notify={notify}
                    onCancelJob={onCancelJob}
                    onRetry={onRetry}
                  />
                ))}
              </ul>
            </div>
          ) : null}

          {failed.length ? (
            <div className="convert-jobs-group">
              <h3 className="convert-jobs-group-label">Failed</h3>
              <ul className="convert-job-list convert-job-list-scroll">
                {visibleFailed.map((job) => (
                  <JobRow
                    key={job.id}
                    job={job}
                    enqueueing={enqueueing}
                    localMediaEnabled={localMediaEnabled}
                    notify={notify}
                    onCancelJob={onCancelJob}
                    onRetry={onRetry}
                  />
                ))}
              </ul>
              {hiddenFailed > 0 || showAllFailed ? (
                <button
                  className="btn btn-ghost btn-sm convert-jobs-more"
                  type="button"
                  onClick={() => setShowAllFailed((v) => !v)}
                >
                  {showAllFailed ? 'Show less' : `Show ${hiddenFailed} more failed`}
                </button>
              ) : null}
            </div>
          ) : null}

          {recent.length ? (
            <div className="convert-jobs-group">
              <h3 className="convert-jobs-group-label">Recent</h3>
              <ul className="convert-job-list convert-job-list-scroll is-compact-list">
                {visibleRecent.map((job) => (
                  <JobRow
                    key={job.id}
                    job={job}
                    compact
                    enqueueing={enqueueing}
                    localMediaEnabled={localMediaEnabled}
                    notify={notify}
                    onCancelJob={onCancelJob}
                    onRetry={onRetry}
                  />
                ))}
              </ul>
              {hiddenRecent > 0 || showAllRecent ? (
                <button
                  className="btn btn-ghost btn-sm convert-jobs-more"
                  type="button"
                  onClick={() => setShowAllRecent((v) => !v)}
                >
                  {showAllRecent ? 'Show less' : `Show ${hiddenRecent} more`}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </section>
  )
}
