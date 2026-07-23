import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import { CinemaShell } from '../components/cinema'
import { PosterCard } from '../components/PosterCard'
import { useLibraryScan } from '../hooks/useLibraryScan'
import type { AuthUser, Title } from '../types'
import { bindSlashToSearch } from '../utils/focusSearch'
import { matchesQuery } from '../utils/titleSearch'

type Mode = 'movies' | 'tv' | 'my-list'
type SortKey = 'title' | 'year' | 'rating' | 'recent'

type Props = {
  mode: Mode
  user: AuthUser
  onLogout: () => void
}

const TITLES: Record<Mode, string> = {
  movies: 'Movies',
  tv: 'TV Shows',
  'my-list': 'My List',
}

function parseSort(raw: string | null, mode: Mode): SortKey {
  if (raw === 'year' || raw === 'rating' || raw === 'recent' || raw === 'title') return raw
  return mode === 'my-list' ? 'recent' : 'title'
}

export function BrowsePage({ mode, user, onLogout }: Props) {
  const [searchParams, setSearchParams] = useSearchParams()
  const [items, setItems] = useState<Title[] | null>(null)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [removingId, setRemovingId] = useState<number | null>(null)

  const genre = searchParams.get('genre') || 'all'
  const sort = parseSort(searchParams.get('sort'), mode)

  async function reloadItems() {
    if (mode === 'my-list') {
      setItems((await api.watchlist()).items)
      return
    }
    const lib = await api.library()
    setItems(mode === 'movies' ? lib.movies : lib.shows)
  }

  const { scanning, onScan } = useLibraryScan({
    enabled: user.role === 'admin',
    onComplete: () => reloadItems(),
  })

  useEffect(() => {
    let cancelled = false
    setItems(null)
    setError('')
    setQuery('')

    const load = async () => {
      try {
        if (mode === 'my-list') {
          const r = await api.watchlist()
          if (!cancelled) setItems(r.items)
          return
        }
        const lib = await api.library()
        if (cancelled) return
        setItems(mode === 'movies' ? lib.movies : lib.shows)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load')
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [mode])

  useEffect(() => bindSlashToSearch(), [])

  const genres = useMemo(() => {
    if (!items) return [] as string[]
    const set = new Set<string>()
    for (const t of items) for (const g of t.genres) set.add(g)
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [items])

  const filtered = useMemo(() => {
    if (!items) return []
    const q = query.trim().toLowerCase()
    const list = items
      .filter((t) => (genre === 'all' ? true : t.genres.includes(genre)))
      .filter((t) => matchesQuery(t, q))

    const sorted = [...list]
    sorted.sort((a, b) => {
      if (sort === 'year') {
        return (b.year ?? 0) - (a.year ?? 0) || a.title.localeCompare(b.title)
      }
      if (sort === 'rating') {
        return (b.voteAverage ?? 0) - (a.voteAverage ?? 0) || a.title.localeCompare(b.title)
      }
      if (sort === 'recent') {
        const at = a.addedAt ?? ''
        const bt = b.addedAt ?? ''
        if (at || bt) return bt.localeCompare(at) || a.title.localeCompare(b.title)
        return (b.year ?? 0) - (a.year ?? 0) || a.title.localeCompare(b.title)
      }
      return a.title.localeCompare(b.title)
    })
    return sorted
  }, [items, query, genre, sort])

  function setGenre(next: string) {
    const nextParams = new URLSearchParams(searchParams)
    if (next === 'all') nextParams.delete('genre')
    else nextParams.set('genre', next)
    setSearchParams(nextParams, { replace: true })
  }

  function setSort(next: SortKey) {
    const nextParams = new URLSearchParams(searchParams)
    const defaultSort = mode === 'my-list' ? 'recent' : 'title'
    if (next === defaultSort) nextParams.delete('sort')
    else nextParams.set('sort', next)
    setSearchParams(nextParams, { replace: true })
  }

  async function removeFromList(title: Title) {
    setRemovingId(title.id)
    try {
      await api.removeWatchlist(title.id)
      setItems((prev) => (prev ? prev.filter((t) => t.id !== title.id) : prev))
    } catch {
      /* keep item on failure */
    } finally {
      setRemovingId(null)
    }
  }

  return (
    <CinemaShell
      user={user}
      onLogout={onLogout}
      className="page-enter"
      showSearch
      search={query}
      onSearchChange={setQuery}
      searchPlaceholder={`Search ${TITLES[mode].toLowerCase()}… (/)`}
      navActive={mode === 'my-list' ? 'my-list' : mode}
      onScan={() => void onScan()}
      scanning={scanning}
    >
      <main className="page browse-page">
        <header className="browse-header">
          <div>
            <p className="browse-kicker">Browse</p>
            <h1>{TITLES[mode]}</h1>
            <p className="muted">
              {items == null
                ? 'Loading…'
                : `${filtered.length} title${filtered.length === 1 ? '' : 's'}${
                    genre !== 'all' ? ` in ${genre}` : ''
                  }`}
            </p>
          </div>
          <label className="browse-sort">
            <span className="sr-only">Sort by</span>
            <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
              <option value="title">A–Z</option>
              <option value="year">Year</option>
              <option value="rating">Rating</option>
              <option value="recent">{mode === 'my-list' ? 'Date added' : 'Newest year'}</option>
            </select>
          </label>
        </header>

        {genres.length > 0 ? (
          <div className="genre-chips" role="list">
            <button
              type="button"
              className={`genre-chip${genre === 'all' ? ' is-active' : ''}`}
              onClick={() => setGenre('all')}
            >
              All
            </button>
            {genres.map((g) => (
              <button
                key={g}
                type="button"
                className={`genre-chip${genre === g ? ' is-active' : ''}`}
                onClick={() => setGenre(g)}
              >
                {g}
              </button>
            ))}
          </div>
        ) : null}

        {error ? (
          <div className="empty-state">
            <h2>Couldn’t load</h2>
            <p>{error}</p>
          </div>
        ) : items == null ? (
          <div className="poster-grid browse-grid">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="skel skel-poster" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty-inline">
            <p>
              {mode === 'my-list'
                ? 'Your list is empty. Add titles from any detail page.'
                : query || genre !== 'all'
                  ? 'No titles match that filter.'
                  : 'Nothing in this collection yet.'}
            </p>
            {mode === 'my-list' ? (
              <Link className="btn btn-primary" to="/">
                Browse home
              </Link>
            ) : query || genre !== 'all' ? (
              <button
                className="btn btn-ghost"
                type="button"
                onClick={() => {
                  setQuery('')
                  setGenre('all')
                }}
              >
                Clear filters
              </button>
            ) : null}
          </div>
        ) : (
          <div className="poster-grid browse-grid">
            {filtered.map((t) => (
              <PosterCard
                key={`${t.kind}-${t.id}`}
                title={t}
                onRemove={mode === 'my-list' ? () => void removeFromList(t) : undefined}
                removing={removingId === t.id}
              />
            ))}
          </div>
        )}
      </main>
    </CinemaShell>
  )
}
