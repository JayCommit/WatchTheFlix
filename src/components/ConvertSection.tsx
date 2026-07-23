import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import type { CodecProbeCoverage, CodecProbeStatus, ConvertJob, ConvertNeedsFile } from '../types'
import { formatBytes } from '../utils/format'

function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="admin-skeleton" aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="admin-skeleton-row" />
      ))}
    </div>
  )
}

function modeBadge(
  mode: string | null | undefined,
  canDirect: boolean | null | undefined,
  probeError?: string | null,
) {
  if (probeError && !mode) return <span className="codec-badge bad">Probe failed</span>
  if (canDirect) return <span className="codec-badge ok">Direct</span>
  if (mode === 'remux') return <span className="codec-badge warn">Remux</span>
  if (mode === 'transcode') return <span className="codec-badge bad">Transcode</span>
  if (!mode) return <span className="codec-badge muted">Unknown</span>
  return <span className="codec-badge muted">{mode}</span>
}

function statusBadge(status: string) {
  const s = status.toLowerCase()
  if (s === 'running') return <span className="codec-badge warn">Running</span>
  if (s === 'queued') return <span className="codec-badge muted">Queued</span>
  if (s === 'done') return <span className="codec-badge ok">Done</span>
  if (s === 'failed') return <span className="codec-badge bad">Failed</span>
  if (s === 'cancelled' || s === 'cancelling') return <span className="codec-badge muted">Cancelled</span>
  if (s === 'skipped') return <span className="codec-badge ok">Skipped</span>
  return <span className="codec-badge muted">{status}</span>
}

function formatProgress(pct: number): string {
  if (!Number.isFinite(pct) || pct <= 0) return '0%'
  if (pct >= 100) return '100%'
  // Show one decimal while running for smoother feedback
  if (pct < 99.5 && pct % 1 !== 0) return `${pct.toFixed(1)}%`
  return `${Math.round(pct)}%`
}

function jobSortKey(job: ConvertJob): number {
  const order: Record<string, number> = {
    running: 0,
    cancelling: 1,
    queued: 2,
    failed: 3,
    cancelled: 4,
    skipped: 5,
    done: 6,
  }
  return order[job.status] ?? 9
}

function plannedAction(file: ConvertNeedsFile): 'remux' | 'transcode' | 'unknown' {
  if (file.canDirect) return 'unknown'
  if (file.playbackMode === 'remux' || file.videoCodec === 'h264') return 'remux'
  if (file.playbackMode === 'transcode') return 'transcode'
  if (file.videoCodec && file.videoCodec !== 'h264') return 'transcode'
  return 'unknown'
}

