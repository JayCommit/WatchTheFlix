import type { CodecProbeCoverage, CodecProbeStatus } from '../../types'
import { formatProgress } from './utils'

type Props = {
  probing: boolean
  probeStatus: CodecProbeStatus | null
  coverage: CodecProbeCoverage | null
  probePct: number
  onStartProbe: (force: boolean) => void
  onCancelProbe: () => void
}

export function ConvertProbePanel({
  probing,
  probeStatus,
  coverage,
  probePct,
  onStartProbe,
  onCancelProbe,
}: Props) {
  return (
    <section className="admin-card">
      <div className="section-head">
        <h2>Detect file types</h2>
        <div className="admin-actions">
          {probing ? (
            <button className="btn btn-ghost" type="button" onClick={() => void onCancelProbe()}>
              Cancel
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
            {probing ? 'Scanning codecs…' : 'Scan codecs'}
          </button>
        </div>
      </div>
      <p className="muted">
        Probe each library file for container / codecs, then mark{' '}
        <strong>direct play</strong>, <strong>remux</strong> (H.264 copy), or{' '}
        <strong>transcode</strong> (re-encode). Start here before queuing converts.
      </p>
      {coverage ? (
        <div className="admin-stat-grid" style={{ marginTop: '1rem' }}>
          <div className="admin-stat-card">
            <span className="admin-stat-label">Library files</span>
            <strong>{coverage.total}</strong>
          </div>
          <div className="admin-stat-card">
            <span className="admin-stat-label">Probed</span>
            <strong>{coverage.probed}</strong>
          </div>
          <div className="admin-stat-card">
            <span className="admin-stat-label">Unprobed</span>
            <strong>{coverage.unprobed}</strong>
          </div>
          <div className="admin-stat-card">
            <span className="admin-stat-label">Direct play</span>
            <strong>{coverage.direct}</strong>
          </div>
          <div className={`admin-stat-card${coverage.needsConvert > 0 ? ' warn' : ''}`}>
            <span className="admin-stat-label">Needs convert</span>
            <strong>{coverage.needsConvert}</strong>
          </div>
        </div>
      ) : null}
      {probeStatus && (probeStatus.phase === 'running' || probeStatus.processed > 0) ? (
        <div className="convert-progress-block">
          <div className="convert-progress-head">
            <span className="muted">Codec scan</span>
            <strong className="convert-progress-pct">{formatProgress(probePct)}</strong>
          </div>
          <div className="admin-progress-bar" aria-valuenow={probePct} aria-valuemin={0} aria-valuemax={100}>
            <i style={{ width: `${probePct}%` }} />
          </div>
          <p className={probeStatus.phase === 'error' ? 'error-text' : 'muted'}>
            {probeStatus.message}
            {probeStatus.phase === 'running' && probeStatus.total
              ? ` · ${probeStatus.processed}/${probeStatus.total}`
              : ''}
          </p>
          {probeStatus.phase !== 'idle' ? (
            <p className="muted" style={{ fontSize: '0.85rem' }}>
              Direct {probeStatus.direct} · Remux {probeStatus.remux} · Transcode{' '}
              {probeStatus.transcode} · Failed {probeStatus.failed}
            </p>
          ) : null}
          {probeStatus.currentPath ? (
            <p className="muted convert-path-line">{probeStatus.currentPath}</p>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
