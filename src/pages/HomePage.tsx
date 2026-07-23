import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { Hero } from '../components/Hero'
import { PosterCard } from '../components/PosterCard'
import { ProfileSwitcher } from '../components/ProfileSwitcher'
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

export function HomePage({ user, onLogout }: Props) {
  const isAdmin = user.role === 'admin'
  const [data, setData] = useState<LibraryResponse | null>(null)
  const [error, setError] = useState('')
  const [scanning, setScanning] = useState(false)
  const [scanMsg, setScanMsg] = useState('')
  const [query, setQuery] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
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
    if (!menuOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menuOpen])

  const q = query.trim().toLowerCase()

  const featured = useMemo(() => {
    if (!data || q) return null
    return data.recent[0] ?? data.movies[0] ?? data.shows[0] ?? null
  }, [data, q])

  const featuredCta = useMemo(() => {
    if (!featured || !data) return { path: '/', label: 'Browse' }
    if (featured.kind === 'tv') {
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
    setMenuOpen(false)
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

  async function logout() {
    await api.logout()
    onLogout()
  }

  const actions = (
    <>
      <ProfileSwitcher />
      <button
        className="btn btn-ghost hide-sm"
        type="button"
        title="Toggle theme"
        onClick={() => {
          const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light'
          document.documentElement.dataset.theme = next
          localStorage.setItem('wtf_theme', next)
        }}
      >
        Theme
      </button>
      <span className="muted hide-sm" style={{ fontSize: '0.85rem' }}>
        {user.username}
        {isAdmin ? ' · admin' : ''}
      </span>
      {scanMsg ? <span className="muted scan-status hide-sm">{scanMsg}</span> : null}
      {isAdmin ? (
        <Link className="topbar-manage hide-sm" to="/admin">
          Manage
        </Link>
      ) : null}
      {isAdmin ? (
        <button
          className="btn btn-ghost hide-sm"
          type="button"
          disabled={scanning}
          onClick={() => void onScan()}
        >
          {scanning ? 'Scanning…' : 'Scan library'}
        </button>
      ) : null}
      <button className="btn btn-ghost hide-sm" type="button" onClick={() => void logout()}>
        Log out
      </button>
      <button
        className="btn btn-ghost menu-toggle"
        type="button"
        aria-expanded={menuOpen}
        aria-label="Menu"
        onClick={() => setMenuOpen((v) => !v)}
      >
        ☰
      </button>
      {menuOpen ? (
        <div className="mobile-menu">
          {isAdmin ? (
            <Link className="btn btn-ghost" to="/admin" onClick={() => setMenuOpen(false)}>
              Manage
            </Link>
          ) : null}
          {isAdmin ? (
            <button className="btn btn-ghost" type="button" disabled={scanning} onClick={() => void onScan()}>
              {scanning ? 'Scanning…' : 'Scan library'}
            </button>
          ) : null}
          <button className="btn btn-ghost" type="button" onClick={() => void logout()}>
            Log out
          </button>
        </div>
      ) : null}
    </>
  )

  if (error) {
    return (
      <div className="app-shell page-enter">
        <TopBar
          actions={
            <>
              <Link className="topbar-manage" to="/admin">
                Manage
              </Link>
              <button className="btn btn-ghost" type="button" onClick={() => void logout()}>
                Log out
              </button>
            </>
          }
        />
        <div className="empty-state">
          <h2>Couldn’t load library</h2>
          <p>{error}</p>
          <button className="btn btn-primary" type="button" onClick={() => void load()}>
            Try again
          </button>
        </div>
      </div>
    )
  }

  if (!data) {
    return <HomeSkeleton />
  }

  const empty = data.counts.files === 0

  return (
    <div className="app-shell page-enter">
      <TopBar
        showSearch={!empty}
        search={query}
        onSearchChange={setQuery}
        actions={actions}
      />

      <main className="page">
        {empty ? (
          <div className="empty-state">
            <p className="hero-brand">WatchTheFlix</p>
            <h2>Library is empty</h2>
            {isAdmin ? (
              <>
                <p>
                  Scan lists video files from local disk (when LOCAL_MEDIA_ROOT is set) or WebDAV,
                  then matches them on TMDB — large libraries can take several minutes.
                </p>
                <button
                  className="btn btn-primary"
                  type="button"
                  disabled={scanning}
                  onClick={() => void onScan()}
                >
                  {scanning ? 'Scanning…' : 'Scan library'}
                </button>
                {scanMsg ? (
                  <p
                    className={
                      scanMsg.includes('failed') || scanMsg.includes('0 video')
                        ? 'error-text'
                        : 'muted'
                    }
                  >
                    {scanMsg}
                  </p>
                ) : null}
              </>
            ) : (
              <p className="muted">Ask an admin to scan the library.</p>
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

            {watchlist.length > 0 ? (
              <Row title="Watchlist">
                {watchlist.map((t) => (
                  <PosterCard key={`w-${t.kind}-${t.id}`} title={t} />
                ))}
              </Row>
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

            {filtered.recent.length > 0 ? (
              <Row title="Recently added">
                {filtered.recent.map((t) => (
                  <PosterCard key={`r-${t.kind}-${t.id}`} title={t} />
                ))}
              </Row>
            ) : null}

            {filtered.movies.length > 0 ? (
              <Row title="Movies">
                {filtered.movies.map((t) => (
                  <PosterCard key={`m-${t.id}`} title={t} />
                ))}
              </Row>
            ) : null}

            {filtered.shows.length > 0 ? (
              <Row title="TV shows">
                {filtered.shows.map((t) => (
                  <PosterCard key={`t-${t.id}`} title={t} />
                ))}
              </Row>
            ) : null}
          </>
        )}
      </main>
    </div>
  )
}
