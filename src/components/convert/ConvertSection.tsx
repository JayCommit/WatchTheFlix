import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../../api'
import { AdminSkeleton } from '../admin/AdminSkeleton'
import type {
  CodecProbeCoverage,
  CodecProbeStatus,
  ConvertJob,
  ConvertNeedsFile,
  ConvertQueueMode,
  ConvertQueueOptions,
} from '../../types'
import { ConvertJobsList } from './ConvertJobsList'
import { ConvertLiveDock } from './ConvertLiveDock'
import {
  ConvertNeedsTable,
  type NeedsActionFilter,
  type NeedsKindFilter,
} from './ConvertNeedsTable'
import { ConvertOptions } from './ConvertOptions'
import { ConvertOverview } from './ConvertOverview'
import { jobSortKey } from './utils'

const FALLBACK_OPTIONS: ConvertQueueOptions = {
  mode: 'auto',
  replaceOriginal: true,
  deleteOriginal: false,
}

const PAGE_SIZES = [25, 50, 100] as const

function normalizeLocalOptions(opts: ConvertQueueOptions): ConvertQueueOptions {
  return {
    mode: opts.mode,
    replaceOriginal: opts.replaceOriginal,
    deleteOriginal: opts.replaceOriginal ? opts.deleteOriginal : false,
  }
}

function optionsEqual(a: ConvertQueueOptions, b: ConvertQueueOptions): boolean {
  return (
    a.mode === b.mode &&
    a.replaceOriginal === b.replaceOriginal &&
    a.deleteOriginal === b.deleteOriginal
  )
}

