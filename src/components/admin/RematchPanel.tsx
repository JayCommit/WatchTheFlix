import type { TmdbSearchResult } from '../../types'

export function RematchPanel(props: {
  query: string
  kind: 'movie' | 'tv'
  results: TmdbSearchResult[]
  searching: boolean
  error: string
  busy: boolean
  onQuery: (v: string) => void
  onKind: (v: 'movie' | 'tv') => void
  onSearch: () => void
  onApply: (tmdbId?: number) => void
  onAuto: () => void
  onCancel: () => void
}) {
  return (
    <div className="admin-rematch">
      <div className="admin-inline-form">
        <input
          className="admin-input"
          value={props.query}
          onChange={(e) => props.onQuery(e.target.value)}
          placeholder="TMDB search…"
          onKeyDown={(e) => {
            if (e.key === 'Enter') props.onSearch()
          }}
        />
        <select
          className="admin-select"
          value={props.kind}
          onChange={(e) => props.onKind(e.target.value as 'movie' | 'tv')}
        >
          <option value="movie">Movie</option>
          <option value="tv">TV</option>
        </select>
        <button
          className="btn btn-primary btn-sm"
          type="button"
          disabled={props.searching}
          onClick={props.onSearch}
        >
          {props.searching ? 'Searching…' : 'Search'}
        </button>
        <button
          className="btn btn-ghost btn-sm"
          type="button"
          disabled={props.busy}
          onClick={props.onAuto}
        >
          Auto-apply first
        </button>
        <button className="btn btn-ghost btn-sm" type="button" onClick={props.onCancel}>
          Cancel
        </button>
      </div>
      {props.error ? <p className="error-text">{props.error}</p> : null}
      {props.results.length > 0 ? (
        <ul className="admin-tmdb-results">
          {props.results.map((r) => (
            <li key={r.tmdbId}>
              <div className="admin-thumb sm">
                {r.poster ? <img src={r.poster} alt="" loading="lazy" /> : <span>?</span>}
              </div>
              <div>
                <strong>
                  {r.title}
                  {r.year ? ` (${r.year})` : ''}
                </strong>
                <span className="muted">
                  TMDB {r.tmdbId}
                  {r.voteAverage ? ` · ★ ${r.voteAverage.toFixed(1)}` : ''}
                </span>
              </div>
              <button
                className="btn btn-primary btn-sm"
                type="button"
                disabled={props.busy}
                onClick={() => props.onApply(r.tmdbId)}
              >
                Apply
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
