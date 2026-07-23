import type { MediaFile, TitleDetail } from '../../types'
import { episodeLabel, formatTime, isLikelyUnsupported } from '../../utils/format'
import { hasResume, playUrl } from '../../utils/playUrl'

export type SeasonFilter = number | 'all' | 'unknown'

type Props = {
  detail: TitleDetail
  episodes: MediaFile[]
  seasons: number[]
  hasUnknownSeason: boolean
  season: SeasonFilter
  onSeasonChange: (season: SeasonFilter) => void
  isAdmin: boolean
  preferring: string | null
  onPrefer: (file: MediaFile) => void
  onPlay: (url: string) => void
}

export function EpisodeList({
  detail,
  episodes,
  seasons,
  hasUnknownSeason,
  season,
  onSeasonChange,
  isAdmin,
  preferring,
  onPrefer,
  onPlay,
}: Props) {
  return (
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
                if (v === 'all' || v === 'unknown') onSeasonChange(v)
                else onSeasonChange(Number(v))
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
          {season !== 'all' && (seasons.length > 1 || hasUnknownSeason) ? (
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => onSeasonChange('all')}>
              Show all seasons
            </button>
          ) : null}
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
            const versionCount = detail.files.filter(
              (f) => f.season === file.season && f.episode === file.episode,
            ).length
            const resume = hasResume(file)
            return (
              <div key={file.path} className="episode-item" role="listitem">
                <button
                  className="episode-item-main"
                  type="button"
                  onClick={() => onPlay(playUrl(detail, file))}
                >
                  <strong className="ep-code">{label}</strong>
                  <div className="ep-body">
                    <strong>
                      {file.episodeName || file.filename}
                      {file.label ? <span className="version-pill">{file.label}</span> : null}
                      {file.preferred ? (
                        <span className="version-pill preferred">Preferred</span>
                      ) : null}
                    </strong>
                    <span>
                      {resume
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
                  <span className="ep-cta">{resume ? 'Resume' : 'Play'}</span>
                </button>
                {(resume || (isAdmin && versionCount > 1 && !file.preferred)) ? (
                  <div className="episode-item-actions">
                    {resume ? (
                      <button
                        className="btn btn-ghost btn-sm"
                        type="button"
                        onClick={() => onPlay(playUrl(detail, file, { fromStart: true }))}
                      >
                        From start
                      </button>
                    ) : null}
                    {isAdmin && versionCount > 1 && !file.preferred ? (
                      <button
                        className="btn btn-ghost btn-sm"
                        type="button"
                        disabled={preferring === file.path}
                        onClick={() => void onPrefer(file)}
                      >
                        Prefer
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
