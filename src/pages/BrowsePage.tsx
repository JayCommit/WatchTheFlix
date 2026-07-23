import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { AccountMenu } from '../components/AccountMenu'
import { MobileNav } from '../components/MobileNav'
import { PosterCard } from '../components/PosterCard'
import { TopBar } from '../components/TopBar'
import type { AuthUser, Title } from '../types'

type Mode = 'movies' | 'tv' | 'my-list'

type Props = {
  mode: Mode
  user: AuthUser
  onLogout: () => void
}

function matchesQuery(title: Title, q: string): boolean {
  if (!q) return true
  const hay = `${title.title} ${title.year ?? ''} ${title.genres.join(' ')} ${title.overview ?? ''}`.toLowerCase()
  return hay.includes(q)
}

const TITLES: Record<Mode, string> = {
  movies: 'Movies',
  tv: 'TV Shows',
  'my-list': 'My List',
}

export function BrowsePage({ mode, user, onLogout }: Props) {
  const [items, setItems] = useState<Title[] | null>(null)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [genre, setGenre] = useState('all')
  const [scanning, setScanning] = useState(false)

  useEffect(() => {
    let cancelled = false
    setItems(null)
    setError('')
    setGenre('all')
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

  const genres = useMemo(() => {
    if (!items) return [] as string[]
    const set = new Set<string>()
    for (const t of items) for (const g of t.genres) set.add(g)
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [items])

  const filtered = useMemo(() => {
    if (!items) return []
    const q = query.trim().toLowerCase()
    return items
      .filter((t) => (genre === 'all' ? true : t.genres.includes(genre)))
      .filter((t) => matchesQuery(t, q))
      .sort((a, b) => a.title.localeCompare(b.title))
  }, [items, query, genre])

  async function onScan() {
    if (user.role !== 'admin') return
    setScanning(true)
    try {
      await api.runScan()
      const lib = await api.library()
      setItems(mode === 'movies' ? lib.movies : mode === 'tv' ? lib.shows : (await api.watchlist()).items)
    } catch {
      /* ignore — account menu already surfaces elsewhere */
    } finally {
      setScanning(false)
    }
  }

  return (
    <div className="app-shell page-enter has-mobile-nav">
      <TopBar
        showSearch
        search={query}
        onSearchChange={setQuery}
        searchPlaceholder={`Search ${TITLES[mode].toLowerCase()}…`}
        navActive={mode === 'my-list' ? 'my-list' : mode}
        actions={<AccountMenu user={user} onLogout={onLogout} onScan={() => void onScan()} scanning={scanning} />}
      />

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
                : query
                  ? 'No titles match that search.'
                  : 'Nothing in this collection yet.'}
            </p>
            {mode === 'my-list' ? (
              <Link className="btn btn-primary" to="/">
                Browse home
              </Link>
            ) : query ? (
              <button className="btn btn-ghost" type="button" onClick={() => setQuery('')}>
                Clear search
              </button>
            ) : null}
          </div>
        ) : (
          <div className="poster-grid browse-grid">
            {filtered.map((t) => (
              <PosterCard key={`${t.kind}-${t.id}`} title={t} />
            ))}
          </div>
        )}
      </main>
      <MobileNav />
    </div>
  )
}
