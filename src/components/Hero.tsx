import { Link } from 'react-router-dom'
import type { Title } from '../types'

type Props = {
  title: Title
  ctaPath?: string
  ctaLabel?: string
  onWatchlist?: boolean
  watchlistBusy?: boolean
  onToggleWatchlist?: () => void
}

export function Hero({
  title,
  ctaPath,
  ctaLabel = 'Play',
  onWatchlist = false,
  watchlistBusy = false,
  onToggleWatchlist,
}: Props) {
  const detailPath = title.kind === 'movie' ? `/movie/${title.id}` : `/tv/${title.id}`
  const playPath = ctaPath ?? detailPath
  const metaBits = [
    title.year ? String(title.year) : null,
    title.voteAverage ? `${title.voteAverage.toFixed(1)} ★` : null,
    title.kind === 'movie' ? 'Movie' : 'Series',
    ...title.genres.slice(0, 2),
  ].filter(Boolean)

  return (
    <section className="hero" aria-label={`Featured: ${title.title}`}>
      <div
        className="hero-media"
        style={{
          backgroundImage: title.backdrop
            ? `url(${title.backdrop})`
            : title.poster
              ? `url(${title.poster})`
              : undefined,
          backgroundColor: '#0c0e18',
        }}
      />
      <div className="hero-copy">
        <p className="hero-kicker">{metaBits.join(' · ')}</p>
        <h1>{title.title}</h1>
        {title.overview ? <p className="hero-overview">{title.overview}</p> : null}
        <div className="hero-actions">
          <Link className="btn btn-primary btn-play" to={playPath}>
            <span className="btn-icon" aria-hidden>
              ▶
            </span>
            {ctaLabel}
          </Link>
          <Link className="btn btn-ghost" to={detailPath}>
            More info
          </Link>
          {onToggleWatchlist ? (
            <button
              type="button"
              className={`btn btn-ghost${onWatchlist ? ' is-listed' : ''}`}
              disabled={watchlistBusy}
              onClick={onToggleWatchlist}
            >
              {watchlistBusy ? 'Saving…' : onWatchlist ? '✓ My List' : '+ My List'}
            </button>
          ) : null}
        </div>
      </div>
    </section>
  )
}
