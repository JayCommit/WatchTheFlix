import type { CodecProbeStatus, ConvertJob } from '../../types'
import { formatProgress, jobFilename } from './utils'

type Props = {
  probing: boolean
  probeStatus: CodecProbeStatus | null
  probePct: number
  activeJobs: ConvertJob[]
  queued: number
  running: number
  onCancelProbe: () => void
  onCancelJob: (id: number) => void
  onJumpToJobs: () => void
}

export function ConvertLiveDock({
  probing,
  probeStatus,
  probePct,
  activeJobs,
  queued,
  running,
  onCancelProbe,
  onCancelJob,
  onJumpToJobs,
}: Props) {
  const runningJob = activeJobs.find((j) => j.status === 'running') || activeJobs[0] || null
  const showProbe = probing || probeStatus?.phase === 'running'
  const showJobs = queued > 0 || running > 0 || Boolean(runningJob)
  if (!showProbe && !showJobs) return null

  const jobPct = Math.min(100, Math.max(0, runningJob?.progress || 0))
  const jobLabel =
    runningJob?.titleName || (runningJob ? jobFilename(runningJob.path) : null) || 'Convert queue'

  return (
    <div className="convert-live-dock" role="status" aria-live="polite">
      <div className="convert-live-dock-inner">
        {showProbe ? (
          <div className="convert-live-item">
            <div className="convert-live-head">
              <span className="convert-live-label">Codec scan</span>
              <strong className="convert-progress-pct">{formatProgress(probePct)}</strong>
            </div>
            <div
              className="admin-progress-bar slim"
              aria-valuenow={probePct}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <i style={{ width: `${probePct}%` }} />
            </div>
            <div className="convert-live-meta">
              <span className="muted convert-live-detail" title={probeStatus?.currentPath || ''}>
                {probeStatus?.total
                  ? `${probeStatus.processed}/${probeStatus.total}`
                  : probeStatus?.message || 'Scanning…'}
                {probeStatus?.currentPath
                  ? ` · ${jobFilename(probeStatus.currentPath)}`
                  : ''}
              </span>
              <button className="btn btn-ghost btn-sm" type="button" onClick={() => void onCancelProbe()}>
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        {showJobs ? (
          <div className="convert-live-item">
            <div className="convert-live-head">
              <span className="convert-live-label">
                {running ? 'Converting' : 'Queued'}
                {queued || running ? (
                  <span className="muted">
                    {' '}
                    · {running} run · {queued} wait
                  </span>
                ) : null}
              </span>
              <strong className="convert-progress-pct">
                {runningJob && runningJob.status === 'running' ? formatProgress(jobPct) : '—'}
              </strong>
            </div>
            <div
              className={`admin-progress-bar slim${
                runningJob && runningJob.status !== 'running' ? ' indeterminate' : ''
              }`}
              aria-valuenow={jobPct}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <i
                style={{
                  width: `${runningJob && runningJob.status === 'running' ? jobPct : 100}%`,
                }}
              />
            </div>
            <div className="convert-live-meta">
              <button
                className="muted convert-live-detail convert-live-link"
                type="button"
                title={runningJob?.path || 'Open jobs'}
                onClick={onJumpToJobs}
              >
                {jobLabel}
              </button>
              {runningJob &&
              (runningJob.status === 'running' ||
                runningJob.status === 'queued' ||
                runningJob.status === 'cancelling') ? (
                <button
                  className="btn btn-ghost btn-sm"
                  type="button"
                  onClick={() => void onCancelJob(runningJob.id)}
                >
                  Cancel
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
