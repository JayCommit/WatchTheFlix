import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import type { DrawerHealth, Section } from '../components/admin'
import type { AdminTitle, TmdbSearchResult } from '../types'

type Options = {
  section: Section
  notify: (msg: string) => void
  onOverviewRefresh?: () => void
  onGoConvert?: () => void
}

export function useAdminLibrary({ section, notify, onOverviewRefresh, onGoConvert }: Options) {
  const [titles, setTitles] = useState<AdminTitle[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [kind, setKind] = useState<'movie' | 'tv' | ''>('')
  const [matchFilter, setMatchFilter] = useState<'all' | 'matched' | 'unmatched'>('all')
  const [showHidden, setShowHidden] = useState(false)
  const [busyId, setBusyId] = useState<number | null>(null)
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
    if (section !== 'library' && section !== 'unmatched') return
    const t = window.setTimeout(() => void loadTitles(), 180)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, q, kind, showHidden, matchFilter])

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
      if (section === 'overview') onOverviewRefresh?.()
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
      if (section === 'overview') onOverviewRefresh?.()
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

  async function bulkHideSelected() {
    if (selected.size === 0) return
    setBusyId(-1)
    try {
      const res = await api.bulkHideUnmatched({ ids: [...selected] })
      notify(`Hidden ${res.hidden} titles`)
      setSelected(new Set())
      await loadTitles()
      onOverviewRefresh?.()
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
      onOverviewRefresh?.()
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
        onGoConvert?.()
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

  function cancelRematch() {
    setRematchId(null)
    setRematchResults([])
    setRematchError('')
  }

  return {
    titles,
    loading,
    error,
    q,
    setQ,
    kind,
    setKind,
    matchFilter,
    setMatchFilter,
    showHidden,
    setShowHidden,
    busyId,
    selected,
    setSelected,
    editId,
    setEditId,
    editTitle,
    setEditTitle,
    editYear,
    setEditYear,
    rematchId,
    setRematchId,
    rematchQuery,
    setRematchQuery,
    rematchKind,
    setRematchKind,
    rematchResults,
    rematchSearching,
    rematchError,
    drawer,
    drawerLoading,
    drawerHealth,
    mergeTargetId,
    setMergeTargetId,
    reassignTargets,
    setReassignTargets,
    loadTitles,
    openEdit,
    saveEdit,
    openRematch,
    runTmdbSearch,
    applyRematch,
    toggleHide,
    openDrawer,
    mergeDrawerIntoTarget,
    reassignDrawerFile,
    bulkHideSelected,
    bulkHideAllUnmatched,
    clearTitleProgress,
    markTitleWatched,
    clearFileProgress,
    markFileWatched,
    convertEnqueueFile,
    deleteDrawerFile,
    preferDrawerFile,
    closeDrawer,
    cancelRematch,
  }
}
