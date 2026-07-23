import { useEffect, useMemo, useState } from 'react'
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
  type Section,
} from '../components/admin'
import { ConvertSection } from '../components/convert'
import { TopBar } from '../components/TopBar'
import { useAdminLibrary } from '../hooks/useAdminLibrary'
import type {
  ActivityEvent,
  ActivityProgress,
  AdminOverview,
  AuthUser,
  NowPlayingSession,
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

  const [flash, setFlash] = useState('')
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
      /* surface via overview/tools if needed */
      void err
    }
  }

  async function loadActivity() {
    try {
      const res = await api.adminActivity(60)
      setActivityEvents(res.events)
      setActivityProgress(res.progress)
    } catch {
      /* keep prior activity on failure */
    }
  }

  async function loadDiagnostics() {
    try {
      const d = await api.diagnostics()
      setDiag(d)
      setDiagError('')
    } catch (err) {
      setDiagError(err instanceof Error ? err.message : 'Diagnostics failed')
    }
  }

  const lib = useAdminLibrary({
    section,
    notify,
    onOverviewRefresh: () => void loadOverview(),
    onGoConvert: () => setSection('convert'),
  })

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
      if (section === 'library' || section === 'unmatched') void lib.loadTitles()
    } catch (err) {
      setScanMsg(err instanceof Error ? err.message : 'Scan failed')
    } finally {
      setScanning(false)
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
        if (lib.editId != null) {
          lib.setEditId(null)
          return
        }
        if (lib.rematchId != null) {
          lib.cancelRematch()
          return
        }
        if (lib.drawer || lib.drawerLoading) {
          lib.closeDrawer()
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
  }, [lib.drawer, lib.drawerLoading, lib.editId, lib.rematchId])

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
                    lib.setKind(opts.kind)
                    lib.setMatchFilter('all')
                  }
                  if (s === 'unmatched') lib.setMatchFilter('unmatched')
                }}
                onOpenTitle={(id) => {
                  setSection('library')
                  void lib.openDrawer(id)
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
                  void lib.openDrawer(id)
                }}
                onClear={(path) => void lib.clearFileProgress(path)}
              />
            ) : null}

            {section === 'library' || section === 'unmatched' ? (
              <AdminLibrarySection
                section={section}
                titles={lib.titles}
                loading={lib.loading}
                error={lib.error}
                q={lib.q}
                onQ={lib.setQ}
                kind={lib.kind}
                onKind={lib.setKind}
                matchFilter={lib.matchFilter}
                onMatchFilter={lib.setMatchFilter}
                showHidden={lib.showHidden}
                onShowHidden={lib.setShowHidden}
                selected={lib.selected}
                onSelected={lib.setSelected}
                editId={lib.editId}
                editTitle={lib.editTitle}
                editYear={lib.editYear}
                onEditTitle={lib.setEditTitle}
                onEditYear={lib.setEditYear}
                onSaveEdit={() => void lib.saveEdit()}
                onCancelEdit={() => lib.setEditId(null)}
                rematchId={lib.rematchId}
                rematchQuery={lib.rematchQuery}
                rematchKind={lib.rematchKind}
                rematchResults={lib.rematchResults}
                rematchSearching={lib.rematchSearching}
                rematchError={lib.rematchError}
                onRematchQuery={lib.setRematchQuery}
                onRematchKind={lib.setRematchKind}
                onRematchSearch={() => void lib.runTmdbSearch()}
                onRematchApply={(id) => void lib.applyRematch(id)}
                onRematchAuto={() => void lib.applyRematch()}
                onRematchCancel={() => lib.setRematchId(null)}
                busyId={lib.busyId}
                onRetry={() => void lib.loadTitles()}
                onBulkHideSelected={() => void lib.bulkHideSelected()}
                onBulkHideAllUnmatched={() => void lib.bulkHideAllUnmatched()}
                onOpenDrawer={(id) => void lib.openDrawer(id)}
                onOpenEdit={lib.openEdit}
                onOpenRematch={lib.openRematch}
                onToggleHide={(t) => void lib.toggleHide(t)}
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
                  void lib.openDrawer(id)
                }}
                onClear={(path) => void lib.clearFileProgress(path).then(() => loadActivity())}
                onMarkWatched={(path, duration) =>
                  void lib.markFileWatched(path, duration).then(() => loadActivity())
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
        drawer={lib.drawer}
        drawerLoading={lib.drawerLoading}
        drawerHealth={lib.drawerHealth}
        rematchId={lib.rematchId}
        rematchQuery={lib.rematchQuery}
        rematchKind={lib.rematchKind}
        rematchResults={lib.rematchResults}
        rematchSearching={lib.rematchSearching}
        rematchError={lib.rematchError}
        onRematchQuery={lib.setRematchQuery}
        onRematchKind={lib.setRematchKind}
        onRematchSearch={() => void lib.runTmdbSearch()}
        onRematchApply={(id) => void lib.applyRematch(id)}
        onRematchAuto={() => void lib.applyRematch()}
        onRematchCancel={() => lib.setRematchId(null)}
        mergeTargetId={lib.mergeTargetId}
        onMergeTargetId={lib.setMergeTargetId}
        onMerge={() => void lib.mergeDrawerIntoTarget()}
        reassignTargets={lib.reassignTargets}
        onReassignTarget={(path, value) =>
          lib.setReassignTargets((prev) => ({ ...prev, [path]: value }))
        }
        onReassign={(path) => void lib.reassignDrawerFile(path)}
        busyId={lib.busyId}
        onClose={lib.closeDrawer}
        onOpenRematch={lib.openRematch}
        onToggleHide={(t) => void lib.toggleHide(t)}
        onMarkTitleWatched={(id) => void lib.markTitleWatched(id)}
        onClearTitleProgress={(id) => void lib.clearTitleProgress(id)}
        onMarkFileWatched={(path, duration) => void lib.markFileWatched(path, duration)}
        onClearFileProgress={(path) => void lib.clearFileProgress(path)}
        onPrefer={(path) => void lib.preferDrawerFile(path)}
        onDeleteFile={(path) => void lib.deleteDrawerFile(path)}
        onConvertEnqueue={(path) => void lib.convertEnqueueFile(path)}
        onNotify={notify}
      />
    </div>
  )
}
