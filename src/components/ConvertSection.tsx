import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import type { ConvertJob, ConvertNeedsFile } from '../types'
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

function modeBadge(mode: string | null | undefined, canDirect: boolean | null | undefined) {
  if (canDirect) return <span className="codec-badge ok">Direct</span>
  if (mode === 'remux') return <span className="codec-badge warn">Remux</span>
  if (mode === 'transcode') return <span className="codec-badge bad">Transcode</span>
  if (!mode) return <span className="codec-badge muted">Unknown</span>
  return <span className="codec-badge muted">{mode}</span>
}

export function ConvertSection({ notify }: { notify: (msg: string) => void }) {
  const [jobs, setJobs] = useState<ConvertJob[]>([])
  const [needs, setNeeds] = useState<ConvertNeedsFile[]>([])
  const [stats, setStats] = useState({ queued: 0, running: 0, done: 0, failed: 0 })
  const [localMediaEnabled, setLocalMediaEnabled] = useState(false)
  const [deleteDefault, setDeleteDefault] = useState(false)
  const [loading, setLoading] = useState(true)
  const [probing, setProbing] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [replaceOriginal, setReplaceOriginal] = useState(true)
  const [deleteOriginal, setDeleteOriginal] = useState(false)
  const [mode, setMode] = useState<'auto' | 'remux' | 'transcode'>('auto')

  const refresh = useCallback(async () => {
    try {
      const [j, n] = await Promise.all([api.convertJobs(), api.convertNeeds()])
      setJobs(j.jobs)
      setStats(j.stats)
      setLocalMediaEnabled(j.localMediaEnabled)
      setDeleteDefault(j.deleteOriginalDefault)
      setNeeds(n.files)
      setLoading(false)
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to load convert queue')
      setLoading(false)
    }
  }, [notify])

  useEffect(() => {
    void refresh()
    const id = window.setInterval(() => void refresh(), 4000)
    return () => window.clearInterval(id)
  }, [refresh])

  useEffect(() => {
    setDeleteOriginal(deleteDefault)
  }, [deleteDefault])

  async function probeBatch() {
    setProbing(true)
    try {
      const res = await api.convertProbe({ limit: 40 })
      notify(`Probed ${res.probed} files`)
      await refresh()
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Probe failed')
    } finally {
      setProbing(false)
    }
  }

  async function enqueueSelected() {
    const paths = [...selected]
    if (!paths.length) {
      notify('Select files to convert')
      return
    }
    try {
      const res = await api.convertEnqueue({
        paths,
        mode,
        replaceOriginal,
        deleteOriginal,
      })
      notify(`Queued ${res.enqueued} job(s)${res.errors.length ? ` · ${res.errors.length} error(s)` : ''}`)
      setSelected(new Set())
      await refresh()
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Enqueue failed')
    }
  }

  async function enqueueOne(path: string) {
    try {
      const res = await api.convertEnqueue({ path, mode, replaceOriginal, deleteOriginal })
      if (res.enqueued) notify('Queued convert job')
      else notify(res.errors[0] || 'Enqueue failed')
      await refresh()
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Enqueue failed')
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
          Local media ready — convert jobs will run with FFmpeg on this host.
        </div>
      )}

      <div className="admin-stat-grid">
        <div className="admin-stat-card">
          <span className="admin-stat-label">Queued</span>
          <strong>{stats.queued}</strong>
        </div>
        <div className="admin-stat-card">
          <span className="admin-stat-label">Running</span>
          <strong>{stats.running}</strong>
        </div>
        <div className="admin-stat-card">
          <span className="admin-stat-label">Done</span>
          <strong>{stats.done}</strong>
        </div>
        <div className="admin-stat-card">
          <span className="admin-stat-label">Failed</span>
          <strong>{stats.failed}</strong>
        </div>
      </div>

      <section className="admin-card">
        <div className="section-head">
          <h2>Queue options</h2>
        </div>
        <div className="admin-convert-opts">
          <label>
            Mode
            <select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
              <option value="auto">Auto (remux if possible)</option>
              <option value="remux">Remux only</option>
              <option value="transcode">Force transcode</option>
            </select>
          </label>
          <label className="admin-check">
            <input
              type="checkbox"
              checked={replaceOriginal}
              onChange={(e) => setReplaceOriginal(e.target.checked)}
            />
            Verified replace (update library to new MP4)
          </label>
          <label className="admin-check">
            <input
              type="checkbox"
              checked={deleteOriginal}
              onChange={(e) => setDeleteOriginal(e.target.checked)}
              disabled={!replaceOriginal}
            />
            Delete original after success (otherwise keep in <code>.wtf-originals/</code>)
          </label>
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
        {jobs.length === 0 ? (
          <p className="muted">No convert jobs yet.</p>
        ) : (
          <ul className="admin-job-list">
            {jobs.slice(0, 40).map((job) => (
              <li key={job.id}>
                <div className="admin-job-main">
                  <strong>
                    #{job.id} · {job.titleName || 'Untitled'} · {job.status}
                  </strong>
                  <span className="muted">
                    {job.mode}
                    {job.videoCodec ? ` · ${job.videoCodec}` : ''}
                    {job.audioCodec ? `/${job.audioCodec}` : ''}
                    {job.container ? ` · ${job.container}` : ''}
                  </span>
                  <span className="muted" style={{ fontSize: '0.8rem' }}>
                    {job.path}
                  </span>
                  {(job.status === 'running' || job.status === 'queued') && (
                    <div className="admin-mini-bar">
                      <i style={{ width: `${Math.min(100, job.progress)}%` }} />
                    </div>
                  )}
                  {job.error ? (
                    <span className={job.status === 'failed' ? 'error-text' : 'muted'}>{job.error}</span>
                  ) : null}
                  {job.outputPath ? (
                    <span className="ok-text" style={{ fontSize: '0.85rem' }}>
                      → {job.outputPath}
                    </span>
                  ) : null}
                </div>
                {(job.status === 'queued' || job.status === 'running' || job.status === 'cancelling') && (
                  <button className="btn btn-ghost btn-sm" type="button" onClick={() => void cancelJob(job.id)}>
                    Cancel
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="admin-card">
        <div className="section-head">
          <h2>Needs conversion</h2>
          <div className="admin-actions">
            <button className="btn btn-ghost" type="button" disabled={probing} onClick={() => void probeBatch()}>
              {probing ? 'Probing…' : 'Probe codecs'}
            </button>
            <button
              className="btn btn-primary"
              type="button"
              disabled={!selected.size || !localMediaEnabled}
              onClick={() => void enqueueSelected()}
              title={!localMediaEnabled ? 'Set LOCAL_MEDIA_ROOT first' : undefined}
            >
              Queue selected ({selected.size})
            </button>
          </div>
        </div>
        {needs.length === 0 ? (
          <p className="muted">
            No incompatible files listed. Run <strong>Probe codecs</strong> to analyze MKV/AVI files.
          </p>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th />
                  <th>Title</th>
                  <th>File</th>
                  <th>Codecs</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {needs.map((f) => (
                  <tr key={f.path}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.has(f.path)}
                        onChange={() => toggle(f.path)}
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
                    </td>
                    <td>{modeBadge(f.playbackMode, f.canDirect)}</td>
                    <td>
                      <button
                        className="btn btn-ghost btn-sm"
                        type="button"
                        disabled={!localMediaEnabled}
                        onClick={() => void enqueueOne(f.path)}
                      >
                        Convert
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
