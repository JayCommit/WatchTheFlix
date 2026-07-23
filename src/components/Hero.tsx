import { Link } from 'react-router-dom'
import type { Title } from '../types'

type Props = {
  title: Title
  ctaPath?: string
  ctaLabel?: string
}

export function Hero({ title, ctaPath, ctaLabel = 'Play' }: Props) {
  const detailPath = title.kind === 'movie' ? `/movie/${title.id}` : `/tv/${title.id}`
  const playPath = ctaPath ?? detailPath

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
          backgroundColor: '#1a1510',
        }}
      />
      <div className="hero-copy">
        <p className="hero-brand">WatchTheFlix</p>
        <h1>{title.title}</h1>
        <div className="hero-meta">
          {title.year ? <span>{title.year}</span> : null}
          {title.voteAverage ? <span>★ {title.voteAverage.toFixed(1)}</span> : null}
          <span className="hero-kind">{title.kind === 'movie' ? 'Movie' : 'Series'}</span>
          {title.genres?.slice(0, 3).map((g) => (
            <span key={g}>{g}</span>
          ))}
        </div>
        {title.overview ? <p className="hero-overview">{title.overview}</p> : null}
        <div className="hero-actions">
          <Link className="btn btn-primary" to={playPath}>
            {ctaLabel}
          </Link>
          <Link className="btn btn-ghost" to={detailPath}>
            More info
          </Link>
        </div>
      </div>
    </section>
  )
}
