import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { AccountMenu } from '../components/AccountMenu'
import { Hero } from '../components/Hero'
import { MobileNav } from '../components/MobileNav'
import { PosterCard } from '../components/PosterCard'
import { Row } from '../components/Row'
import { HomeSkeleton } from '../components/Skeleton'
import { TopBar } from '../components/TopBar'
import type { AuthUser, LibraryResponse, Title } from '../types'
import { episodeLabel } from '../utils/format'

type Props = {
  user: AuthUser
  onLogout: () => void
}

function matchesQuery(title: Title, q: string): boolean {
  if (!q) return true
  const hay = `${title.title} ${title.year ?? ''} ${title.genres.join(' ')} ${title.overview ?? ''}`.toLowerCase()
  return hay.includes(q)
}

function topGenres(titles: Title[], limit = 4): string[] {
  const counts = new Map<string, number>()
  for (const t of titles) {
    for (const g of t.genres) {
      counts.set(g, (counts.get(g) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([g]) => g)
}

export function HomePage({ user, onLogout }: Props) {
  const isAdmin = user.role === 'admin'
  const [data, setData] = useState<LibraryResponse | null>(null)
  const [error, setError] = useState('')
  const [scanning, setScanning] = useState(false)
  const [scanMsg, setScanMsg] = useState('')
  const [query, setQuery] = useState('')
  const [watchlist, setWatchlist] = useState<Title[]>([])

  async function load() {
    try {
      const lib = await api.library()
      setData(lib)
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load library')
    }
  }

  useEffect(() => {
    void load()
    void api
      .watchlist()
      .then((r) => setWatchlist(r.items))
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if ((e.target as HTMLElement | null)?.isContentEditable) return
      const input = document.getElementById('wtf-topbar-search') as HTMLInputElement | null
      if (!input) return
      e.preventDefault()
      input.focus()
      input.select()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const q = query.trim().toLowerCase()

  const featured = useMemo(() => {
    if (!data || q) return null
    // Prefer a continue-watching title's library entry, else recent
    const cwId = data.continueWatching[0]?.titleId
    if (cwId) {
      const fromCw =
        data.movies.find((t) => t.id === cwId) ??
        data.shows.find((t) => t.id === cwId) ??
        data.recent.find((t) => t.id === cwId)
      if (fromCw) return fromCw
    }
    return data.recent[0] ?? data.movies[0] ?? data.shows[0] ?? null
  }, [data, q])

  const featuredCta = useMemo(() => {
    if (!featured || !data) return { path: '/', label: 'Browse' }
    if (featured.kind === 'tv') {
      const cw = data.continueWatching.find((c) => c.titleId === featured.id)
      if (cw) {
        return {
          path: `/play?path=${encodeURIComponent(cw.path)}&titleId=${cw.titleId}&kind=tv`,
          label: 'Resume',
        }
      }
      return { path: `/tv/${featured.id}`, label: 'Browse episodes' }
    }
    const cw = data.continueWatching.find((c) => c.titleId === featured.id)
    if (cw) {
      return {
        path: `/play?path=${encodeURIComponent(cw.path)}&titleId=${cw.titleId}&kind=movie`,
        label: 'Resume',
      }
    }
    return {
      path: `/play?titleId=${featured.id}&kind=movie`,
      label: 'Play',
    }
  }, [featured, data])

  const filtered = useMemo(() => {
    if (!data) return { movies: [] as Title[], shows: [] as Title[], recent: [] as Title[] }
    return {
      movies: data.movies.filter((t) => matchesQuery(t, q)),
      shows: data.shows.filter((t) => matchesQuery(t, q)),
      recent: data.recent.filter((t) => matchesQuery(t, q)),
    }
  }, [data, q])

  const genreRows = useMemo(() => {
    if (!data || q) return [] as Array<{ genre: string; titles: Title[] }>
    const pool = [...data.movies, ...data.shows]
    return topGenres(pool, 4)
      .map((genre) => ({
        genre,
        titles: pool.filter((t) => t.genres.includes(genre)).slice(0, 24),
      }))
      .filter((row) => row.titles.length >= 4)
  }, [data, q])

  const searchResults = useMemo(() => {
    if (!q || !data) return []
    const seen = new Set<string>()
    const out: Title[] = []
    for (const t of [...data.movies, ...data.shows]) {
      const key = `${t.kind}-${t.id}`
      if (seen.has(key) || !matchesQuery(t, q)) continue
      seen.add(key)
      out.push(t)
    }
    return out.sort((a, b) => a.title.localeCompare(b.title))
  }, [data, q])

  async function onScan() {
    if (!isAdmin) return
    setScanning(true)
    setScanMsg('Starting library scan…')
    try {
      const result = await api.runScan((status) => {
        const p = status.status
        if (!p) return
        const src = p.source === 'local' ? 'Local disk' : 'WebDAV'
        if (p.phase === 'listing') {
          setScanMsg(`${src}: listing folders… (${p.dirsScanned} scanned)`)
        } else if (p.phase === 'matching') {
          setScanMsg(
            `${src}: matching ${p.processed}/${p.filesFound} · ${p.matched} matched`,
          )
        } else if (p.message) {
          setScanMsg(p.message)
        }
      })
      const errN = result.errors?.length ?? 0
      if (result.warning) {
        setScanMsg(result.warning + (errN ? ` (${errN} errors)` : ''))
      } else if (errN) {
        setScanMsg(
          `Found ${result.filesFound} files · ${result.titles} titles · ${errN} errors`,
        )
      } else {
        setScanMsg(
          `Found ${result.filesFound} files under ${result.mediaRoot ?? 'media root'} · ${result.titles} titles` +
            (result.source ? ` (${result.source})` : ''),
        )
      }
      await load()
    } catch (err) {
      setScanMsg(err instanceof Error ? err.message : 'Scan failed')
    } finally {
      setScanning(false)
    }
  }

  if (error) {
    return (
      <div className="app-shell page-enter has-mobile-nav">
        <TopBar
          actions={<AccountMenu user={user} onLogout={onLogout} onScan={() => void onScan()} scanning={scanning} />}
        />
        <div className="empty-state">
          <h2>Couldn’t load library</h2>
          <p>{error}</p>
          <button className="btn btn-primary" type="button" onClick={() => void load()}>
            Try again
          </button>
        </div>
        <MobileNav />
      </div>
    )
  }

  if (!data) {
    return <HomeSkeleton />
  }

  const empty = data.counts.files === 0

  return (
    <div className="app-shell page-enter has-mobile-nav">
      <TopBar
        showSearch={!empty}
        search={query}
        onSearchChange={setQuery}
        navActive="home"
        actions={
          <>
            {scanMsg ? <span className="muted scan-status hide-sm">{scanMsg}</span> : null}
            <AccountMenu
              user={user}
              onLogout={onLogout}
              onScan={() => void onScan()}
              scanning={scanning}
            />
          </>
        }
      />

      <main className="page">
        {empty ? (
          <div className="empty-state empty-state-hero">
            <p className="hero-brand">
              Watch<span>The</span>Flix
            </p>
            <h2>Nothing on the reel yet</h2>
            {isAdmin ? (
              <>
                <p>Scan local disk or WebDAV, match titles on TMDB, and fill the house.</p>
                <div className="empty-cta-row">
                  <button
                    className="btn btn-primary"
                    type="button"
                    disabled={scanning}
                    onClick={() => void onScan()}
                  >
                    {scanning ? 'Scanning…' : 'Scan library'}
                  </button>
                  <Link className="btn btn-ghost" to="/admin">
                    Open Manage
                  </Link>
                </div>
                {scanMsg ? (
                  <p
                    className={
                      /fail|missing|TMDB|0 video/i.test(scanMsg) ? 'error-text' : 'muted'
                    }
                  >
                    {scanMsg}
                  </p>
                ) : (
                  <p className="muted">
                    Tip: set <code>TMDB_API_KEY</code> and <code>LOCAL_MEDIA_ROOT</code> in{' '}
                    <code>.env</code> before scanning.
                  </p>
                )}
              </>
            ) : (
              <p className="muted">Ask an admin to scan the library — then your titles will show up here.</p>
            )}
          </div>
        ) : q ? (
          <section className="section search-results">
            <div className="section-head">
              <h2>
                {searchResults.length} result{searchResults.length === 1 ? '' : 's'} for “{query.trim()}”
              </h2>
            </div>
            {searchResults.length === 0 ? (
              <div className="empty-inline">
                <p>No titles match that search.</p>
                <button className="btn btn-ghost" type="button" onClick={() => setQuery('')}>
                  Clear search
                </button>
              </div>
            ) : (
              <div className="poster-grid">
                {searchResults.map((t) => (
                  <PosterCard key={`s-${t.kind}-${t.id}`} title={t} />
                ))}
              </div>
            )}
          </section>
        ) : (
          <>
            {featured ? (
              <Hero title={featured} ctaPath={featuredCta.path} ctaLabel={featuredCta.label} />
            ) : null}

            {data.continueWatching.length > 0 ? (
              <Row title="Continue watching">
                {data.continueWatching.map((item) => (
                  <Link
                    key={item.path}
                    className="poster-card"
                    to={`/play?path=${encodeURIComponent(item.path)}&titleId=${item.titleId}&kind=${item.kind}`}
                  >
                    <div className="poster-art">
                      {item.poster ? (
                        <img src={item.poster} alt="" loading="lazy" />
                      ) : (
                        <div className="poster-fallback">{item.title}</div>
                      )}
                      <div className="poster-hover" aria-hidden>
                        <span className="poster-play">▶</span>
                      </div>
                      <div className="progress-bar" aria-hidden>
                        <i
                          style={{
                            width: `${
                              item.duration > 0
                                ? Math.min(100, (item.position / item.duration) * 100)
                                : 0
                            }%`,
                          }}
                        />
                      </div>
                    </div>
                    <div className="poster-meta">
                      <strong>{item.title}</strong>
                      <span>
                        {item.season != null && item.episode != null
                          ? episodeLabel(item.season, item.episode)
                          : 'Resume'}
                      </span>
                    </div>
                  </Link>
                ))}
              </Row>
            ) : null}

            {watchlist.length > 0 ? (
              <Row
                title="My List"
                action={
                  <Link className="row-see-all" to="/my-list">
                    See all
                  </Link>
                }
              >
                {watchlist.map((t) => (
                  <PosterCard key={`w-${t.kind}-${t.id}`} title={t} />
                ))}
              </Row>
            ) : null}

            {filtered.recent.length > 0 ? (
              <Row title="Recently added">
                {filtered.recent.map((t) => (
                  <PosterCard key={`r-${t.kind}-${t.id}`} title={t} />
                ))}
              </Row>
            ) : null}

            {filtered.movies.length > 0 ? (
              <Row
                title="Movies"
                action={
                  <Link className="row-see-all" to="/movies">
                    See all
                  </Link>
                }
              >
                {filtered.movies.slice(0, 24).map((t) => (
                  <PosterCard key={`m-${t.id}`} title={t} />
                ))}
              </Row>
            ) : null}

            {filtered.shows.length > 0 ? (
              <Row
                title="TV shows"
                action={
                  <Link className="row-see-all" to="/tv">
                    See all
                  </Link>
                }
              >
                {filtered.shows.slice(0, 24).map((t) => (
                  <PosterCard key={`t-${t.id}`} title={t} />
                ))}
              </Row>
            ) : null}

            {genreRows.map((row) => (
              <Row key={row.genre} title={row.genre}>
                {row.titles.map((t) => (
                  <PosterCard key={`g-${row.genre}-${t.kind}-${t.id}`} title={t} />
                ))}
              </Row>
            ))}
          </>
        )}
      </main>
      <MobileNav />
    </div>
  )
}
