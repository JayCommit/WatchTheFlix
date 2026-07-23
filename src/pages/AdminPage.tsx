import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, type ScanStatusResponse } from '../api'
import { ConvertSection } from '../components/ConvertSection'
import { TopBar } from '../components/TopBar'
import type {
  ActivityEvent,
  ActivityProgress,
  AdminOverview,
  AdminTitle,
  AuthUser,
  NowPlayingSession,
  TmdbSearchResult,
} from '../types'
import { episodeLabel, formatBytes, formatTime } from '../utils/format'

type Section =
  | 'overview'
  | 'now'
  | 'library'
  | 'unmatched'
  | 'activity'
  | 'convert'
  | 'users'
  | 'tools'

const SECTIONS: Section[] = [
  'overview',
  'now',
  'library',
  'unmatched',
  'activity',
  'convert',
  'users',
  'tools',
]

function isSection(value: string | null): value is Section {
  return !!value && (SECTIONS as string[]).includes(value)
}

type Diagnostics = Awaited<ReturnType<typeof api.diagnostics>>
type DrawerHealth = {
  missing: Array<{ season: number; episode: number; name: string }>
  present: number
  expected: number
}

type Props = {
  user: AuthUser
  onLogout: () => void
}

function relativeAge(iso: string | null | undefined): string {
  if (!iso) return '—'
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms) || ms < 0) return 'just now'
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h}h ago`
  return new Date(iso).toLocaleString()
}

function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="admin-skeleton" aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="admin-skeleton-row" />
      ))}
    </div>
  )
}

export function AdminPage({ user, onLogout }: Props) {
  const [searchParams, setSearchParams] = useSearchParams()
  const section: Section = isSection(searchParams.get('section'))
    ? (searchParams.get('section') as Section)
    : 'overview'

  function setSection(next: Section) {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev)
        if (next === 'overview') params.delete('section')
        else params.set('section', next)
        return params
      },
      { replace: true },
    )
  }

  const [titles, setTitles] = useState<AdminTitle[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [kind, setKind] = useState<'movie' | 'tv' | ''>('')
  const [matchFilter, setMatchFilter] = useState<'all' | 'matched' | 'unmatched'>('all')
  const [showHidden, setShowHidden] = useState(false)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [flash, setFlash] = useState('')
  const [selected, setSelected] = useState<Set<number>>(new Set())

  const [editId, setEditId] = useState<number | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editYear, setEditYear] = useState('')

  const [rematchId, setRematchId] = useState<number | null>(null)
  const [rematchQuery, setRematchQuery] = useState('')
  const [rematchKind, setRematchKind] = useState<'movie' | 'tv'>('movie')
  const [rematchResults, setRematchResults] = useState<TmdbSearchResult[]>([])
  const [rematchSearching, setRematchSearching] = useState(false)
  const [rematchError, setRematchError] = useState('')

  const [drawer, setDrawer] = useState<AdminTitle | null>(null)
  const [drawerLoading, setDrawerLoading] = useState(false)
  const [drawerHealth, setDrawerHealth] = useState<DrawerHealth | null>(null)
  const [mergeTargetId, setMergeTargetId] = useState('')
  const [reassignTargets, setReassignTargets] = useState<Record<string, string>>({})
  const drawerReqRef = useRef(0)

  const [overview, setOverview] = useState<AdminOverview | null>(null)
  const [overviewError, setOverviewError] = useState('')
  const [sessions, setSessions] = useState<NowPlayingSession[]>([])
  const [includeStale, setIncludeStale] = useState(false)
  const [activityEvents, setActivityEvents] = useState<ActivityEvent[]>([])
  const [activityProgress, setActivityProgress] = useState<ActivityProgress[]>([])
  const [activityTab, setActivityTab] = useState<'events' | 'progress'>('progress')

  const [scanning, setScanning] = useState(false)
  const [scanMsg, setScanMsg] = useState('')
  const [scanStatus, setScanStatus] = useState<ScanStatusResponse | null>(null)
  const [diag, setDiag] = useState<Diagnostics | null>(null)
  const [diagError, setDiagError] = useState('')

  function notify(msg: string) {
    setFlash(msg)
    window.setTimeout(() => setFlash(''), 3200)
  }

  async function logout() {
    await api.logout()
    onLogout()
  }

  async function loadOverview() {
    setOverviewError('')
    try {
      setOverview(await api.adminOverview())
    } catch (err) {
      setOverviewError(err instanceof Error ? err.message : 'Failed to load overview')
    }
  }

  async function loadNowPlaying() {
    try {
      const res = await api.adminNowPlaying(includeStale)
      setSessions(res.sessions)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load now playing')
    }
  }

  async function loadActivity() {
    try {
      const res = await api.adminActivity(60)
      setActivityEvents(res.events)
      setActivityProgress(res.progress)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load activity')
    }
  }

  async function loadTitles() {
    setLoading(true)
    setError('')
    try {
      if (section === 'unmatched') {
        const res = await api.adminUnmatched()
        let list = res.titles
        if (q.trim()) {
          const needle = q.trim().toLowerCase()
          list = list.filter(
            (t) =>
              t.title.toLowerCase().includes(needle) ||
              String(t.tmdbId).includes(needle) ||
              String(t.id) === needle,
          )
        }
        if (kind) list = list.filter((t) => t.kind === kind)
        setTitles(list)
        setSelected(new Set())
      } else {
        const res = await api.adminTitles({
          q: q.trim() || undefined,
          kind: kind || undefined,
          includeHidden: showHidden,
        })
        let list = res.titles
        if (matchFilter === 'matched') list = list.filter((t) => !t.unmatched)
        if (matchFilter === 'unmatched') list = list.filter((t) => t.unmatched)
        setTitles(list)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load titles')
      setTitles([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (section === 'overview') void loadOverview()
    if (section === 'now') void loadNowPlaying()
    if (section === 'activity') void loadActivity()
    if (section === 'tools') void loadDiagnostics()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section])

  useEffect(() => {
    if (section !== 'now') return
    void loadNowPlaying()
    const t = window.setInterval(() => void loadNowPlaying(), 12_000)
    return () => window.clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, includeStale])

  useEffect(() => {
    if (section !== 'activity') return
    void loadActivity()
    const t = window.setInterval(() => void loadActivity(), 20_000)
    return () => window.clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section])

  useEffect(() => {
    if (section !== 'library' && section !== 'unmatched') return
    const t = window.setTimeout(() => void loadTitles(), 180)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, q, kind, showHidden, matchFilter])

  async function loadDiagnostics() {
    try {
      const d = await api.diagnostics()
      setDiag(d)
      setDiagError('')
    } catch (err) {
      setDiagError(err instanceof Error ? err.message : 'Diagnostics failed')
    }
  }

  function openEdit(t: AdminTitle) {
    setRematchId(null)
    setEditId(t.id)
    setEditTitle(t.title)
    setEditYear(t.year != null ? String(t.year) : '')
  }

  async function saveEdit() {
    if (editId == null) return
    setBusyId(editId)
    try {
      const yearNum = editYear.trim() === '' ? null : Number(editYear)
      await api.patchAdminTitle(editId, {
        title: editTitle.trim(),
        year: yearNum != null && Number.isFinite(yearNum) ? yearNum : null,
      })
      setEditId(null)
      notify('Metadata saved')
      await loadTitles()
      if (drawer?.id === editId) await openDrawer(editId)
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setBusyId(null)
    }
  }

  function openRematch(t: AdminTitle) {
    setEditId(null)
    setRematchId(t.id)
    setRematchQuery(t.title)
    setRematchKind(t.kind)
    setRematchResults([])
    setRematchError('')
  }

  async function runTmdbSearch() {
    if (!rematchQuery.trim()) return
    setRematchSearching(true)
    setRematchError('')
    try {
      let year: number | null | undefined
      if (editId != null && editId === rematchId && editYear.trim()) {
        const n = Number(editYear)
        if (Number.isFinite(n)) year = n
      } else if (rematchId != null) {
        const fromList = titles.find((t) => t.id === rematchId)
        const fromDrawer = drawer?.id === rematchId ? drawer : null
        year = fromList?.year ?? fromDrawer?.year ?? null
      }
      const res = await api.tmdbSearch(rematchQuery.trim(), rematchKind, year)
      setRematchResults(res.results)
      if (res.results.length === 0) setRematchError('No TMDB results')
    } catch (err) {
      setRematchError(err instanceof Error ? err.message : 'Search failed')
      setRematchResults([])
    } finally {
      setRematchSearching(false)
    }
  }

  async function applyRematch(tmdbId?: number) {
    if (rematchId == null) return
    setBusyId(rematchId)
    try {
      const result = await api.rematchTitle(rematchId, {
        tmdbId,
        query: tmdbId ? undefined : rematchQuery.trim(),
        kind: rematchKind,
      })
      setRematchId(null)
      if (result.mergedIntoId != null) {
        notify(`Matched to TMDB ${result.tmdbId} — ${result.title} (merged into #${result.mergedIntoId})`)
      } else {
        notify(`Matched to TMDB ${result.tmdbId} — ${result.title}`)
      }
      await loadTitles()
      const openId = result.mergedIntoId ?? result.id
      if (drawer?.id === rematchId || drawer?.id === result.id || drawer?.id === openId) {
        await openDrawer(openId)
      }
    } catch (err) {
      setRematchError(err instanceof Error ? err.message : 'Rematch failed')
    } finally {
      setBusyId(null)
    }
  }

  async function toggleHide(t: AdminTitle) {
    setBusyId(t.id)
    try {
      const updated = await api.hideTitle(t.id, !t.hidden)
      notify(t.hidden ? 'Title unhidden' : 'Title hidden from library')
      await loadTitles()
      if (drawer?.id === t.id) {
        setDrawer((prev) => (prev ? { ...prev, hidden: updated.hidden } : prev))
        await openDrawer(t.id)
      }
      if (section === 'overview') void loadOverview()
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Hide failed')
    } finally {
      setBusyId(null)
    }
  }

  async function openDrawer(id: number) {
    const req = ++drawerReqRef.current
    setDrawerLoading(true)
    setDrawerHealth(null)
    setMergeTargetId('')
    setReassignTargets({})
    try {
      const detail = await api.adminTitle(id)
      if (req !== drawerReqRef.current) return
      setDrawer(detail)
      if (detail.kind === 'tv' && !detail.unmatched) {
        try {
          const health = await api.titleHealth(id)
          if (req !== drawerReqRef.current) return
          setDrawerHealth(health)
        } catch {
          if (req !== drawerReqRef.current) return
          setDrawerHealth(null)
        }
      }
    } catch (err) {
      if (req !== drawerReqRef.current) return
      notify(err instanceof Error ? err.message : 'Could not load title')
    } finally {
      if (req === drawerReqRef.current) setDrawerLoading(false)
    }
  }

  async function mergeDrawerIntoTarget() {
    if (!drawer) return
    const targetId = Number(mergeTargetId)
    if (!Number.isFinite(targetId) || targetId <= 0) {
      notify('Enter a valid target title id')
      return
    }
    if (targetId === drawer.id) {
      notify('Cannot merge a title into itself')
      return
    }
    setBusyId(drawer.id)
    try {
      const res = await api.mergeTitle(drawer.id, targetId)
      notify(`Merged · moved ${res.moved} file(s) into #${res.target.id}`)
      drawerReqRef.current += 1
      setDrawer(null)
      setDrawerLoading(false)
      setDrawerHealth(null)
      await loadTitles()
      await openDrawer(res.target.id)
      if (section === 'overview') void loadOverview()
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Merge failed')
    } finally {
      setBusyId(null)
    }
  }

  async function reassignDrawerFile(path: string) {
    if (!drawer) return
    const titleId = Number(reassignTargets[path] ?? '')
    if (!Number.isFinite(titleId) || titleId <= 0) {
      notify('Enter a valid title id to reassign')
      return
    }
    try {
      await api.reassignFile(path, titleId)
      notify(`Reassigned file to title #${titleId}`)
      await openDrawer(drawer.id)
      await loadTitles()
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Reassign failed')
    }
  }

  async function onScan() {
    setScanning(true)
    setScanStatus(null)
    const local = diag?.scanSource === 'local' || diag?.config.localMediaEnabled
    setScanMsg(
      local
        ? 'Scanning local disk under LOCAL_MEDIA_ROOT…'
        : 'Scanning WebDAV under MEDIA_ROOT…',
    )
    try {
      await loadDiagnostics()
      const result = await api.runScan((status) => {
        setScanStatus(status)
        const p = status.status
        if (!p) return
        const src = p.source === 'local' ? 'local disk' : 'WebDAV'
        if (p.phase === 'listing') {
          setScanMsg(`${src}: listing… ${p.dirsScanned} folders`)
        } else if (p.phase === 'matching') {
          setScanMsg(
            `${src}: matching ${p.processed}/${p.filesFound} · ${p.matched} matched · ${p.unmatched} unmatched`,
          )
        } else if (p.phase === 'episodes') {
          setScanMsg(`${src}: ${p.message}`)
        } else if (p.message) {
          setScanMsg(p.message)
        }
      })
      if (result.warning) {
        setScanMsg(result.warning)
      } else {
        const errN = result.errors?.length ?? 0
        setScanMsg(
          `Found ${result.filesFound} files · ${result.matched} matched · ${result.unmatched} unmatched · ${result.titles} titles` +
            (errN ? ` · ${errN} errors` : '') +
            (result.source ? ` (${result.source})` : ''),
        )
      }
      void loadOverview()
      void loadDiagnostics()
      if (section === 'library' || section === 'unmatched') void loadTitles()
    } catch (err) {
      setScanMsg(err instanceof Error ? err.message : 'Scan failed')
    } finally {
      setScanning(false)
    }
  }

  async function bulkHideSelected() {
    if (selected.size === 0) return
    setBusyId(-1)
    try {
      const res = await api.bulkHideUnmatched({ ids: [...selected] })
      notify(`Hidden ${res.hidden} titles`)
      setSelected(new Set())
      await loadTitles()
      void loadOverview()
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Bulk hide failed')
    } finally {
      setBusyId(null)
    }
  }

  async function bulkHideAllUnmatched() {
    if (!window.confirm('Hide all unmatched titles from the library?')) return
    setBusyId(-1)
    try {
      const res = await api.bulkHideUnmatched({ all: true })
      notify(`Hidden ${res.hidden} unmatched titles`)
      await loadTitles()
      void loadOverview()
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Bulk hide failed')
    } finally {
      setBusyId(null)
    }
  }

  async function clearTitleProgress(titleId: number) {
    setBusyId(titleId)
    try {
      const res = await api.clearProgress({ titleId })
      notify(`Cleared progress on ${res.cleared} file(s)`)
      if (drawer?.id === titleId) await openDrawer(titleId)
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Clear failed')
    } finally {
      setBusyId(null)
    }
  }

  async function markTitleWatched(titleId: number) {
    setBusyId(titleId)
    try {
      const res = await api.markWatched({ titleId })
      notify(`Marked ${res.marked ?? 0} file(s) watched`)
      if (drawer?.id === titleId) await openDrawer(titleId)
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Mark watched failed')
    } finally {
      setBusyId(null)
    }
  }

  async function clearFileProgress(path: string) {
    try {
      await api.clearProgress({ path })
      notify('Progress cleared')
      if (drawer) await openDrawer(drawer.id)
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Clear failed')
    }
  }

  async function markFileWatched(path: string, duration?: number) {
    try {
      await api.markWatched({ path, duration })
      notify('Marked watched')
      if (drawer) await openDrawer(drawer.id)
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Mark watched failed')
    }
  }

  const tabGroups: Array<{
    label: string
    items: Array<{ id: Section; label: string; hint?: string }>
  }> = useMemo(
    () => [
      {
        label: 'Monitor',
        items: [
          { id: 'overview', label: 'Overview' },
          {
            id: 'now',
            label: 'Now Playing',
            hint: overview?.nowPlayingCount ? String(overview.nowPlayingCount) : undefined,
          },
          { id: 'activity', label: 'Activity' },
        ],
      },
      {
        label: 'Library',
        items: [
          { id: 'library', label: 'Titles' },
          {
            id: 'unmatched',
            label: 'Unmatched',
            hint: overview?.stats.unmatched ? String(overview.stats.unmatched) : undefined,
          },
          { id: 'convert', label: 'Convert' },
        ],
      },
      {
        label: 'System',
        items: [
          { id: 'users', label: 'Users' },
          { id: 'tools', label: 'Tools' },
        ],
      },
    ],
    [overview],
  )

  const activeTabLabel =
    tabGroups.flatMap((g) => g.items).find((t) => t.id === section)?.label ?? 'Admin'

  // Keep badge counts fresh when landing on other tabs
  useEffect(() => {
    if (!overview) void loadOverview()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const tag = target?.tagName?.toLowerCase()
      const typing =
        tag === 'input' ||
        tag === 'textarea' ||
        tag === 'select' ||
        Boolean(target?.isContentEditable)

      if (e.key === 'Escape') {
        if (editId != null) {
          setEditId(null)
          return
        }
        if (rematchId != null) {
          setRematchId(null)
          setRematchResults([])
          setRematchError('')
          return
        }
        if (drawer || drawerLoading) {
          drawerReqRef.current += 1
          setDrawer(null)
          setDrawerLoading(false)
          setDrawerHealth(null)
        }
        return
      }

      if (typing) return

      if (e.key === '/' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k')) {
        e.preventDefault()
        const el = document.getElementById('wtf-admin-search') as HTMLInputElement | null
        el?.focus()
        el?.select()
        return
      }

      if (e.key >= '1' && e.key <= '8' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const idx = Number(e.key) - 1
        const next = SECTIONS[idx]
        if (next) setSection(next)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // setSection is stable enough (closes over setSearchParams)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawer, drawerLoading, editId, rematchId])

  return (
    <div className="app-shell admin-shell page-enter">
      {flash ? (
        <span className="admin-toast" role="status" aria-live="polite">
          {flash}
        </span>
      ) : null}
      <TopBar
        badge="Admin"
        hideNav
        actions={
          <>
            <Link className="topbar-link" to="/">
              Cinema
            </Link>
            <button className="btn btn-ghost" type="button" onClick={() => void logout()}>
              Log out
            </button>
          </>
        }
      />

      <div className="admin-layout">
        <aside className="admin-rail" aria-label="Admin sections">
          <div className="admin-rail-brand">
            <p className="admin-kicker">Control room</p>
            <strong>Manage</strong>
          </div>
          {tabGroups.map((group) => (
            <div key={group.label} className="admin-rail-group">
              <p className="admin-rail-label">{group.label}</p>
              <nav className="admin-rail-nav">
                {group.items.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={section === t.id ? 'active' : ''}
                    onClick={() => setSection(t.id)}
                  >
                    <span>{t.label}</span>
                    {t.hint ? <span className="admin-tab-count">{t.hint}</span> : null}
                  </button>
                ))}
              </nav>
            </div>
          ))}
        </aside>

        <main className="admin-page">
          <header className="admin-header">
            <div>
              <p className="admin-kicker">{activeTabLabel}</p>
              <h1>{activeTabLabel}</h1>
              <p className="muted">
                {section === 'overview'
                  ? 'Pulse of the library — scans, watchers, and quick jumps.'
                  : section === 'now'
                    ? 'Who is watching right now across profiles.'
                    : section === 'library'
                      ? 'Browse, rematch, hide, and edit title metadata.'
                      : section === 'unmatched'
                        ? 'Titles without a solid TMDB match — clean these up.'
                        : section === 'activity'
                          ? 'Recent library events and playback progress.'
                          : section === 'convert'
                            ? 'Probe codecs and permanently remux or transcode files.'
                            : section === 'users'
                              ? 'Accounts, roles, and access.'
                              : 'Scan, diagnostics, and maintenance tools.'}
              </p>
            </div>
          </header>

          <div className="admin-content">
        {section === 'overview' ? (
          <OverviewSection
            overview={overview}
            error={overviewError}
            scanning={scanning}
            onRetry={() => void loadOverview()}
            onScan={() => void onScan()}
            onGo={(s, opts) => {
              setSection(s)
              if (opts?.kind) {
                setKind(opts.kind)
                setMatchFilter('all')
              }
              if (s === 'unmatched') setMatchFilter('unmatched')
            }}
            onOpenTitle={(id) => {
              setSection('library')
              void openDrawer(id)
            }}
          />
        ) : null}

        {section === 'now' ? (
          <NowPlayingSection
            sessions={sessions}
            includeStale={includeStale}
            onIncludeStale={setIncludeStale}
            onRefresh={() => void loadNowPlaying()}
            onOpenTitle={(id) => {
              setSection('library')
              void openDrawer(id)
            }}
            onClear={(path) => void clearFileProgress(path)}
          />
        ) : null}

        {section === 'library' || section === 'unmatched' ? (
          <>
            <div className="admin-toolbar">
              <input
                id="wtf-admin-search"
                className="admin-input"
                type="search"
                placeholder="Search title or TMDB id…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                autoFocus
              />
              <select
                className="admin-select"
                value={kind}
                onChange={(e) => setKind(e.target.value as 'movie' | 'tv' | '')}
              >
                <option value="">All kinds</option>
                <option value="movie">Movies</option>
                <option value="tv">TV</option>
              </select>
              {section === 'library' ? (
                <>
                  <select
                    className="admin-select"
                    value={matchFilter}
                    onChange={(e) =>
                      setMatchFilter(e.target.value as 'all' | 'matched' | 'unmatched')
                    }
                  >
                    <option value="all">All match states</option>
                    <option value="matched">Matched</option>
                    <option value="unmatched">Unmatched</option>
                  </select>
                  <label className="admin-check">
                    <input
                      type="checkbox"
                      checked={showHidden}
                      onChange={(e) => setShowHidden(e.target.checked)}
                    />
                    Show hidden
                  </label>
                </>
              ) : (
                <div className="admin-toolbar-actions">
                  <button
                    className="btn btn-ghost btn-sm"
                    type="button"
                    disabled={selected.size === 0 || busyId === -1}
                    onClick={() => void bulkHideSelected()}
                  >
                    Hide selected ({selected.size})
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    type="button"
                    disabled={busyId === -1 || titles.length === 0}
                    onClick={() => void bulkHideAllUnmatched()}
                  >
                    Hide all unmatched
                  </button>
                </div>
              )}
              <span className="muted admin-count">
                {loading ? 'Loading…' : `${titles.length} titles`}
              </span>
            </div>

            {error ? (
              <div className="empty-state admin-empty">
                <h2>Couldn’t load titles</h2>
                <p>{error}</p>
                <button className="btn btn-primary" type="button" onClick={() => void loadTitles()}>
                  Retry
                </button>
              </div>
            ) : loading ? (
              <SkeletonRows rows={8} />
            ) : titles.length === 0 ? (
              <div className="empty-state admin-empty">
                <h2>{section === 'unmatched' ? 'No unmatched titles' : 'No titles found'}</h2>
                <p>
                  {section === 'unmatched'
                    ? 'Everything has a TMDB id, or the library hasn’t been scanned yet.'
                    : 'Try a different search, or run a library scan from Tools.'}
                </p>
              </div>
            ) : (
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      {section === 'unmatched' ? (
                        <th className="col-check">
                          <input
                            type="checkbox"
                            aria-label="Select all"
                            checked={selected.size > 0 && selected.size === titles.length}
                            onChange={(e) => {
                              setSelected(
                                e.target.checked ? new Set(titles.map((t) => t.id)) : new Set(),
                              )
                            }}
                          />
                        </th>
                      ) : null}
                      <th className="col-poster" />
                      <th>Title</th>
                      <th>Kind</th>
                      <th>Year</th>
                      <th>Files</th>
                      <th>TMDB</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {titles.map((t) => {
                      const detailPath = t.kind === 'movie' ? `/movie/${t.id}` : `/tv/${t.id}`
                      const isEditing = editId === t.id
                      const isRematching = rematchId === t.id
                      return (
                        <tr
                          key={t.id}
                          className={[
                            t.unmatched ? 'is-unmatched' : '',
                            t.hidden ? 'is-hidden' : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                        >
                          {section === 'unmatched' ? (
                            <td className="col-check">
                              <input
                                type="checkbox"
                                checked={selected.has(t.id)}
                                onChange={(e) => {
                                  setSelected((prev) => {
                                    const next = new Set(prev)
                                    if (e.target.checked) next.add(t.id)
                                    else next.delete(t.id)
                                    return next
                                  })
                                }}
                              />
                            </td>
                          ) : null}
                          <td className="col-poster">
                            <button
                              type="button"
                              className="admin-thumb-btn"
                              onClick={() => void openDrawer(t.id)}
                              title="Details"
                            >
                              <div className="admin-thumb">
                                {t.poster ? (
                                  <img src={t.poster} alt="" loading="lazy" />
                                ) : (
                                  <span>?</span>
                                )}
                              </div>
                            </button>
                          </td>
                          <td>
                            <div className="admin-title-cell">
                              <button
                                type="button"
                                className="linkish admin-title-link"
                                onClick={() => void openDrawer(t.id)}
                              >
                                <strong>{t.title}</strong>
                              </button>
                              {section === 'unmatched' && t.files?.length ? (
                                <span className="muted" style={{ fontSize: '0.8rem' }}>
                                  {t.files
                                    .slice(0, 3)
                                    .map((f) => f.filename)
                                    .join(' · ')}
                                  {t.files.length > 3 ? ` · +${t.files.length - 3} more` : ''}
                                </span>
                              ) : null}
                              <div className="admin-badges">
                                {t.unmatched ? (
                                  <span className="badge warn">Unmatched</span>
                                ) : null}
                                {t.hidden ? (
                                  <span className="badge muted-badge">Hidden</span>
                                ) : null}
                              </div>
                            </div>
                            {isEditing ? (
                              <div className="admin-inline-form">
                                <input
                                  className="admin-input"
                                  value={editTitle}
                                  onChange={(e) => setEditTitle(e.target.value)}
                                  placeholder="Title"
                                />
                                <input
                                  className="admin-input admin-input-year"
                                  value={editYear}
                                  onChange={(e) => setEditYear(e.target.value)}
                                  placeholder="Year"
                                  inputMode="numeric"
                                />
                                <button
                                  className="btn btn-primary btn-sm"
                                  type="button"
                                  disabled={busyId === t.id}
                                  onClick={() => void saveEdit()}
                                >
                                  Save
                                </button>
                                <button
                                  className="btn btn-ghost btn-sm"
                                  type="button"
                                  onClick={() => setEditId(null)}
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : null}
                            {isRematching ? (
                              <RematchPanel
                                query={rematchQuery}
                                kind={rematchKind}
                                results={rematchResults}
                                searching={rematchSearching}
                                error={rematchError}
                                busy={busyId === t.id}
                                onQuery={setRematchQuery}
                                onKind={setRematchKind}
                                onSearch={() => void runTmdbSearch()}
                                onApply={(id) => void applyRematch(id)}
                                onAuto={() => void applyRematch()}
                                onCancel={() => setRematchId(null)}
                              />
                            ) : null}
                          </td>
                          <td>
                            <span className="kind-pill">{t.kind}</span>
                          </td>
                          <td>{t.year ?? '—'}</td>
                          <td>
                            <button
                              className="linkish"
                              type="button"
                              onClick={() => void openDrawer(t.id)}
                            >
                              {t.fileCount}
                            </button>
                          </td>
                          <td>
                            <code className={t.unmatched ? 'error-text' : ''}>
                              {t.unmatched ? '—' : t.tmdbId}
                            </code>
                          </td>
                          <td>
                            <div className="admin-actions">
                              <button
                                className="btn btn-ghost btn-sm"
                                type="button"
                                onClick={() => openEdit(t)}
                              >
                                Edit
                              </button>
                              <button
                                className="btn btn-ghost btn-sm"
                                type="button"
                                onClick={() => openRematch(t)}
                              >
                                Rematch
                              </button>
                              <button
                                className="btn btn-ghost btn-sm"
                                type="button"
                                disabled={busyId === t.id}
                                onClick={() => void toggleHide(t)}
                              >
                                {t.hidden ? 'Unhide' : 'Hide'}
                              </button>
                              {!t.hidden ? (
                                <Link className="btn btn-ghost btn-sm" to={detailPath}>
                                  Open
                                </Link>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : null}

        {section === 'activity' ? (
          <ActivitySection
            events={activityEvents}
            progress={activityProgress}
            tab={activityTab}
            onTab={setActivityTab}
            onRefresh={() => void loadActivity()}
            onOpenTitle={(id) => {
              setSection('library')
              void openDrawer(id)
            }}
            onClear={(path) => void clearFileProgress(path).then(() => loadActivity())}
            onMarkWatched={(path, duration) =>
              void markFileWatched(path, duration).then(() => loadActivity())
            }
          />
        ) : null}

        {section === 'convert' ? <ConvertSection notify={notify} /> : null}

        {section === 'users' ? <UsersSection currentUser={user} notify={notify} /> : null}

        {section === 'tools' ? (
          <ToolsSection
            scanning={scanning}
            scanMsg={scanMsg}
            scanStatus={scanStatus}
            diag={diag}
            diagError={diagError}
            onScan={() => void onScan()}
            onRefreshDiag={() => void loadDiagnostics()}
          />
        ) : null}
          </div>
        </main>
      </div>

      {drawer || drawerLoading ? (
        <aside className="admin-drawer" role="dialog" aria-modal="true" aria-label="Title details">
          <div className="admin-drawer-head">
            <h2>{drawer?.title ?? 'Loading…'}</h2>
            <button
              className="btn btn-ghost btn-sm"
              type="button"
              onClick={() => {
                drawerReqRef.current += 1
                setDrawer(null)
                setDrawerLoading(false)
              }}
            >
              Close
            </button>
          </div>
          {drawerLoading && !drawer ? (
            <SkeletonRows rows={4} />
          ) : drawer ? (
            <div className="admin-drawer-body">
              <div className="admin-drawer-meta">
                <div className="admin-thumb lg">
                  {drawer.poster ? <img src={drawer.poster} alt="" /> : <span>?</span>}
                </div>
                <div>
                  <p className="muted">
                    {drawer.kind.toUpperCase()}
                    {drawer.year ? ` · ${drawer.year}` : ''}
                    {drawer.unmatched ? ' · unmatched' : ` · TMDB ${drawer.tmdbId}`}
                  </p>
                  <div className="admin-actions" style={{ marginTop: '0.65rem' }}>
                    <button
                      className="btn btn-ghost btn-sm"
                      type="button"
                      onClick={() => openRematch(drawer)}
                    >
                      Rematch
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      type="button"
                      disabled={busyId === drawer.id}
                      onClick={() => void toggleHide(drawer)}
                    >
                      {drawer.hidden ? 'Unhide' : 'Hide'}
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      type="button"
                      disabled={busyId === drawer.id}
                      onClick={() => void markTitleWatched(drawer.id)}
                    >
                      Mark watched
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      type="button"
                      disabled={busyId === drawer.id}
                      onClick={() => void clearTitleProgress(drawer.id)}
                    >
                      Clear progress
                    </button>
                    {!drawer.hidden ? (
                      <Link
                        className="btn btn-primary btn-sm"
                        to={drawer.kind === 'movie' ? `/movie/${drawer.id}` : `/tv/${drawer.id}`}
                      >
                        Open
                      </Link>
                    ) : null}
                  </div>
                  <div className="admin-inline-form" style={{ marginTop: '0.75rem' }}>
                    <input
                      className="admin-input admin-input-year"
                      type="number"
                      inputMode="numeric"
                      placeholder="Merge into title id"
                      value={mergeTargetId}
                      onChange={(e) => setMergeTargetId(e.target.value)}
                      aria-label="Merge into title id"
                    />
                    <button
                      className="btn btn-ghost btn-sm"
                      type="button"
                      disabled={busyId === drawer.id || !mergeTargetId.trim()}
                      onClick={() => void mergeDrawerIntoTarget()}
                    >
                      Merge
                    </button>
                  </div>
                </div>
              </div>

              {drawer.kind === 'tv' && !drawer.unmatched && drawerHealth ? (
                <div className="admin-drawer-health">
                  <h3 className="admin-drawer-sub">
                    Episode health{' '}
                    <span className="muted">
                      {drawerHealth.present}/{drawerHealth.expected}
                    </span>
                  </h3>
                  {drawerHealth.expected === 0 ? (
                    <p className="muted">No episode list available.</p>
                  ) : drawerHealth.missing.length === 0 ? (
                    <p className="muted">All known episodes present.</p>
                  ) : (
                    <ul className="missing-list">
                      {drawerHealth.missing.slice(0, 20).map((m) => (
                        <li key={`${m.season}x${m.episode}`}>
                          S{String(m.season).padStart(2, '0')}E
                          {String(m.episode).padStart(2, '0')} · {m.name}
                        </li>
                      ))}
                      {drawerHealth.missing.length > 20 ? (
                        <li className="muted">…and {drawerHealth.missing.length - 20} more</li>
                      ) : null}
                    </ul>
                  )}
                </div>
              ) : null}

              {rematchId === drawer.id ? (
                <RematchPanel
                  query={rematchQuery}
                  kind={rematchKind}
                  results={rematchResults}
                  searching={rematchSearching}
                  error={rematchError}
                  busy={busyId === drawer.id}
                  onQuery={setRematchQuery}
                  onKind={setRematchKind}
                  onSearch={() => void runTmdbSearch()}
                  onApply={(id) => void applyRematch(id)}
                  onAuto={() => void applyRematch()}
                  onCancel={() => setRematchId(null)}
                />
              ) : null}

              <h3 className="admin-drawer-sub">Files ({drawer.files?.length ?? 0})</h3>
              {!drawer.files?.length ? (
                <p className="muted">No files linked.</p>
              ) : (
                <ul className="admin-file-detail">
                  {drawer.files.map((f) => {
                    const pct =
                      f.progress && f.progress.duration > 0
                        ? Math.round((f.progress.position / f.progress.duration) * 100)
                        : null
                    return (
                      <li key={f.path}>
                        <div className="admin-file-detail-main">
                          <strong>
                            {drawer.kind === 'tv'
                              ? episodeLabel(f.season, f.episode)
                              : f.filename}
                            {f.preferred ? (
                              <span className="version-pill preferred" style={{ marginLeft: '0.4rem' }}>
                                Preferred
                              </span>
                            ) : null}
                          </strong>
                          <span className="muted">
                            {drawer.kind === 'tv' ? f.filename : formatBytes(f.size)}
                            {f.episodeName ? ` · ${f.episodeName}` : ''}
                          </span>
                          <div className="codec-row">
                            {f.preferred ? <span className="codec-badge ok">Preferred</span> : null}
                            {f.canDirect ? (
                              <span className="codec-badge ok">Direct</span>
                            ) : f.playbackMode === 'remux' ? (
                              <span className="codec-badge warn">Remux</span>
                            ) : f.playbackMode === 'transcode' ? (
                              <span className="codec-badge bad">Transcode</span>
                            ) : (
                              <span className="codec-badge muted">Unknown</span>
                            )}
                            {(f.videoCodec || f.audioCodec || f.container) && (
                              <span className="muted" style={{ fontSize: '0.78rem' }}>
                                {[f.container, f.videoCodec, f.audioCodec].filter(Boolean).join(' · ')}
                              </span>
                            )}
                          </div>
                          {pct != null ? (
                            <div className="admin-mini-bar" title={`${pct}%`}>
                              <i style={{ width: `${pct}%` }} />
                            </div>
                          ) : (
                            <span className="muted" style={{ fontSize: '0.78rem' }}>
                              No progress
                            </span>
                          )}
                        </div>
                        <div className="admin-actions">
                          <Link
                            className="btn btn-ghost btn-sm"
                            to={`/play?path=${encodeURIComponent(f.path)}&titleId=${drawer.id}&kind=${drawer.kind}`}
                          >
                            Play
                          </Link>
                          <button
                            className="btn btn-ghost btn-sm"
                            type="button"
                            title={f.path}
                            onClick={() => {
                              void navigator.clipboard.writeText(f.path).then(
                                () => notify('Path copied'),
                                () => notify('Could not copy path'),
                              )
                            }}
                          >
                            Copy path
                          </button>
                          <button
                            className="btn btn-ghost btn-sm"
                            type="button"
                            onClick={() => {
                              void (async () => {
                                try {
                                  const res = await api.convertEnqueue({
                                    path: f.path,
                                    mode: 'auto',
                                    replaceOriginal: true,
                                    deleteOriginal: false,
                                  })
                                  if (res.enqueued) {
                                    notify('Queued convert (replace on, keep original)')
                                    setSection('convert')
                                  } else {
                                    notify(res.errors[0] || 'Enqueue failed')
                                  }
                                } catch (err) {
                                  notify(err instanceof Error ? err.message : 'Enqueue failed')
                                }
                              })()
                            }}
                          >
                            Convert
                          </button>
                          <button
                            className="btn btn-ghost btn-sm"
                            type="button"
                            onClick={() => {
                              if (!window.confirm('Remove this file from the library index?')) return
                              const deleteDisk = window.confirm(
                                'Also delete the file on disk? Requires LOCAL_MEDIA_ROOT.\nOK = delete file · Cancel = index only',
                              )
                              void (async () => {
                                try {
                                  const res = await api.adminDeleteFile(f.path, deleteDisk)
                                  if (deleteDisk && res.diskDeleted) {
                                    notify('Deleted from index + disk')
                                  } else if (deleteDisk && !res.diskDeleted) {
                                    notify('Removed from index (disk file unavailable)')
                                  } else {
                                    notify('Removed from index')
                                  }
                                  if (drawer) await openDrawer(drawer.id)
                                  await loadTitles()
                                } catch (err) {
                                  notify(err instanceof Error ? err.message : 'Delete failed')
                                }
                              })()
                            }}
                          >
                            Delete
                          </button>
                          <button
                            className="btn btn-ghost btn-sm"
                            type="button"
                            disabled={Boolean(f.preferred)}
                            onClick={() => {
                              if (!drawer) return
                              void (async () => {
                                try {
                                  await api.adminPreferFile(drawer.id, f.path)
                                  notify('Preferred version set')
                                  await openDrawer(drawer.id)
                                } catch (err) {
                                  notify(err instanceof Error ? err.message : 'Prefer failed')
                                }
                              })()
                            }}
                          >
                            {f.preferred ? 'Preferred' : 'Prefer'}
                          </button>
                          <button
                            className="btn btn-ghost btn-sm"
                            type="button"
                            onClick={() => void markFileWatched(f.path, f.progress?.duration)}
                          >
                            Watched
                          </button>
                          <button
                            className="btn btn-ghost btn-sm"
                            type="button"
                            onClick={() => void clearFileProgress(f.path)}
                          >
                            Clear
                          </button>
                        </div>
                        <div className="admin-inline-form" style={{ marginTop: '0.45rem' }}>
                          <input
                            className="admin-input admin-input-year"
                            type="number"
                            inputMode="numeric"
                            placeholder="Title id"
                            value={reassignTargets[f.path] ?? ''}
                            onChange={(e) =>
                              setReassignTargets((prev) => ({
                                ...prev,
                                [f.path]: e.target.value,
                              }))
                            }
                            aria-label={`Reassign ${f.filename} to title id`}
                          />
                          <button
                            className="btn btn-ghost btn-sm"
                            type="button"
                            disabled={!reassignTargets[f.path]?.trim()}
                            onClick={() => void reassignDrawerFile(f.path)}
                          >
                            Reassign
                          </button>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          ) : null}
        </aside>
      ) : null}
    </div>
  )
}

function RematchPanel(props: {
  query: string
  kind: 'movie' | 'tv'
  results: TmdbSearchResult[]
  searching: boolean
  error: string
  busy: boolean
  onQuery: (v: string) => void
  onKind: (v: 'movie' | 'tv') => void
  onSearch: () => void
  onApply: (tmdbId?: number) => void
  onAuto: () => void
  onCancel: () => void
}) {
  return (
    <div className="admin-rematch">
      <div className="admin-inline-form">
        <input
          className="admin-input"
          value={props.query}
          onChange={(e) => props.onQuery(e.target.value)}
          placeholder="TMDB search…"
          onKeyDown={(e) => {
            if (e.key === 'Enter') props.onSearch()
          }}
        />
        <select
          className="admin-select"
          value={props.kind}
          onChange={(e) => props.onKind(e.target.value as 'movie' | 'tv')}
        >
          <option value="movie">Movie</option>
          <option value="tv">TV</option>
        </select>
        <button
          className="btn btn-primary btn-sm"
          type="button"
          disabled={props.searching}
          onClick={props.onSearch}
        >
          {props.searching ? 'Searching…' : 'Search'}
        </button>
        <button
          className="btn btn-ghost btn-sm"
          type="button"
          disabled={props.busy}
          onClick={props.onAuto}
        >
          Auto-apply first
        </button>
        <button className="btn btn-ghost btn-sm" type="button" onClick={props.onCancel}>
          Cancel
        </button>
      </div>
      {props.error ? <p className="error-text">{props.error}</p> : null}
      {props.results.length > 0 ? (
        <ul className="admin-tmdb-results">
          {props.results.map((r) => (
            <li key={r.tmdbId}>
              <div className="admin-thumb sm">
                {r.poster ? <img src={r.poster} alt="" loading="lazy" /> : <span>?</span>}
              </div>
              <div>
                <strong>
                  {r.title}
                  {r.year ? ` (${r.year})` : ''}
                </strong>
                <span className="muted">
                  TMDB {r.tmdbId}
                  {r.voteAverage ? ` · ★ ${r.voteAverage.toFixed(1)}` : ''}
                </span>
              </div>
              <button
                className="btn btn-primary btn-sm"
                type="button"
                disabled={props.busy}
                onClick={() => props.onApply(r.tmdbId)}
              >
                Apply
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

function OverviewSection(props: {
  overview: AdminOverview | null
  error: string
  scanning: boolean
  onRetry: () => void
  onScan: () => void
  onGo: (s: Section, opts?: { kind?: 'movie' | 'tv' }) => void
  onOpenTitle: (id: number) => void
}) {
  const { overview, error } = props
  if (error && !overview) {
    return (
      <div className="empty-state admin-empty">
        <h2>Couldn’t load overview</h2>
        <p>{error}</p>
        <button className="btn btn-primary" type="button" onClick={props.onRetry}>
          Retry
        </button>
      </div>
    )
  }
  if (!overview) return <SkeletonRows rows={6} />

  const s = overview.stats
  return (
    <div className="admin-overview">
      <div className="admin-section-row" style={{ marginBottom: '1rem' }}>
        <p className="muted" style={{ margin: 0 }}>
          Last scan {relativeAge(overview.lastScan)}
        </p>
        <button
          className="btn btn-primary btn-sm"
          type="button"
          disabled={props.scanning}
          onClick={props.onScan}
        >
          {props.scanning ? 'Scanning…' : 'Scan library'}
        </button>
      </div>
      <div className="admin-stat-grid">
        <StatCard
          label="Movies"
          value={s.movies}
          onClick={() => props.onGo('library', { kind: 'movie' })}
        />
        <StatCard
          label="Shows"
          value={s.shows}
          onClick={() => props.onGo('library', { kind: 'tv' })}
        />
        <StatCard label="Files" value={s.files} sub={`${s.movieFiles} movie · ${s.tvFiles} TV`} />
        <StatCard
          label="Unmatched"
          value={s.unmatched}
          warn={s.unmatched > 0}
          onClick={() => props.onGo('unmatched')}
        />
        <StatCard
          label="Now playing"
          value={overview.nowPlayingCount}
          onClick={() => props.onGo('now')}
        />
        <StatCard
          label="Known runtime"
          value={s.knownDurationHours}
          sub="hours from watched files"
          suffix="h"
        />
        <StatCard
          label="FFmpeg"
          value={overview.ffmpegAvailable ? 'OK' : 'Off'}
          warn={!overview.ffmpegAvailable}
        />
        <StatCard
          label="Last scan"
          value={relativeAge(overview.lastScan)}
          small
          onClick={() => props.onGo('tools')}
        />
      </div>

      <section className="admin-panel">
        <div className="section-head admin-section-row">
          <h2>Now playing</h2>
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => props.onGo('now')}>
            View all
          </button>
        </div>
        {overview.nowPlaying.length === 0 ? (
          <p className="muted">Nobody is watching right now.</p>
        ) : (
          <ul className="admin-np-list compact">
            {overview.nowPlaying.map((sess) => (
              <NowPlayingRow
                key={sess.clientId}
                session={sess}
                onOpenTitle={props.onOpenTitle}
              />
            ))}
          </ul>
        )}
      </section>

      <section className="admin-panel">
        <div className="section-head">
          <h2>Recently added</h2>
        </div>
        {overview.recent.length === 0 ? (
          <p className="muted">Scan the library to populate recent titles.</p>
        ) : (
          <ul className="admin-recent-grid">
            {overview.recent.map((t) => (
              <li key={t.id}>
                <button type="button" onClick={() => props.onOpenTitle(t.id)}>
                  <div className="admin-thumb">
                    {t.poster ? <img src={t.poster} alt="" loading="lazy" /> : <span>?</span>}
                  </div>
                  <span>
                    <strong>{t.title}</strong>
                    <em className="muted">{relativeAge(t.scannedAt)}</em>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function StatCard(props: {
  label: string
  value: string | number
  sub?: string
  warn?: boolean
  small?: boolean
  suffix?: string
  onClick?: () => void
}) {
  const className = `admin-stat-card${props.warn ? ' warn' : ''}${props.onClick ? ' clickable' : ''}`
  const inner = (
    <>
      <span className="admin-stat-label">{props.label}</span>
      <strong className={props.small ? 'small' : ''}>
        {props.value}
        {props.suffix ? <span className="suffix">{props.suffix}</span> : null}
      </strong>
      {props.sub ? <span className="muted">{props.sub}</span> : null}
    </>
  )
  if (props.onClick) {
    return (
      <button type="button" className={className} onClick={props.onClick}>
        {inner}
      </button>
    )
  }
  return <div className={className}>{inner}</div>
}

function NowPlayingSection(props: {
  sessions: NowPlayingSession[]
  includeStale: boolean
  onIncludeStale: (v: boolean) => void
  onRefresh: () => void
  onOpenTitle?: (id: number) => void
  onClear?: (path: string) => void
}) {
  return (
    <div className="admin-now">
      <div className="admin-toolbar">
        <label className="admin-check">
          <input
            type="checkbox"
            checked={props.includeStale}
            onChange={(e) => props.onIncludeStale(e.target.checked)}
          />
          Show stalled / stopped
        </label>
        <button className="btn btn-ghost btn-sm" type="button" onClick={props.onRefresh}>
          Refresh
        </button>
        <span className="muted admin-count">
          Active if heartbeat within ~2 minutes. Remote force-stop isn’t available — last heartbeat
          shown below.
        </span>
      </div>
      {props.sessions.length === 0 ? (
        <div className="empty-state admin-empty">
          <h2>Nothing playing</h2>
          <p>Open the player on any device — heartbeats appear here within a few seconds.</p>
        </div>
      ) : (
        <ul className="admin-np-list">
          {props.sessions.map((s) => (
            <NowPlayingRow
              key={s.clientId}
              session={s}
              detailed
              onOpenTitle={props.onOpenTitle}
              onClear={props.onClear}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function NowPlayingRow(props: {
  session: NowPlayingSession
  detailed?: boolean
  onOpenTitle?: (id: number) => void
  onPlay?: (path: string, titleId: number) => void
  onClear?: (path: string) => void
}) {
  const s = props.session
  const ep =
    s.kind === 'tv' && s.season != null && s.episode != null
      ? episodeLabel(s.season, s.episode)
      : null
  const playHref =
    s.path && s.titleId != null
      ? `/play?path=${encodeURIComponent(s.path)}&titleId=${s.titleId}${s.kind ? `&kind=${s.kind}` : ''}`
      : null
  return (
    <li className={`admin-np-row status-${s.status}`}>
      <div className="admin-thumb">
        {s.poster ? <img src={s.poster} alt="" /> : <span>?</span>}
      </div>
      <div className="admin-np-body">
        <div className="admin-np-title">
          <strong>{s.titleName || s.filename || 'Unknown title'}</strong>
          {ep ? <span className="badge">{ep}</span> : null}
          <span className={`badge status-badge ${s.status}`}>{s.status}</span>
        </div>
        <div className="admin-mini-bar">
          <i style={{ width: `${s.progressPct}%` }} />
        </div>
        <div className="muted admin-np-meta">
          {formatTime(s.position)}
          {s.duration > 0 ? ` / ${formatTime(s.duration)}` : ''}
          {s.playbackMode ? ` · ${s.playbackMode}` : ''}
          {' · '}
          heartbeat {relativeAge(s.lastSeenAt)}
          {props.detailed && s.idleSeconds >= 0 ? ` (${s.idleSeconds}s idle)` : ''}
        </div>
        {props.detailed ? (
          <div className="muted admin-np-meta">
            Client {s.clientId.slice(0, 8)}…
            {s.ip ? ` · ${s.ip}` : ''}
            {s.userAgent ? ` · ${s.userAgent.slice(0, 64)}` : ''}
          </div>
        ) : null}
        <div className="admin-actions" style={{ marginTop: '0.45rem' }}>
          {s.titleId != null && props.onOpenTitle ? (
            <button
              className="btn btn-ghost btn-sm"
              type="button"
              onClick={() => props.onOpenTitle?.(s.titleId!)}
            >
              Open
            </button>
          ) : null}
          {props.detailed && playHref ? (
            <Link
              className="btn btn-ghost btn-sm"
              to={playHref}
              onClick={() => {
                if (s.path && s.titleId != null) props.onPlay?.(s.path, s.titleId)
              }}
            >
              Play
            </Link>
          ) : null}
          {props.detailed && s.path && props.onClear ? (
            <button
              className="btn btn-ghost btn-sm"
              type="button"
              onClick={() => props.onClear?.(s.path)}
            >
              Clear progress
            </button>
          ) : null}
        </div>
      </div>
    </li>
  )
}

function ActivitySection(props: {
  events: ActivityEvent[]
  progress: ActivityProgress[]
  tab: 'events' | 'progress'
  onTab: (t: 'events' | 'progress') => void
  onRefresh: () => void
  onOpenTitle?: (id: number) => void
  onClear?: (path: string) => void
  onMarkWatched?: (path: string, duration?: number) => void
}) {
  return (
    <div className="admin-activity">
      <div className="admin-toolbar">
        <button
          type="button"
          className={`btn btn-sm ${props.tab === 'progress' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => props.onTab('progress')}
        >
          Watch history
        </button>
        <button
          type="button"
          className={`btn btn-sm ${props.tab === 'events' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => props.onTab('events')}
        >
          Session events
        </button>
        <button className="btn btn-ghost btn-sm" type="button" onClick={props.onRefresh}>
          Refresh
        </button>
      </div>

      {props.tab === 'progress' ? (
        props.progress.length === 0 ? (
          <div className="empty-state admin-empty">
            <h2>No watch history yet</h2>
            <p>Progress updates from the player show up here.</p>
          </div>
        ) : (
          <ul className="admin-activity-list">
            {props.progress.map((p) => {
              const pct =
                p.duration > 0 ? Math.round((p.position / p.duration) * 100) : 0
              const playHref = `/play?path=${encodeURIComponent(p.path)}&titleId=${p.titleId}&kind=${p.kind}`
              return (
                <li key={`${p.path}-${p.updatedAt}`}>
                  <div className="admin-thumb sm">
                    {p.poster ? <img src={p.poster} alt="" /> : <span>?</span>}
                  </div>
                  <div>
                    <strong>
                      {p.title}
                      {p.kind === 'tv' && p.season != null
                        ? ` · ${episodeLabel(p.season, p.episode)}`
                        : ''}
                    </strong>
                    <span className="muted">
                      {formatTime(p.position)}
                      {p.duration > 0 ? ` / ${formatTime(p.duration)} (${pct}%)` : ''}
                      {' · '}
                      {relativeAge(p.updatedAt)}
                    </span>
                    <div className="admin-actions" style={{ marginTop: '0.4rem' }}>
                      {props.onOpenTitle ? (
                        <button
                          className="btn btn-ghost btn-sm"
                          type="button"
                          onClick={() => props.onOpenTitle?.(p.titleId)}
                        >
                          Open
                        </button>
                      ) : null}
                      <Link className="btn btn-ghost btn-sm" to={playHref}>
                        Play
                      </Link>
                      {props.onClear ? (
                        <button
                          className="btn btn-ghost btn-sm"
                          type="button"
                          onClick={() => props.onClear?.(p.path)}
                        >
                          Clear
                        </button>
                      ) : null}
                      {props.onMarkWatched ? (
                        <button
                          className="btn btn-ghost btn-sm"
                          type="button"
                          onClick={() => props.onMarkWatched?.(p.path, p.duration)}
                        >
                          Mark watched
                        </button>
                      ) : null}
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )
      ) : props.events.length === 0 ? (
        <div className="empty-state admin-empty">
          <h2>No session events</h2>
          <p>Play / pause / stop heartbeats will appear here.</p>
        </div>
      ) : (
        <ul className="admin-activity-list">
          {props.events.map((e) => (
            <li key={e.id}>
              <div>
                <strong>
                  <span className="badge">{e.eventType}</span>{' '}
                  {e.titleName || e.path || '—'}
                  {e.season != null && e.episode != null
                    ? ` · ${episodeLabel(e.season, e.episode)}`
                    : ''}
                </strong>
                <span className="muted">
                  {relativeAge(e.createdAt)}
                  {e.detail ? ` · ${e.detail}` : ''}
                  {e.clientId ? ` · ${e.clientId.slice(0, 8)}…` : ''}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ToolsSection(props: {
  scanning: boolean
  scanMsg: string
  scanStatus: ScanStatusResponse | null
  diag: Diagnostics | null
  diagError: string
  onScan: () => void
  onRefreshDiag: () => void
}) {
  const localScan =
    props.diag?.scanSource === 'local' || Boolean(props.diag?.config.localMediaEnabled)
  const progress = props.scanStatus?.status
  const scanErrors = [
    ...(progress?.errors ?? []),
    ...(props.scanStatus?.lastResult?.errors ?? []),
  ]
    .filter(Boolean)
    .slice(0, 20)
  // Dedupe while preserving order
  const uniqueErrors = [...new Set(scanErrors)].slice(0, 20)

  return (
    <div className="admin-scan">
      <section className="admin-panel">
        <div className="section-head">
          <h2>Library scan</h2>
        </div>
        <p className="muted">
          {localScan
            ? 'Scan local disk under LOCAL_MEDIA_ROOT, rematch filenames on TMDB, and rebuild the local index. Titles with a manual override keep their match across scans.'
            : 'Scan WebDAV under MEDIA_ROOT, rematch filenames on TMDB, and rebuild the local index. Titles with a manual override keep their match across scans.'}
        </p>
        <div className="admin-inline-form" style={{ marginTop: '1rem' }}>
          <button
            className="btn btn-primary"
            type="button"
            disabled={props.scanning}
            onClick={props.onScan}
          >
            {props.scanning ? 'Scanning…' : 'Scan library'}
          </button>
          <button className="btn btn-ghost" type="button" onClick={props.onRefreshDiag}>
            Refresh diagnostics
          </button>
        </div>
        {props.scanning ? (
          (() => {
            const listing = !progress || progress.phase === 'listing' || !progress.filesFound
            const pct =
              !listing && progress.filesFound > 0
                ? Math.min(100, Math.round((progress.processed / progress.filesFound) * 100))
                : 0
            return (
              <div style={{ marginTop: '1rem' }}>
                <div
                  className={`admin-progress-bar${listing ? ' indeterminate' : ''}`}
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={listing ? undefined : pct}
                  aria-label="Library scan progress"
                >
                  <i style={{ width: `${listing ? 100 : pct}%` }} />
                </div>
                {progress ? (
                  <ul className="diag-list" style={{ marginTop: '0.75rem' }}>
                    <li>
                      Source: <code>{progress.source}</code> · phase:{' '}
                      <code>{progress.phase}</code>
                      {!listing ? ` · ${pct}%` : ''}
                    </li>
                    <li>
                      Dirs scanned: {progress.dirsScanned} · files found: {progress.filesFound} ·
                      processed: {progress.processed}
                    </li>
                    <li>
                      Matched: {progress.matched} · unmatched: {progress.unmatched}
                    </li>
                    {progress.message ? <li className="muted">{progress.message}</li> : null}
                  </ul>
                ) : null}
              </div>
            )
          })()
        ) : null}
        {props.scanMsg ? (
          <p
            className={
              /fail|missing|tmdb|0 video|error/i.test(props.scanMsg) ? 'error-text' : 'ok-text'
            }
            style={{ marginTop: '1rem' }}
          >
            {props.scanMsg}
          </p>
        ) : null}
        {progress?.phase === 'error' && progress.message && progress.message !== props.scanMsg ? (
          <p className="error-text" style={{ marginTop: '0.5rem' }}>
            {progress.message}
          </p>
        ) : null}
        {uniqueErrors.length > 0 ? (
          <div style={{ marginTop: '0.75rem' }}>
            <p className="muted" style={{ marginBottom: '0.35rem' }}>
              Errors ({uniqueErrors.length}
              {scanErrors.length > uniqueErrors.length ? '+' : ''}):
            </p>
            <ul className="diag-list">
              {uniqueErrors.map((e) => (
                <li key={e} className="error-text" style={{ fontSize: '0.85rem' }}>
                  {e}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section className="admin-panel">
        <div className="section-head">
          <h2>Diagnostics</h2>
        </div>
        {props.diagError ? <p className="error-text">{props.diagError}</p> : null}
        {props.diag ? (
          <ul className="diag-list">
            <li>
              Scan source:{' '}
              <code>{props.diag.scanSource ?? (localScan ? 'local' : 'webdav')}</code>
            </li>
            <li>
              LOCAL_MEDIA_ROOT:{' '}
              <code>{props.diag.config.localMediaRoot || '(not set)'}</code>
            </li>
            <li>
              Local probe:{' '}
              {props.diag.local?.ok ? (
                <span className="ok-text">OK</span>
              ) : props.diag.config.localMediaRoot ? (
                <span className="error-text">Failed</span>
              ) : (
                <span className="muted">n/a</span>
              )}
              {props.diag.local?.resolvedPath ? (
                <>
                  {' '}
                  (<code>{props.diag.local.resolvedPath}</code>)
                </>
              ) : null}
            </li>
            {props.diag.local?.error ? (
              <li className="error-text">{props.diag.local.error}</li>
            ) : null}
            {props.diag.local?.ok && props.diag.local.topEntries.length > 0 ? (
              <li>
                Local top-level:{' '}
                {props.diag.local.topEntries.map((e) => e.name).join(', ')}
              </li>
            ) : null}
            {props.diag.local?.mediaRootFolders?.length ? (
              <li>
                Media-root folders:{' '}
                {props.diag.local.mediaRootFolders
                  .map((f) => `${f.root}${f.exists ? '' : ' (missing)'}`)
                  .join(', ')}
              </li>
            ) : null}
            <li>
              MEDIA_ROOT: <code>{props.diag.config.mediaRoot}</code>
            </li>
            {props.diag.config.mediaRoots?.length ? (
              <li>
                MEDIA_ROOTS: <code>{props.diag.config.mediaRoots.join(', ')}</code>
              </li>
            ) : null}
            <li>
              Scan interval:{' '}
              <code>
                {props.diag.config.scanIntervalMinutes
                  ? `${props.diag.config.scanIntervalMinutes}m`
                  : 'manual only'}
              </code>
            </li>
            <li>
              TMDB key:{' '}
              {props.diag.config.tmdbKeySet ? (
                <span className="ok-text">set</span>
              ) : (
                <span className="error-text">missing — scans will fail until you set TMDB_API_KEY</span>
              )}
            </li>
            <li>
              FFmpeg:{' '}
              {props.diag.playback?.ffmpegAvailable ? (
                <span className="ok-text">available</span>
              ) : (
                <span className="error-text">missing</span>
              )}
            </li>
            {!localScan || props.diag.config.webdavUrlSet ? (
              <>
                <li>
                  WebDAV host: <code>{props.diag.config.webdavHost || '(missing)'}</code>
                  {localScan ? <span className="muted"> (playback fallback)</span> : null}
                </li>
                <li>
                  Credentials:{' '}
                  {props.diag.config.webdavUserSet && props.diag.config.webdavPasswordSet
                    ? 'set'
                    : 'missing'}
                </li>
                {!props.diag.webdav.skipped ? (
                  <>
                    <li>
                      WebDAV probe:{' '}
                      {props.diag.webdav.ok ? (
                        <span className="ok-text">OK</span>
                      ) : (
                        <span className="error-text">Failed</span>
                      )}
                    </li>
                    {props.diag.webdav.error ? (
                      <li className="error-text">{props.diag.webdav.error}</li>
                    ) : null}
                    {props.diag.webdav.ok && props.diag.webdav.mediaEntries.length > 0 ? (
                      <li>
                        Under MEDIA_ROOT:{' '}
                        {props.diag.webdav.mediaEntries.map((e) => e.name).join(', ')}
                      </li>
                    ) : null}
                  </>
                ) : (
                  <li className="muted">WebDAV probe skipped (local scan active)</li>
                )}
              </>
            ) : null}
          </ul>
        ) : (
          <p className="muted">Running diagnostics…</p>
        )}
      </section>

      <section className="admin-panel">
        <div className="section-head">
          <h2>Consolidate notes</h2>
        </div>
        <ul className="diag-list">
          <li>Prefer Rematch / Merge over deleting files — soft-hide keeps progress intact.</li>
          <li>Manual edits set an override so the next scan won’t steal the match.</li>
          <li>Bulk-hide unmatched junk from the Unmatched tab when filenames are noise.</li>
          <li>Now Playing uses per-tab client ids; each signed-in user has their own account.</li>
        </ul>
      </section>
    </div>
  )
}

function UsersSection(props: { currentUser: AuthUser; notify: (msg: string) => void }) {
  const [users, setUsers] = useState<AuthUser[]>([])
  const [loading, setLoading] = useState(true)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<'user' | 'admin'>('user')

  async function refresh() {
    setLoading(true)
    try {
      const res = await api.adminUsers()
      setUsers(res.users)
    } catch (err) {
      props.notify(err instanceof Error ? err.message : 'Failed to load users')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="admin-convert">
      <section className="admin-card">
        <div className="section-head">
          <h2>Create user</h2>
        </div>
        <form
          className="admin-inline-form"
          onSubmit={(e) => {
            e.preventDefault()
            void (async () => {
              try {
                await api.adminCreateUser({ username, password, role })
                props.notify(`Created ${username}`)
                setUsername('')
                setPassword('')
                setRole('user')
                await refresh()
              } catch (err) {
                props.notify(err instanceof Error ? err.message : 'Create failed')
              }
            })()
          }}
        >
          <input
            className="admin-input"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            minLength={3}
          />
          <input
            className="admin-input"
            type="password"
            placeholder="Password (8+)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
          />
          <select
            className="admin-select"
            value={role}
            onChange={(e) => setRole(e.target.value as 'user' | 'admin')}
          >
            <option value="user">User</option>
            <option value="admin">Admin</option>
          </select>
          <button className="btn btn-primary" type="submit">
            Add
          </button>
        </form>
        <p className="muted">
          First account on a fresh install is always admin. Public self-register is off unless{' '}
          <code>ALLOW_PUBLIC_REGISTRATION=true</code>.
        </p>
      </section>

      <section className="admin-card">
        <div className="section-head">
          <h2>Accounts</h2>
          <button className="btn btn-ghost" type="button" onClick={() => void refresh()}>
            Refresh
          </button>
        </div>
        {loading ? (
          <SkeletonRows rows={4} />
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <strong>{u.username}</strong>
                      {u.id === props.currentUser.id ? (
                        <span className="muted"> · you</span>
                      ) : null}
                    </td>
                    <td>
                      <select
                        value={u.role}
                        disabled={u.id === props.currentUser.id}
                        onChange={(e) => {
                          const next = e.target.value as 'admin' | 'user'
                          void api
                            .adminPatchUser(u.id, { role: next })
                            .then(() => refresh())
                            .catch((err) =>
                              props.notify(err instanceof Error ? err.message : 'Update failed'),
                            )
                        }}
                      >
                        <option value="user">User</option>
                        <option value="admin">Admin</option>
                      </select>
                    </td>
                    <td>{u.disabled ? <span className="error-text">Disabled</span> : 'Active'}</td>
                    <td>
                      <div className="admin-actions">
                        <button
                          className="btn btn-ghost btn-sm"
                          type="button"
                          onClick={() => {
                            const next = window.prompt(`New password for ${u.username} (min 8 chars)`)
                            if (next == null) return
                            if (next.trim().length < 8) {
                              props.notify('Password must be at least 8 characters')
                              return
                            }
                            void api
                              .adminPatchUser(u.id, { password: next.trim() })
                              .then(() => props.notify(`Password reset for ${u.username}`))
                              .catch((err) =>
                                props.notify(
                                  err instanceof Error ? err.message : 'Password reset failed',
                                ),
                              )
                          }}
                        >
                          Reset password
                        </button>
                        <button
                          className="btn btn-ghost btn-sm"
                          type="button"
                          disabled={u.id === props.currentUser.id}
                          onClick={() => {
                            void api
                              .adminPatchUser(u.id, { disabled: !u.disabled })
                              .then(() => refresh())
                              .catch((err) =>
                                props.notify(err instanceof Error ? err.message : 'Update failed'),
                              )
                          }}
                        >
                          {u.disabled ? 'Enable' : 'Disable'}
                        </button>
                        <button
                          className="btn btn-ghost btn-sm"
                          type="button"
                          disabled={u.id === props.currentUser.id}
                          onClick={() => {
                            if (!window.confirm(`Delete user ${u.username}?`)) return
                            void api
                              .adminDeleteUser(u.id)
                              .then(() => refresh())
                              .catch((err) =>
                                props.notify(err instanceof Error ? err.message : 'Delete failed'),
                              )
                          }}
                        >
                          Delete
                        </button>
                      </div>
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
