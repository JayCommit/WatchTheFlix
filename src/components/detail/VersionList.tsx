import type { MediaFile, TitleDetail } from '../../types'
import { formatBytes, formatTime, isLikelyUnsupported, sortMediaFiles } from '../../utils/format'
import { hasResume, playUrl } from '../../utils/playUrl'

type Props = {
  detail: TitleDetail
  isAdmin: boolean
  preferring: string | null
  onPrefer: (file: MediaFile) => void
  onPlay: (url: string) => void
}

export function VersionList({ detail, isAdmin, preferring, onPrefer, onPlay }: Props) {
  if (detail.files.length === 0) {
    return (
      <section className="section">
        <div className="section-head">
          <h2>File</h2>
        </div>
        <div className="empty-inline">
          <p>No playable files for this title yet. Scan the library or rematch the path.</p>
        </div>
      </section>
    )
  }

  return (
    <section className="section">
      <div className="section-head">
        <h2>{detail.files.length > 1 ? 'Versions' : 'File'}</h2>
      </div>
      <div className="episode-list" role="list">
        {sortMediaFiles(detail.files).map((file) => {
          const unsupported = isLikelyUnsupported(file.filename)
          const resume = hasResume(file)
          return (
            <div key={file.path} className="episode-item" role="listitem">
              <button
                className="episode-item-main"
                type="button"
                onClick={() => onPlay(playUrl(detail, file))}
              >
                <strong className="ep-code">File</strong>
                <div className="ep-body">
                  <strong>
                    {file.filename}
                    {file.label ? <span className="version-pill">{file.label}</span> : null}
                    {file.preferred ? (
                      <span className="version-pill preferred">Preferred</span>
                    ) : null}
                  </strong>
                  <span>
                    {resume
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
                <span className="ep-cta">{resume ? 'Resume' : 'Play'}</span>
              </button>
              {(resume || (isAdmin && detail.files.length > 1 && !file.preferred)) ? (
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
                  {isAdmin && detail.files.length > 1 && !file.preferred ? (
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
    </section>
  )
}
