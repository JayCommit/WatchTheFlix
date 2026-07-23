import { Link } from 'react-router-dom'
import type { Title } from '../types'

type Props = {
  title: Title
  subtitle?: string
  progress?: number
}

export function PosterCard({ title, subtitle, progress }: Props) {
  const to = title.kind === 'movie' ? `/movie/${title.id}` : `/tv/${title.id}`

  return (
    <Link className="poster-card" to={to} title={title.title}>
      <div className="poster-art">
        {title.poster ? (
          <img src={title.poster} alt="" loading="lazy" />
        ) : (
          <div className="poster-fallback">{title.title}</div>
        )}
        {progress != null && progress > 0 ? (
          <div className="progress-bar" aria-hidden>
            <i style={{ width: `${Math.min(100, progress * 100)}%` }} />
          </div>
        ) : null}
      </div>
      <div className="poster-meta">
        <strong>{title.title}</strong>
        <span>{subtitle ?? (title.year ? String(title.year) : title.kind === 'tv' ? 'Series' : 'Film')}</span>
      </div>
    </Link>
  )
}
