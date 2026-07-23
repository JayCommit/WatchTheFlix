import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { Hero } from '../components/Hero'
import { PosterCard } from '../components/PosterCard'
import { Row } from '../components/Row'
import { HomeSkeleton } from '../components/Skeleton'
import { TopBar } from '../components/TopBar'
import type { LibraryResponse, Title } from '../types'
import { episodeLabel } from '../utils/format'

type Diagnostics = Awaited<ReturnType<typeof api.diagnostics>>

type Props = {
  onLogout: () => void
}

function matchesQuery(title: Title, q: string): boolean {
  if (!q) return true
  const hay = `${title.title} ${title.year ?? ''} ${title.genres.join(' ')} ${title.overview ?? ''}`.toLowerCase()
  return hay.includes(q)
}

export function HomePage({ onLogout }: Props) {
  const [data, setData] = useState<LibraryResponse | null>(null)
  const [error, setError] = useState('')
  const [scanning, setScanning] = useState(false)
  const [scanMsg, setScanMsg] = useState('')
  const [diag, setDiag] = useState<Diagnostics | null>(null)
  const [diagError, setDiagError] = useState('')
  const [query, setQuery] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)

  async function load() {
    try {
      const lib = await api.library()
      setData(lib)
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load library')
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

  useEffect(() => {
    void load()
  }, [])

  useEffect(() => {
    if (data && data.counts.files === 0) {
      void loadDiagnostics()
    }
  }, [data])

  const q = query.trim().toLowerCase()

  const featured = useMemo(() => {
    if (!data || q) return null
    return data.recent[0] ?? data.movies[0] ?? data.shows[0] ?? null
  }, [data, q])

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
    setScanning(true)
    setScanMsg('Connecting to WebDAV and listing files… this can take a few minutes for large libraries.')
    setMenuOpen(false)
    try {
      await loadDiagnostics()
      const result = await api.scan()
      if (result.warning) {
        setScanMsg(result.warning)
      } else if (result.errors?.length) {
        setScanMsg(
          `Found ${result.filesFound} files · ${result.titles} titles · ${result.errors.length} errors`,
        )
      } else {
        setScanMsg(
          `Found ${result.filesFound} files under ${result.mediaRoot ?? 'MEDIA_ROOT'} · ${result.titles} titles`,
        )
      }
      await load()
    } catch (err) {
      setScanMsg(err instanceof Error ? err.message : 'Scan failed')
      void loadDiagnostics()
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
      {scanMsg ? <span className="muted scan-status hide-sm">{scanMsg}</span> : null}
      <Link className="topbar-manage hide-sm" to="/admin">
        Manage
      </Link>
      <button className="btn btn-ghost hide-sm" type="button" disabled={scanning} onClick={() => void onScan()}>
        {scanning ? 'Scanning…' : 'Scan library'}
      </button>
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
          <Link className="btn btn-ghost" to="/admin" onClick={() => setMenuOpen(false)}>
            Manage
          </Link>
          <button className="btn btn-ghost" type="button" disabled={scanning} onClick={() => void onScan()}>
            {scanning ? 'Scanning…' : 'Scan library'}
          </button>
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
            <p>
              Scan pulls video files over WebDAV, then matches them on TMDB — large libraries can take
              several minutes.
            </p>
            <button className="btn btn-primary" type="button" disabled={scanning} onClick={() => void onScan()}>
              {scanning ? 'Scanning…' : 'Scan library'}
            </button>
            {scanMsg ? (
              <p className={scanMsg.includes('failed') || scanMsg.includes('0 video') ? 'error-text' : 'muted'}>
                {scanMsg}
              </p>
            ) : null}

            <div className="diag-panel">
              <div className="section-head">
                <h2>Connection check</h2>
                <button className="btn btn-ghost" type="button" onClick={() => void loadDiagnostics()}>
                  Re-test
                </button>
              </div>
              {diagError ? <p className="error-text">{diagError}</p> : null}
              {diag ? (
                <>
                  <ul className="diag-list">
                    <li>
                      WebDAV host: <code>{diag.config.webdavHost || '(missing)'}</code>
                    </li>
                    <li>
                      MEDIA_ROOT: <code>{diag.config.mediaRoot}</code>
                    </li>
                    <li>
                      Credentials:{' '}
                      {diag.config.webdavUserSet && diag.config.webdavPasswordSet ? 'set' : 'missing'}
                    </li>
                    <li>TMDB key: {diag.config.tmdbKeySet ? 'set' : 'missing'}</li>
                    <li>
                      WebDAV probe:{' '}
                      {diag.webdav.ok ? (
                        <span className="ok-text">OK</span>
                      ) : (
                        <span className="error-text">Failed</span>
                      )}
                    </li>
                  </ul>
                  {diag.webdav.error ? <p className="error-text">{diag.webdav.error}</p> : null}
                  {diag.webdav.ok && diag.webdav.mediaEntries.length > 0 ? (
                    <p className="muted">
                      Under MEDIA_ROOT: {diag.webdav.mediaEntries.map((e) => e.name).join(', ')}
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="muted">Running diagnostics…</p>
              )}
            </div>
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
                ctaPath={
                  featured.kind === 'movie'
                    ? `/play?titleId=${featured.id}&kind=movie`
                    : `/tv/${featured.id}`
                }
                ctaLabel={featured.kind === 'movie' ? 'Play' : 'Browse episodes'}
              />
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
