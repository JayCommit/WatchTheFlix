import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { CinemaShell } from '../components/cinema'
import { Hero } from '../components/Hero'
import { PosterCard } from '../components/PosterCard'
import { Row } from '../components/Row'
import { HomeSkeleton } from '../components/Skeleton'
import { useLibraryScan } from '../hooks/useLibraryScan'
import type { AuthUser, ContinueItem, LibraryResponse, Title } from '../types'
import { bindSlashToSearch } from '../utils/focusSearch'
import { episodeLabel, formatTime } from '../utils/format'
import { matchesQuery } from '../utils/titleSearch'

type Props = {
  user: AuthUser
  onLogout: () => void
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

function genreBrowsePath(genre: string, titles: Title[]): string {
  const movies = titles.filter((t) => t.kind === 'movie').length
  const shows = titles.length - movies
  const base = shows > movies ? '/tv' : '/movies'
  return `${base}?genre=${encodeURIComponent(genre)}`
}

export function HomePage({ user, onLogout }: Props) {
  const isAdmin = user.role === 'admin'
  const [data, setData] = useState<LibraryResponse | null>(null)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [watchlist, setWatchlist] = useState<Title[]>([])
  const [heroWatchlistBusy, setHeroWatchlistBusy] = useState(false)
  const [dismissingPath, setDismissingPath] = useState<string | null>(null)
  const [removingWatchlistId, setRemovingWatchlistId] = useState<number | null>(null)

  async function load() {
    try {
      const lib = await api.library()
      setData(lib)
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load library')
    }
  }

  const { scanning, scanMsg, onScan } = useLibraryScan({
    enabled: isAdmin,
    onComplete: () => load(),
  })

  useEffect(() => {
    void load()
    void api
      .watchlist()
      .then((r) => setWatchlist(r.items))
      .catch(() => undefined)
  }, [])

  useEffect(() => bindSlashToSearch(), [])

  const q = query.trim().toLowerCase()

  const featured = useMemo(() => {
    if (!data || q) return null
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

  const featuredOnList = featured ? watchlist.some((t) => t.id === featured.id) : false

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
    if (!data || q) return [] as Array<{ genre: string; titles: Title[]; seeAll: string }>
    const pool = [...data.movies, ...data.shows]
    return topGenres(pool, 4)
      .map((genre) => {
        const titles = pool.filter((t) => t.genres.includes(genre)).slice(0, 24)
        return {
          genre,
          titles,
          seeAll: genreBrowsePath(genre, titles),
        }
      })
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

  async function toggleFeaturedWatchlist() {
    if (!featured || heroWatchlistBusy) return
    const next = !featuredOnList
    setHeroWatchlistBusy(true)
    setWatchlist((prev) =>
      next ? [featured, ...prev.filter((t) => t.id !== featured.id)] : prev.filter((t) => t.id !== featured.id),
    )
    try {
      if (next) await api.addWatchlist(featured.id)
      else await api.removeWatchlist(featured.id)
    } catch {
      setWatchlist((prev) =>
        next
          ? prev.filter((t) => t.id !== featured.id)
          : [featured, ...prev.filter((t) => t.id !== featured.id)],
      )
    } finally {
      setHeroWatchlistBusy(false)
    }
  }

      async function dismissContinue(item: ContinueItem) {
    setDismissingPath(item.path)
    try {
      await api.saveProgress(item.path, 0, item.duration || 1)
      setData((prev) =>
        prev
          ? {
              ...prev,
              continueWatching: prev.continueWatching.filter((c) => c.path !== item.path),
            }
          : prev,
      )
    } catch {
      /* keep row on failure */
    } finally {
      setDismissingPath(null)
    }
  }

  async function removeFromHomeList(title: Title) {
    setRemovingWatchlistId(title.id)
    try {
      await api.removeWatchlist(title.id)
      setWatchlist((prev) => prev.filter((t) => t.id !== title.id))
    } catch {
      /* keep item on failure */
    } finally {
      setRemovingWatchlistId(null)
    }
  }

  if (error) {
    return (
      <CinemaShell
        user={user}
        onLogout={onLogout}
        className="page-enter"
        onScan={() => void onScan()}
        scanning={scanning}
      >
        <div className="empty-state">
          <h2>Couldn’t load library</h2>
          <p>{error}</p>
          <button className="btn btn-primary" type="button" onClick={() => void load()}>
            Try again
          </button>
        </div>
      </CinemaShell>
    )
  }

  if (!data) {
    return <HomeSkeleton />
  }

  const empty = data.counts.files === 0

  return (
    <CinemaShell
      user={user}
      onLogout={onLogout}
      className="page-enter"
      showSearch={!empty}
      search={query}
      onSearchChange={setQuery}
      navActive="home"
      actionsExtra={
        scanMsg ? (
          <span className="muted scan-status hide-sm" role="status" aria-live="polite">
            {scanMsg}
          </span>
        ) : null
      }
      onScan={() => void onScan()}
      scanning={scanning}
    >
      {scanMsg ? (
        <div className="admin-toast show-sm-only" role="status" aria-live="polite">
          {scanMsg}
        </div>
      ) : null}
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
              <Hero
                title={featured}
                ctaPath={featuredCta.path}
                ctaLabel={featuredCta.label}
                onWatchlist={featuredOnList}
                watchlistBusy={heroWatchlistBusy}
                onToggleWatchlist={() => void toggleFeaturedWatchlist()}
              />
            ) : null}

            {data.continueWatching.length > 0 ? (
              <Row title="Continue watching">
                {data.continueWatching.map((item) => {
                  const detailPath =
                    item.kind === 'movie' ? `/movie/${item.titleId}` : `/tv/${item.titleId}`
                  const playPath = `/play?path=${encodeURIComponent(item.path)}&titleId=${item.titleId}&kind=${item.kind}`
                  return (
                    <article key={item.path} className="poster-card cw-card">
                      <Link className="poster-card-link" to={playPath} title={`Resume ${item.title}`}>
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
                      </Link>
                      <Link className="poster-meta poster-meta-link" to={detailPath}>
                        <strong>{item.title}</strong>
                        <span>
                          {item.season != null && item.episode != null
                            ? episodeLabel(item.season, item.episode)
                            : 'Movie'}
                          {item.duration > 0 && item.position < item.duration
                            ? ` · ${formatTime(Math.max(0, item.duration - item.position))} left`
                            : ''}
                        </span>
                      </Link>
                      <button
                        type="button"
                        className="poster-dismiss"
                        disabled={dismissingPath === item.path}
                        aria-label={`Remove ${item.title} from Continue watching`}
                        onClick={() => void dismissContinue(item)}
                      >
                        ×
                      </button>
                    </article>
                  )
                })}
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
                  <PosterCard
                    key={`w-${t.kind}-${t.id}`}
                    title={t}
                    onRemove={() => void removeFromHomeList(t)}
                    removing={removingWatchlistId === t.id}
                  />
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
              <Row
                key={row.genre}
                title={row.genre}
                action={
                  <Link className="row-see-all" to={row.seeAll}>
                    See all
                  </Link>
                }
              >
                {row.titles.map((t) => (
                  <PosterCard key={`g-${row.genre}-${t.kind}-${t.id}`} title={t} />
                ))}
              </Row>
            ))}
          </>
        )}
      </main>
    </CinemaShell>
  )
}