export function ConvertSection({ notify }: { notify: (msg: string) => void }) {
  const [jobs, setJobs] = useState<ConvertJob[]>([])
  const [needs, setNeeds] = useState<ConvertNeedsFile[]>([])
  const [stats, setStats] = useState({ queued: 0, running: 0, done: 0, failed: 0 })
  const [localMediaEnabled, setLocalMediaEnabled] = useState(false)
  const [deleteDefault, setDeleteDefault] = useState(false)
  const [loading, setLoading] = useState(true)
  const [probing, setProbing] = useState(false)
  const [probeStatus, setProbeStatus] = useState<CodecProbeStatus | null>(null)
  const [coverage, setCoverage] = useState<CodecProbeCoverage | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [replaceOriginal, setReplaceOriginal] = useState(true)
  const [deleteOriginal, setDeleteOriginal] = useState(false)
  const [mode, setMode] = useState<'auto' | 'remux' | 'transcode'>('auto')
  const [enqueueing, setEnqueueing] = useState(false)

  const jobsActive = stats.running > 0 || stats.queued > 0
  const pollMs = probing || jobsActive ? 900 : 4000

  const refresh = useCallback(async () => {
    try {
      const [j, n, p] = await Promise.all([
        api.convertJobs(),
        api.convertNeeds(),
        api.convertProbeStatus(),
      ])
      setJobs(j.jobs)
      setStats(j.stats)
      setLocalMediaEnabled(j.localMediaEnabled)
      setDeleteDefault(j.deleteOriginalDefault)
      setNeeds(n.files)
      setProbeStatus(p.status)
      setCoverage(p.coverage)
      setProbing(p.running || p.status.phase === 'running')
      setLoading(false)
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to load convert queue')
      setLoading(false)
    }
  }, [notify])

  useEffect(() => {
    void refresh()
    const id = window.setInterval(() => void refresh(), pollMs)
    return () => window.clearInterval(id)
  }, [refresh, pollMs])

  useEffect(() => {
    setDeleteOriginal(deleteDefault)
  }, [deleteDefault])

  const sortedJobs = useMemo(
    () =>
      [...jobs].sort((a, b) => {
        const d = jobSortKey(a) - jobSortKey(b)
        if (d !== 0) return d
        return (b.createdAt || '').localeCompare(a.createdAt || '')
      }),
    [jobs],
  )

  const remuxCount = useMemo(
    () => needs.filter((f) => plannedAction(f) === 'remux').length,
    [needs],
  )
  const transcodeCount = useMemo(
    () => needs.filter((f) => plannedAction(f) === 'transcode').length,
    [needs],
  )

  const probePct =
    probeStatus && probeStatus.total > 0
      ? Math.min(100, Math.round((probeStatus.processed / probeStatus.total) * 100))
      : probeStatus?.phase === 'done'
        ? 100
        : 0

  async function startLibraryProbe(force: boolean) {
    try {
      const res = await api.convertProbeLibrary({ force })
      setProbeStatus(res.status)
      setCoverage(res.coverage)
      setProbing(res.status.phase === 'running')
      notify(
        force
          ? `Re-scanning codecs for ${res.status.total} file(s)…`
          : res.status.total
            ? `Detecting codecs for ${res.status.total} unprobed file(s)…`
            : 'All files already have codec data',
      )
      await refresh()
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not start codec scan')
    }
  }

  async function cancelLibraryProbe() {
    try {
      await api.convertProbeCancel()
      notify('Codec scan cancel requested')
      await refresh()
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Cancel failed')
    }
  }

  async function enqueueSelected() {
    const paths = [...selected]
    if (!paths.length) {
      notify('Select files to convert')
      return
    }
    setEnqueueing(true)
    try {
      const res = await api.convertEnqueue({
        paths,
        mode,
        replaceOriginal,
        deleteOriginal,
      })
      const modes = res.jobs
        .map((j) => j.job?.mode)
        .filter((m): m is string => Boolean(m))
      const remuxed = modes.filter((m) => m === 'remux').length
      const transcoded = modes.filter((m) => m === 'transcode').length
      const parts = [`Queued ${res.enqueued} job(s)`]
      if (remuxed) parts.push(`${remuxed} remux`)
      if (transcoded) parts.push(`${transcoded} transcode`)
      if (res.errors.length) parts.push(`${res.errors.length} error(s)`)
      notify(parts.join(' · '))
      if (res.errors[0]) console.warn('Convert enqueue errors', res.errors)
      setSelected(new Set())
      await refresh()
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Enqueue failed')
    } finally {
      setEnqueueing(false)
    }
  }

  async function enqueueOne(path: string) {
    setEnqueueing(true)
    try {
      const res = await api.convertEnqueue({ path, mode, replaceOriginal, deleteOriginal })
      if (res.enqueued) {
        const resolved = res.jobs[0]?.job?.mode
        notify(
          resolved === 'remux'
            ? 'Queued remux (stream copy — fast)'
            : resolved === 'transcode'
              ? 'Queued transcode (re-encode)'
              : 'Queued convert job',
        )
      } else notify(res.errors[0] || 'Enqueue failed')
      await refresh()
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Enqueue failed')
    } finally {
      setEnqueueing(false)
    }
  }

  async function cancelJob(id: number) {
    try {
      await api.convertCancel(id)
      notify('Cancel requested')
      await refresh()
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Cancel failed')
    }
  }

  function toggle(path: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  function selectBy(kind: 'all' | 'remux' | 'transcode' | 'none') {
    if (kind === 'none') {
      setSelected(new Set())
      return
    }
    const next = new Set<string>()
    for (const f of needs) {
      const plan = plannedAction(f)
      if (kind === 'all' || plan === kind) next.add(f.path)
    }
    setSelected(next)
  }

  if (loading) return <SkeletonRows rows={8} />

  return (
    <div className="admin-convert">
      {!localMediaEnabled ? (
        <div className="admin-banner warn">
          <strong>Local media not detected.</strong> Set <code>LOCAL_MEDIA_ROOT</code> to your
          container mount (e.g. <code>/media</code>) so convert jobs can read/write files on disk.
          Playback over WebDAV still works; conversion requires local paths.
        </div>
      ) : (
        <div className="admin-banner ok">
          Local media ready — convert jobs run with FFmpeg on this host. Auto mode remuxes H.264
          (fast stream-copy) and only transcodes when the video codec needs it.
        </div>
      )}

      <section className="admin-card">
        <div className="section-head">
          <h2>Detect file types</h2>
          <div className="admin-actions">
            {probing ? (
              <button className="btn btn-ghost" type="button" onClick={() => void cancelLibraryProbe()}>
                Cancel
              </button>
            ) : null}
            <button
              className="btn btn-ghost"
              type="button"
              disabled={probing}
              onClick={() => void startLibraryProbe(true)}
              title="Re-probe every file, even ones already scanned"
            >
              Rescan all
            </button>
            <button
              className="btn btn-primary"
              type="button"
              disabled={probing}
              onClick={() => void startLibraryProbe(false)}
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

      <div className="admin-stat-grid">
        <div className={`admin-stat-card${stats.queued ? ' warn' : ''}`}>
          <span className="admin-stat-label">Queued</span>
          <strong>{stats.queued}</strong>
        </div>
        <div className={`admin-stat-card${stats.running ? ' warn' : ''}`}>
          <span className="admin-stat-label">Running</span>
          <strong>{stats.running}</strong>
        </div>
        <div className="admin-stat-card">
          <span className="admin-stat-label">Done</span>
          <strong>{stats.done}</strong>
        </div>
        <div className={`admin-stat-card${stats.failed ? ' warn' : ''}`}>
          <span className="admin-stat-label">Failed</span>
          <strong>{stats.failed}</strong>
        </div>
      </div>

      <section className="admin-card">
        <div className="section-head">
          <h2>Queue options</h2>
        </div>
        <div className="admin-convert-opts">
          <label className="admin-convert-field">
            Mode
            <select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
              <option value="auto">Auto — remux H.264, transcode the rest</option>
              <option value="remux">Remux only (fail if re-encode needed)</option>
              <option value="transcode">Force transcode (re-encode everything)</option>
            </select>
          </label>
          <p className="muted convert-mode-hint">
            {mode === 'auto'
              ? 'Each file is classified on queue: H.264 → fast remux; HEVC / MPEG-4 / other → transcode.'
              : mode === 'remux'
                ? 'Stream-copy video only. Files that need a full re-encode will fail instead of transcoding.'
                : 'Re-encodes every queued file to H.264 + AAC — slower, use when you want a fresh encode.'}
          </p>
          <div className="admin-convert-opts-row">
            <label className="admin-check">
              <input
                type="checkbox"
                checked={replaceOriginal}
                onChange={(e) => setReplaceOriginal(e.target.checked)}
              />
              <span>Verified replace — update library to the new MP4</span>
            </label>
            <label className="admin-check">
              <input
                type="checkbox"
                checked={deleteOriginal}
                onChange={(e) => setDeleteOriginal(e.target.checked)}
                disabled={!replaceOriginal}
              />
              <span>
                Delete original after success — otherwise keep in <code>.wtf-originals/</code>
              </span>
            </label>
          </div>
        </div>
        <p className="muted">
          Flow: convert to temp → ffprobe verify → swap into place → optional purge of quarantined
          original. Never deletes without a successful verify.
        </p>
      </section>

      <section className="admin-card">
        <div className="section-head">
          <h2>Active & recent jobs</h2>
          <button className="btn btn-ghost" type="button" onClick={() => void refresh()}>
            Refresh
          </button>
        </div>
        {sortedJobs.length === 0 ? (
          <p className="muted">No convert jobs yet. Scan codecs, then queue files below.</p>
        ) : (
          <ul className="admin-job-list">
            {sortedJobs.slice(0, 40).map((job) => {
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
                    <span className="muted convert-path-line">{job.path}</span>
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
                      onClick={() => void cancelJob(job.id)}
                    >
                      Cancel
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section className="admin-card">
        <div className="section-head">
          <h2>Needs conversion</h2>
          <div className="admin-actions">
            <button
              className="btn btn-primary"
              type="button"
              disabled={!selected.size || !localMediaEnabled || enqueueing}
              onClick={() => void enqueueSelected()}
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
                <button className="btn btn-ghost btn-sm" type="button" onClick={() => selectBy('all')}>
                  Select all
                </button>
                {remuxCount > 0 ? (
                  <button
                    className="btn btn-ghost btn-sm"
                    type="button"
                    onClick={() => selectBy('remux')}
                    title="Only files that can stream-copy (H.264 remux)"
                  >
                    Select remux
                  </button>
                ) : null}
                {transcodeCount > 0 ? (
                  <button
                    className="btn btn-ghost btn-sm"
                    type="button"
                    onClick={() => selectBy('transcode')}
                    title="Only files that need a full re-encode"
                  >
                    Select transcode
                  </button>
                ) : null}
                {selected.size > 0 ? (
                  <button className="btn btn-ghost btn-sm" type="button" onClick={() => selectBy('none')}>
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
                            onChange={() => toggle(f.path)}
                            aria-label={`Select ${f.title}`}
                          />
                        </td>
                        <td>
                          <strong>{f.title}</strong>
                          <div className="muted">{f.kind}</div>
                        </td>
                        <td>
                          <div>{f.filename}</div>
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
                            onClick={() => void enqueueOne(f.path)}
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
    </div>
  )
}
