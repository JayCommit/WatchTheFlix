import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'
import { DetailSkeleton } from '../components/Skeleton'
import { TopBar } from '../components/TopBar'
import type { MediaFile, TitleDetail } from '../types'
import { episodeLabel, formatBytes, formatTime, isLikelyUnsupported, sortMediaFiles } from '../utils/format'

type Props = {
  kind: 'movie' | 'tv'
}

type SeasonFilter = number | 'all' | 'unknown'

function playUrl(detail: TitleDetail, file: MediaFile, opts?: { fromStart?: boolean }): string {
  const base = `/play?path=${encodeURIComponent(file.path)}&titleId=${detail.id}&kind=${detail.kind}`
  return opts?.fromStart ? `${base}&t=0` : base
}

function hasResume(file: MediaFile | undefined): boolean {
  return !!file?.progress && file.progress.position > 30
}

export function DetailPage({ kind }: Props) {
  const { id } = useParams()
  const navigate = useNavigate()
  const [detail, setDetail] = useState<TitleDetail | null>(null)
  const [error, setError] = useState('')
  const [season, setSeason] = useState<SeasonFilter>('all')
  const [onWatchlist, setOnWatchlist] = useState(false)
  const [trailers, setTrailers] = useState<Array<{ name: string; url: string }>>([])
  const [cast, setCast] = useState<Array<{ name: string; character: string; profile: string | null }>>(
    [],
  )
  const [missing, setMissing] = useState<
    Array<{ season: number; episode: number; name: string }>
  >([])
  const [healthStats, setHealthStats] = useState<{ present: number; expected: number } | null>(
    null,
  )

  useEffect(() => {
    const num = Number(id)
    if (!Number.isFinite(num) || num <= 0) {
      setError('Invalid title id')
      setDetail(null)
      return
    }
    let cancelled = false
    setDetail(null)
    setError('')
    const load = kind === 'movie' ? api.movie(num) : api.tv(num)
    load
      .then((d) => {
        if (cancelled) return
        setDetail(d)
        const seasons = [
          ...new Set(d.files.map((f) => f.season).filter((s): s is number => s != null)),
        ].sort((a, b) => a - b)
        const hasUnknown = d.files.some((f) => f.season == null)
        if (seasons.length > 0) setSeason(seasons[0])
        else if (hasUnknown) setSeason('all')
        else setSeason('all')
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load')
      })
    void api
      .titleExtras(num)
      .then((ex) => {
        if (cancelled) return
        setOnWatchlist(ex.onWatchlist)
        setTrailers(ex.trailers)
        setCast(ex.cast)
        setMissing(ex.health?.missing ?? [])
        setHealthStats(
          ex.health ? { present: ex.health.present, expected: ex.health.expected } : null,
        )
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [id, kind])

  const seasons = useMemo(() => {
    if (!detail) return [] as number[]
    return [...new Set(detail.files.map((f) => f.season).filter((s): s is number => s != null))].sort(
      (a, b) => a - b,
    )
  }, [detail])

  const hasUnknownSeason = useMemo(
    () => Boolean(detail?.files.some((f) => f.season == null)),
    [detail],
  )

  const resumeFile = useMemo(() => {
    if (!detail) return null
    const withProgress = detail.files
      .filter((f) => hasResume(f))
      .sort((a, b) => {
        const at = a.progress?.updated_at ?? ''
        const bt = b.progress?.updated_at ?? ''
        return bt.localeCompare(at)
      })
    return withProgress[0] ?? null
  }, [detail])

  const episodes = useMemo(() => {
    if (!detail) return [] as MediaFile[]
    let list = detail.files
    if (kind === 'tv' && season === 'unknown') {
      list = detail.files.filter((f) => f.season == null)
    } else if (kind === 'tv' && season !== 'all') {
      list = detail.files.filter((f) => f.season === season)
    }
    return sortMediaFiles(list)
  }, [detail, kind, season])

  const primaryFile = resumeFile ?? episodes[0] ?? null

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!detail || !primaryFile) return
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.key === 'Enter' || e.key.toLowerCase() === 'p') {
        e.preventDefault()
        navigate(playUrl(detail, primaryFile))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [detail, primaryFile, navigate])

  if (error) {
    return (
      <div className="app-shell page-enter">
        <TopBar
          actions={
            <>
              <Link className="topbar-link" to="/admin">
                Manage
              </Link>
              <Link className="btn btn-ghost" to="/">
                Library
              </Link>
            </>
          }
        />
        <div className="empty-state">
          <h2>Not found</h2>
          <p>{error}</p>
          <Link className="btn btn-ghost" to="/">
            Back home
          </Link>
        </div>
      </div>
    )
  }

  if (!detail) {
    return <DetailSkeleton />
  }

  const playPrimary = () => {
    if (!primaryFile) return
    navigate(playUrl(detail, primaryFile))
  }

  return (
    <div className="app-shell detail-page page-enter">
      <TopBar
        actions={
          <>
            <Link className="topbar-link" to="/admin">
              Manage
            </Link>
            <Link className="btn btn-ghost" to="/">
              Library
            </Link>
          </>
        }
      />

      <section className="detail-hero hero">
        <div
          className="hero-media"
          style={{
            backgroundImage: detail.backdrop
              ? `url(${detail.backdrop})`
              : detail.poster
                ? `url(${detail.poster})`
                : undefined,
            backgroundColor: '#1a1510',
          }}
        />
        <div className="detail-body">
          <div className="detail-poster">
            {detail.poster ? (
              <img src={detail.poster} alt="" />
            ) : (
              <div className="poster-fallback">{detail.title}</div>
            )}
          </div>
          <div className="detail-copy">
            <p className="hero-brand">WatchTheFlix</p>
            <h1>{detail.title}</h1>
            <div className="hero-meta">
              {detail.year ? <span>{detail.year}</span> : null}
              {detail.voteAverage ? <span>★ {detail.voteAverage.toFixed(1)}</span> : null}
              <span className="hero-kind">{kind === 'movie' ? 'Movie' : 'Series'}</span>
              {detail.genres.slice(0, 5).map((g) => (
                <span key={g}>{g}</span>
              ))}
            </div>
            {detail.overview ? <p className="detail-overview">{detail.overview}</p> : null}
            <div className="hero-actions">
              <button
                className="btn btn-primary"
                type="button"
                disabled={!primaryFile}
                onClick={playPrimary}
              >
                {hasResume(primaryFile ?? undefined)
                  ? `Resume · ${formatTime(primaryFile!.progress!.position)}`
                  : kind === 'movie'
                    ? 'Play'
                    : 'Play episode'}
              </button>
              {hasResume(primaryFile ?? undefined) && primaryFile ? (
                <button
                  className="btn btn-ghost"
                  type="button"
                  onClick={() => navigate(playUrl(detail, primaryFile, { fromStart: true }))}
                >
                  Play from start
                </button>
              ) : null}
              <button
                className="btn btn-ghost"
                type="button"
                onClick={() => {
                  void (async () => {
                    if (onWatchlist) {
                      await api.removeWatchlist(detail.id)
                      setOnWatchlist(false)
                    } else {
                      await api.addWatchlist(detail.id)
                      setOnWatchlist(true)
                    }
                  })()
                }}
              >
                {onWatchlist ? 'On watchlist' : 'Add to watchlist'}
              </button>
              {trailers[0] ? (
                <a className="btn btn-ghost" href={trailers[0].url} target="_blank" rel="noreferrer">
                  Trailer
                </a>
              ) : null}
              {!primaryFile ? <span className="muted">No playable files yet</span> : null}
            </div>
            <p className="kbd-hint muted">Press Enter or P to play</p>
          </div>
        </div>
      </section>

      {cast.length > 0 ? (
        <section className="section">
          <div className="section-head">
            <h2>Cast</h2>
          </div>
          <div className="cast-row">
            {cast.map((m) => (
              <div key={m.name + m.character} className="cast-card">
                {m.profile ? <img src={m.profile} alt="" /> : <div className="cast-fallback" />}
                <strong>{m.name}</strong>
                <span className="muted">{m.character}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {kind === 'tv' && healthStats && healthStats.expected > 0 ? (
        <section className="section">
          <div className="section-head">
            <h2>Library health</h2>
            <span className="muted">
              {healthStats.present}/{healthStats.expected} episodes
            </span>
          </div>
          {missing.length === 0 ? (
            <p className="muted">All known episodes present.</p>
          ) : (
            <ul className="missing-list">
              {missing.slice(0, 40).map((m) => (
                <li key={`${m.season}x${m.episode}`}>
                  S{String(m.season).padStart(2, '0')}E{String(m.episode).padStart(2, '0')} · {m.name}
                </li>
              ))}
              {missing.length > 40 ? (
                <li className="muted">…and {missing.length - 40} more</li>
              ) : null}
            </ul>
          )}
        </section>
      ) : null}

      {kind === 'tv' ? (
        <section className="section">
          <div className="section-head">
            <h2>Episodes</h2>
            {seasons.length > 0 || hasUnknownSeason ? (
              <label className="season-select">
                <span className="sr-only">Season</span>
                <select
                  value={season === 'all' || season === 'unknown' ? season : String(season)}
                  onChange={(e) => {
                    const v = e.target.value
                    if (v === 'all' || v === 'unknown') setSeason(v)
                    else setSeason(Number(v))
                  }}
                >
                  {(seasons.length > 1 || hasUnknownSeason) && (
                    <option value="all">All seasons</option>
                  )}
                  {seasons.map((s) => (
                    <option key={s} value={s}>
                      Season {s}
                    </option>
                  ))}
                  {hasUnknownSeason ? <option value="unknown">Unknown season</option> : null}
                </select>
              </label>
            ) : null}
          </div>
          {episodes.length === 0 ? (
            <div className="empty-inline">
              <p>No episodes in this season.</p>
            </div>
          ) : (
            <div className="episode-list" role="list">
              {episodes.map((file) => {
                const label = episodeLabel(file.season, file.episode)
                const pct =
                  file.progress && file.progress.duration > 0
                    ? Math.min(100, (file.progress.position / file.progress.duration) * 100)
                    : 0
                const unsupported = isLikelyUnsupported(file.filename)
                return (
                  <button
                    key={file.path}
                    className="episode-item"
                    type="button"
                    role="listitem"
                    onClick={() => navigate(playUrl(detail, file))}
                  >
                    <strong className="ep-code">{label}</strong>
                    <div className="ep-body">
                      <strong>
                        {file.episodeName || file.filename}
                        {file.label ? <span className="version-pill">{file.label}</span> : null}
                      </strong>
                      <span>
                        {hasResume(file)
                          ? `Resume at ${formatTime(file.progress!.position)}`
                          : unsupported
                            ? 'May need a compatible codec in-browser'
                            : 'Ready to stream'}
                      </span>
                      {pct > 0 ? (
                        <div className="ep-progress" aria-hidden>
                          <i style={{ width: `${pct}%` }} />
                        </div>
                      ) : null}
                    </div>
                    <span className="ep-cta">{hasResume(file) ? 'Resume' : 'Play'}</span>
                  </button>
                )
              })}
            </div>
          )}
        </section>
      ) : (
        <section className="section">
          <div className="section-head">
            <h2>{detail.files.length > 1 ? 'Versions' : 'File'}</h2>
          </div>
          <div className="episode-list" role="list">
            {sortMediaFiles(detail.files).map((file) => {
              const unsupported = isLikelyUnsupported(file.filename)
              return (
                <button
                  key={file.path}
                  className="episode-item"
                  type="button"
                  role="listitem"
                  onClick={() => navigate(playUrl(detail, file))}
                >
                  <strong className="ep-code">File</strong>
                  <div className="ep-body">
                    <strong>
                      {file.filename}
                      {file.label ? <span className="version-pill">{file.label}</span> : null}
                    </strong>
                    <span>
                      {hasResume(file)
                        ? `Resume at ${formatTime(file.progress!.position)}`
                        : unsupported
                          ? `${formatBytes(file.size)} · may not play in browser`
                          : formatBytes(file.size)}
                    </span>
                    {file.progress && file.progress.duration > 0 ? (
                      <div className="ep-progress" aria-hidden>
                        <i
                          style={{
                            width: `${Math.min(
                              100,
                              (file.progress.position / file.progress.duration) * 100,
                            )}%`,
                          }}
                        />
                      </div>
                    ) : null}
                  </div>
                  <span className="ep-cta">{hasResume(file) ? 'Resume' : 'Play'}</span>
                </button>
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}