export function ConvertSection({ notify }: { notify: (msg: string) => void }) {
  const [jobs, setJobs] = useState<ConvertJob[]>([])
  const [needs, setNeeds] = useState<ConvertNeedsFile[]>([])
  const [needsTotal, setNeedsTotal] = useState(0)
  const [remuxCount, setRemuxCount] = useState(0)
  const [transcodeCount, setTranscodeCount] = useState(0)
  const [unknownCount, setUnknownCount] = useState(0)
  const [stats, setStats] = useState({ queued: 0, running: 0, done: 0, failed: 0 })
  const [localMediaEnabled, setLocalMediaEnabled] = useState(false)
  const [loading, setLoading] = useState(true)
  const [probing, setProbing] = useState(false)
  const [probeStatus, setProbeStatus] = useState<CodecProbeStatus | null>(null)
  const [coverage, setCoverage] = useState<CodecProbeCoverage | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [savedOptions, setSavedOptions] = useState<ConvertQueueOptions>(FALLBACK_OPTIONS)
  const [draftOptions, setDraftOptions] = useState<ConvertQueueOptions>(FALLBACK_OPTIONS)
  const [optionsReady, setOptionsReady] = useState(false)
  const [savingOptions, setSavingOptions] = useState(false)
  const [optionsJustSaved, setOptionsJustSaved] = useState(false)
  const [enqueueing, setEnqueueing] = useState(false)

  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState<number>(25)
  const [queryInput, setQueryInput] = useState('')
  const [query, setQuery] = useState('')
  const [action, setAction] = useState<NeedsActionFilter>('all')
  const [kind, setKind] = useState<NeedsKindFilter>('')

  const prevJobStatus = useRef<Map<number, string>>(new Map())
  const jobStatusReady = useRef(false)
  const draftRef = useRef(draftOptions)
  const savedRef = useRef(savedOptions)
  const optionsReadyRef = useRef(optionsReady)

  draftRef.current = draftOptions
  savedRef.current = savedOptions
  optionsReadyRef.current = optionsReady

  const jobsActive = stats.running > 0 || stats.queued > 0
  const pollMs = probing || jobsActive ? 900 : 4000
  const dirty = optionsReady && !optionsEqual(draftOptions, savedOptions)

  useEffect(() => {
    const id = window.setTimeout(() => {
      setQuery(queryInput.trim())
      setPage(0)
    }, 280)
    return () => window.clearTimeout(id)
  }, [queryInput])

  const refresh = useCallback(async () => {
    try {
      const [j, n, p] = await Promise.all([
        api.convertJobs(),
        api.convertNeeds({
          limit: pageSize,
          offset: page * pageSize,
          q: query,
          action,
          kind,
        }),
        api.convertProbeStatus(),
      ])

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
      if (j.options) {
        const next = normalizeLocalOptions(j.options)
        setSavedOptions(next)
        if (!optionsReadyRef.current || optionsEqual(draftRef.current, savedRef.current)) {
          setDraftOptions(next)
        }
        setOptionsReady(true)
      }

      setNeeds(n.files)
      setNeedsTotal(n.total)
      setRemuxCount(n.remuxCount)
      setTranscodeCount(n.transcodeCount)
      setUnknownCount(n.unknownCount)
      // If filters shrink the result set past the current page, snap back.
      const maxPage = Math.max(0, Math.ceil(n.total / pageSize) - 1)
      if (page > maxPage) setPage(maxPage)

      setProbeStatus(p.status)
      setCoverage(p.coverage)
      setProbing(p.running || p.status.phase === 'running')
      setLoading(false)
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to load convert queue')
      setLoading(false)
    }
  }, [notify, page, pageSize, query, action, kind])

  useEffect(() => {
    void refresh()
    const id = window.setInterval(() => void refresh(), pollMs)
    return () => window.clearInterval(id)
  }, [refresh, pollMs])

  const sortedJobs = useMemo(
    () =>
      [...jobs].sort((a, b) => {
        const d = jobSortKey(a) - jobSortKey(b)
        if (d !== 0) return d
        return (b.createdAt || '').localeCompare(a.createdAt || '')
      }),
    [jobs],
  )

  const activeJobs = useMemo(
    () =>
      sortedJobs.filter(
        (j) => j.status === 'running' || j.status === 'queued' || j.status === 'cancelling',
      ),
    [sortedJobs],
  )

  const probePct =
    probeStatus && probeStatus.total > 0
      ? Math.min(100, Math.round((probeStatus.processed / probeStatus.total) * 100))
      : probeStatus?.phase === 'done'
        ? 100
        : 0

  const overviewNeeds = coverage?.needsConvert ?? needsTotal

  function patchDraft(patch: Partial<ConvertQueueOptions>) {
    setOptionsJustSaved(false)
    setDraftOptions((prev) =>
      normalizeLocalOptions({
        ...prev,
        ...patch,
        deleteOriginal:
          patch.replaceOriginal === false
            ? false
            : patch.deleteOriginal !== undefined
              ? patch.deleteOriginal
              : prev.deleteOriginal,
      }),
    )
  }

  async function saveOptions() {
    setSavingOptions(true)
    try {
      const res = await api.convertSaveOptions(draftOptions)
      const next = normalizeLocalOptions(res.options)
      setSavedOptions(next)
      setDraftOptions(next)
      setOptionsJustSaved(true)
      notify('Queue options saved')
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not save queue options')
    } finally {
      setSavingOptions(false)
    }
  }

  function resetOptions() {
    setOptionsJustSaved(false)
    setDraftOptions(savedOptions)
  }

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
        mode: draftOptions.mode,
        replaceOriginal: draftOptions.replaceOriginal,
        deleteOriginal: draftOptions.deleteOriginal,
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
      const res = await api.convertEnqueue({
        path,
        mode: draftOptions.mode,
        replaceOriginal: draftOptions.replaceOriginal,
        deleteOriginal: draftOptions.deleteOriginal,
      })
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

  function selectPage() {
    setSelected((prev) => {
      const next = new Set(prev)
      for (const f of needs) next.add(f.path)
      return next
    })
  }

  function jumpToJobs() {
    document.getElementById('convert-jobs')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  if (loading) return <AdminSkeleton rows={8} />

  return (
    <div className="admin-convert">
      <ConvertLiveDock
        probing={probing}
        probeStatus={probeStatus}
        probePct={probePct}
        activeJobs={activeJobs}
        queued={stats.queued}
        running={stats.running}
        onCancelProbe={cancelLibraryProbe}
        onCancelJob={cancelJob}
        onJumpToJobs={jumpToJobs}
      />

      <ConvertOverview
        localMediaEnabled={localMediaEnabled}
        probing={probing}
        probeStatus={probeStatus}
        coverage={coverage}
        probePct={probePct}
        stats={stats}
        needsTotal={overviewNeeds}
        onStartProbe={startLibraryProbe}
        onCancelProbe={cancelLibraryProbe}
      />

      <ConvertOptions
        mode={draftOptions.mode}
        replaceOriginal={draftOptions.replaceOriginal}
        deleteOriginal={draftOptions.deleteOriginal}
        dirty={dirty}
        saving={savingOptions}
        saved={optionsJustSaved || (!dirty && optionsReady)}
        onModeChange={(mode: ConvertQueueMode) => patchDraft({ mode })}
        onReplaceOriginalChange={(replaceOriginal) => patchDraft({ replaceOriginal })}
        onDeleteOriginalChange={(deleteOriginal) => patchDraft({ deleteOriginal })}
        onSave={() => void saveOptions()}
        onReset={resetOptions}
      />

      <div className="convert-main-grid">
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
          total={needsTotal}
          page={page}
          pageSize={pageSize}
          query={queryInput}
          action={action}
          kind={kind}
          remuxCount={remuxCount}
          transcodeCount={transcodeCount}
          unknownCount={unknownCount}
          selected={selected}
          enqueueing={enqueueing}
          localMediaEnabled={localMediaEnabled}
          notify={notify}
          onQueryChange={setQueryInput}
          onActionChange={(next) => {
            setAction(next)
            setPage(0)
          }}
          onKindChange={(next) => {
            setKind(next)
            setPage(0)
          }}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            const next = PAGE_SIZES.includes(size as (typeof PAGE_SIZES)[number]) ? size : 25
            setPageSize(next)
            setPage(0)
          }}
          onToggle={toggle}
          onSelectPage={selectPage}
          onClearSelection={() => setSelected(new Set())}
          onEnqueueSelected={enqueueSelected}
          onEnqueueOne={enqueueOne}
        />
      </div>
    </div>
  )
}
