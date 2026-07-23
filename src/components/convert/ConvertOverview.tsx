import type { CodecProbeCoverage, CodecProbeStatus } from '../../types'
import { formatProgress } from './utils'

type Props = {
  localMediaEnabled: boolean
  probing: boolean
  probeStatus: CodecProbeStatus | null
  coverage: CodecProbeCoverage | null
  probePct: number
  stats: { queued: number; running: number; done: number; failed: number }
  needsTotal: number
  onStartProbe: (force: boolean) => void
  onCancelProbe: () => void
}

export function ConvertOverview({
  localMediaEnabled,
  probing,
  probeStatus,
  coverage,
  probePct,
  stats,
  needsTotal,
  onStartProbe,
  onCancelProbe,
}: Props) {
  const showProbeDetail =
    probeStatus && (probeStatus.phase === 'running' || probeStatus.processed > 0)

  return (
    <section className="admin-card convert-overview">
      <div className="section-head">
        <div className="convert-overview-heading">
          <h2>Convert</h2>
          <p className="muted convert-overview-lede">
            Scan codecs, queue remux/transcode jobs, and keep incompatible files moving without
            drowning the page.
          </p>
        </div>
        <div className="admin-actions">
          {probing ? (
            <button className="btn btn-ghost" type="button" onClick={() => void onCancelProbe()}>
              Cancel scan
            </button>
          ) : null}
          <button
            className="btn btn-ghost"
            type="button"
            disabled={probing}
            onClick={() => void onStartProbe(true)}
            title="Re-probe every file, even ones already scanned"
          >
            Rescan all
          </button>
          <button
            className="btn btn-primary"
            type="button"
            disabled={probing}
            onClick={() => void onStartProbe(false)}
          >
            {probing ? 'Scanning…' : 'Scan codecs'}
          </button>
        </div>
      </div>

      {!localMediaEnabled ? (
        <div className="admin-banner warn convert-inline-banner">
          <strong>Local media not detected.</strong> Set <code>LOCAL_MEDIA_ROOT</code> so convert
          jobs can read/write on disk. Playback over WebDAV still works.
        </div>
      ) : null}

      <div className="convert-overview-stats">
        <div className={`convert-stat${stats.running ? ' is-hot' : ''}`}>
          <span className="convert-stat-label">Running</span>
          <strong>{stats.running}</strong>
        </div>
        <div className={`convert-stat${stats.queued ? ' is-hot' : ''}`}>
          <span className="convert-stat-label">Queued</span>
          <strong>{stats.queued}</strong>
        </div>
        <div className="convert-stat">
          <span className="convert-stat-label">Done</span>
          <strong>{stats.done}</strong>
        </div>
        <div className={`convert-stat${stats.failed ? ' is-warn' : ''}`}>
          <span className="convert-stat-label">Failed</span>
          <strong>{stats.failed}</strong>
        </div>
        <div className={`convert-stat${needsTotal ? ' is-warn' : ''}`}>
          <span className="convert-stat-label">Needs convert</span>
          <strong>{needsTotal}</strong>
        </div>
        {coverage ? (
          <>
            <div className="convert-stat">
              <span className="convert-stat-label">Probed</span>
              <strong>
                {coverage.probed}
                <span className="muted convert-stat-sub">/{coverage.total}</span>
              </strong>
            </div>
            <div className="convert-stat">
              <span className="convert-stat-label">Direct play</span>
              <strong>{coverage.direct}</strong>
            </div>
            <div className={`convert-stat${coverage.unprobed ? ' is-muted-hot' : ''}`}>
              <span className="convert-stat-label">Unprobed</span>
              <strong>{coverage.unprobed}</strong>
            </div>
          </>
        ) : null}
      </div>

      {showProbeDetail ? (
        <div className="convert-progress-block compact">
          <div className="convert-progress-head">
            <span className="muted">
              {probeStatus.phase === 'running' ? 'Scanning codecs' : 'Last codec scan'}
            </span>
            <strong className="convert-progress-pct">{formatProgress(probePct)}</strong>
          </div>
          <div
            className="admin-progress-bar"
            aria-valuenow={probePct}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <i style={{ width: `${probePct}%` }} />
          </div>
          <p className={probeStatus.phase === 'error' ? 'error-text convert-probe-msg' : 'muted convert-probe-msg'}>
            {probeStatus.message}
            {probeStatus.phase === 'running' && probeStatus.total
              ? ` · ${probeStatus.processed}/${probeStatus.total}`
              : ''}
            {probeStatus.phase !== 'idle'
              ? ` · Direct ${probeStatus.direct} · Remux ${probeStatus.remux} · Transcode ${probeStatus.transcode}`
              : ''}
          </p>
        </div>
      ) : (
        <p className="muted convert-overview-hint">
          Auto mode remuxes H.264 (fast stream-copy) and only transcodes when the video codec needs
          it. Start with a codec scan before queuing.
        </p>
      )}
    </section>
  )
}
