import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../../api'
import { AdminSkeleton } from '../admin/AdminSkeleton'
import type { CodecProbeCoverage, CodecProbeStatus, ConvertJob, ConvertNeedsFile } from '../../types'
import { ConvertJobsList } from './ConvertJobsList'
import { ConvertNeedsTable } from './ConvertNeedsTable'
import { ConvertOptions } from './ConvertOptions'
import { ConvertProbePanel } from './ConvertProbePanel'
import { jobSortKey, plannedAction } from './utils'

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
  const prevJobStatus = useRef<Map<number, string>>(new Map())
  const jobStatusReady = useRef(false)

  const jobsActive = stats.running > 0 || stats.queued > 0
  const pollMs = probing || jobsActive ? 900 : 4000

  const refresh = useCallback(async () => {
    try {
      const [j, n, p] = await Promise.all([
        api.convertJobs(),
        api.convertNeeds(),
        api.convertProbeStatus(),
      ])
      // Toast when jobs finish / fail (skip the first snapshot so refresh isn't noisy)
      if (jobStatusReady.current) {
        for (const job of j.jobs) {
          const prev = prevJobStatus.current.get(job.id)
          if (!prev) continue
          if (
            (prev === 'running' || prev === 'queued' || prev === 'cancelling') &&
            (job.status === 'done' || job.status === 'failed' || job.status === 'skipped')
          ) {
            const label = job.titleName || job.path.split('/').pop() || `#${job.id}`
            if (job.status === 'done') {
              notify(`Convert done · ${label}${job.mode ? ` (${job.mode})` : ''}`)
            } else if (job.status === 'skipped') {
              notify(`Skipped · ${label} — already compatible`)
            } else {
              notify(`Convert failed · ${label}${job.error ? `: ${job.error}` : ''}`)
            }
          }
        }
      }
      const nextMap = new Map<number, string>()
      for (const job of j.jobs) nextMap.set(job.id, job.status)
      prevJobStatus.current = nextMap
      jobStatusReady.current = true

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

  if (loading) return <AdminSkeleton rows={8} />

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

      <ConvertProbePanel
        probing={probing}
        probeStatus={probeStatus}
        coverage={coverage}
        probePct={probePct}
        onStartProbe={startLibraryProbe}
        onCancelProbe={cancelLibraryProbe}
      />

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

      <ConvertOptions
        mode={mode}
        replaceOriginal={replaceOriginal}
        deleteOriginal={deleteOriginal}
        onModeChange={setMode}
        onReplaceOriginalChange={setReplaceOriginal}
        onDeleteOriginalChange={setDeleteOriginal}
      />

      <ConvertJobsList
        jobs={sortedJobs}
        enqueueing={enqueueing}
        localMediaEnabled={localMediaEnabled}
        notify={notify}
        onRefresh={refresh}
        onCancelJob={cancelJob}
        onRetry={enqueueOne}
      />

      <ConvertNeedsTable
        needs={needs}
        selected={selected}
        remuxCount={remuxCount}
        transcodeCount={transcodeCount}
        enqueueing={enqueueing}
        localMediaEnabled={localMediaEnabled}
        notify={notify}
        onToggle={toggle}
        onSelectBy={selectBy}
        onEnqueueSelected={enqueueSelected}
        onEnqueueOne={enqueueOne}
      />
    </div>
  )
}
