import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, type ScanStatusResponse } from '../api'
import {
  ActivitySection,
  AdminLibrarySection,
  AdminTitleDrawer,
  NowPlayingSection,
  OverviewSection,
  SECTIONS,
  ToolsSection,
  UsersSection,
  isSection,
  type Diagnostics,
  type DrawerHealth,
  type Section,
} from '../components/admin'
import { ConvertSection } from '../components/convert'
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

type Props = {
  user: AuthUser
  onLogout: () => void
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

  async function convertEnqueueFile(path: string) {
    try {
      const res = await api.convertEnqueue({
        path,
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
  }

  async function deleteDrawerFile(path: string) {
    if (!window.confirm('Remove this file from the library index?')) return
    const deleteDisk = window.confirm(
      'Also delete the file on disk? Requires LOCAL_MEDIA_ROOT.\nOK = delete file · Cancel = index only',
    )
    try {
      const res = await api.adminDeleteFile(path, deleteDisk)
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
  }

  async function preferDrawerFile(path: string) {
    if (!drawer) return
    try {
      await api.adminPreferFile(drawer.id, path)
      notify('Preferred version set')
      await openDrawer(drawer.id)
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Prefer failed')
    }
  }

  function closeDrawer() {
    drawerReqRef.current += 1
    setDrawer(null)
    setDrawerLoading(false)
    setDrawerHealth(null)
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
          closeDrawer()
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
          <AdminLibrarySection
            section={section}
            titles={titles}
            loading={loading}
            error={error}
            q={q}
            onQ={setQ}
            kind={kind}
            onKind={setKind}
            matchFilter={matchFilter}
            onMatchFilter={setMatchFilter}
            showHidden={showHidden}
            onShowHidden={setShowHidden}
            selected={selected}
            onSelected={setSelected}
            editId={editId}
            editTitle={editTitle}
            editYear={editYear}
            onEditTitle={setEditTitle}
            onEditYear={setEditYear}
            onSaveEdit={() => void saveEdit()}
            onCancelEdit={() => setEditId(null)}
            rematchId={rematchId}
            rematchQuery={rematchQuery}
            rematchKind={rematchKind}
            rematchResults={rematchResults}
            rematchSearching={rematchSearching}
            rematchError={rematchError}
            onRematchQuery={setRematchQuery}
            onRematchKind={setRematchKind}
            onRematchSearch={() => void runTmdbSearch()}
            onRematchApply={(id) => void applyRematch(id)}
            onRematchAuto={() => void applyRematch()}
            onRematchCancel={() => setRematchId(null)}
            busyId={busyId}
            onRetry={() => void loadTitles()}
            onBulkHideSelected={() => void bulkHideSelected()}
            onBulkHideAllUnmatched={() => void bulkHideAllUnmatched()}
            onOpenDrawer={(id) => void openDrawer(id)}
            onOpenEdit={openEdit}
            onOpenRematch={openRematch}
            onToggleHide={(t) => void toggleHide(t)}
          />
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

      <AdminTitleDrawer
        drawer={drawer}
        drawerLoading={drawerLoading}
        drawerHealth={drawerHealth}
        rematchId={rematchId}
        rematchQuery={rematchQuery}
        rematchKind={rematchKind}
        rematchResults={rematchResults}
        rematchSearching={rematchSearching}
        rematchError={rematchError}
        onRematchQuery={setRematchQuery}
        onRematchKind={setRematchKind}
        onRematchSearch={() => void runTmdbSearch()}
        onRematchApply={(id) => void applyRematch(id)}
        onRematchAuto={() => void applyRematch()}
        onRematchCancel={() => setRematchId(null)}
        mergeTargetId={mergeTargetId}
        onMergeTargetId={setMergeTargetId}
        onMerge={() => void mergeDrawerIntoTarget()}
        reassignTargets={reassignTargets}
        onReassignTarget={(path, value) =>
          setReassignTargets((prev) => ({ ...prev, [path]: value }))
        }
        onReassign={(path) => void reassignDrawerFile(path)}
        busyId={busyId}
        onClose={closeDrawer}
        onOpenRematch={openRematch}
        onToggleHide={(t) => void toggleHide(t)}
        onMarkTitleWatched={(id) => void markTitleWatched(id)}
        onClearTitleProgress={(id) => void clearTitleProgress(id)}
        onMarkFileWatched={(path, duration) => void markFileWatched(path, duration)}
        onClearFileProgress={(path) => void clearFileProgress(path)}
        onPrefer={(path) => void preferDrawerFile(path)}
        onDeleteFile={(path) => void deleteDrawerFile(path)}
        onConvertEnqueue={(path) => void convertEnqueueFile(path)}
        onNotify={notify}
      />
    </div>
  )
}
