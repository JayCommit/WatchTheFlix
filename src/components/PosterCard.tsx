import { Link } from 'react-router-dom'
import type { Title } from '../types'

type Props = {
  title: Title
  subtitle?: string
  progress?: number
  onRemove?: () => void
  removing?: boolean
}

export function PosterCard({ title, subtitle, progress, onRemove, removing }: Props) {
  const to = title.kind === 'movie' ? `/movie/${title.id}` : `/tv/${title.id}`

  return (
    <article className="poster-card">
      <Link className="poster-card-link" to={to} title={title.title}>
        <div className="poster-art">
          {title.poster ? (
            <img src={title.poster} alt="" loading="lazy" />
          ) : (
            <div className="poster-fallback">{title.title}</div>
          )}
          <div className="poster-hover" aria-hidden>
            <span className="poster-play">▶</span>
            {title.voteAverage ? (
              <span className="poster-rating">{title.voteAverage.toFixed(1)}</span>
            ) : null}
          </div>
          {progress != null && progress > 0 ? (
            <div className="progress-bar" aria-hidden>
              <i style={{ width: `${Math.min(100, progress * 100)}%` }} />
            </div>
          ) : null}
        </div>
        <div className="poster-meta">
          <strong>{title.title}</strong>
          <span>
            {subtitle ??
              (title.year
                ? String(title.year)
                : title.kind === 'tv'
                  ? 'Series'
                  : 'Film')}
          </span>
        </div>
      </Link>
      {onRemove ? (
        <button
          type="button"
          className="poster-dismiss"
          disabled={removing}
          aria-label={`Remove ${title.title} from My List`}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onRemove()
          }}
        >
          ×
        </button>
      ) : null}
    </article>
  )
}
