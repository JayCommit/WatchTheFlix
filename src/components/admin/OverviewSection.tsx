import type { AdminOverview } from '../../types'
import { relativeAge } from '../../utils/relativeAge'
import { AdminSkeleton } from './AdminSkeleton'
import { NowPlayingRow } from './NowPlayingSection'
import type { Section } from './types'

export function OverviewSection(props: {
  overview: AdminOverview | null
  error: string
  scanning: boolean
  onRetry: () => void
  onScan: () => void
  onGo: (s: Section, opts?: { kind?: 'movie' | 'tv' }) => void
  onOpenTitle: (id: number) => void
}) {
  const { overview, error } = props
  if (error && !overview) {
    return (
      <div className="empty-state admin-empty">
        <h2>Couldn’t load overview</h2>
        <p>{error}</p>
        <button className="btn btn-primary" type="button" onClick={props.onRetry}>
          Retry
        </button>
      </div>
    )
  }
  if (!overview) return <AdminSkeleton rows={6} />

  const s = overview.stats
  return (
    <div className="admin-overview">
      <div className="admin-section-row" style={{ marginBottom: '1rem' }}>
        <p className="muted" style={{ margin: 0 }}>
          Last scan {relativeAge(overview.lastScan)}
        </p>
        <button
          className="btn btn-primary btn-sm"
          type="button"
          disabled={props.scanning}
          onClick={props.onScan}
        >
          {props.scanning ? 'Scanning…' : 'Scan library'}
        </button>
      </div>
      <div className="admin-stat-grid">
        <StatCard
          label="Movies"
          value={s.movies}
          onClick={() => props.onGo('library', { kind: 'movie' })}
        />
        <StatCard
          label="Shows"
          value={s.shows}
          onClick={() => props.onGo('library', { kind: 'tv' })}
        />
        <StatCard label="Files" value={s.files} sub={`${s.movieFiles} movie · ${s.tvFiles} TV`} />
        <StatCard
          label="Unmatched"
          value={s.unmatched}
          warn={s.unmatched > 0}
          onClick={() => props.onGo('unmatched')}
        />
        <StatCard
          label="Now playing"
          value={overview.nowPlayingCount}
          onClick={() => props.onGo('now')}
        />
        <StatCard
          label="Known runtime"
          value={s.knownDurationHours}
          sub="hours from watched files"
          suffix="h"
        />
        <StatCard
          label="FFmpeg"
          value={overview.ffmpegAvailable ? 'OK' : 'Off'}
          warn={!overview.ffmpegAvailable}
        />
        <StatCard
          label="Last scan"
          value={relativeAge(overview.lastScan)}
          small
          onClick={() => props.onGo('tools')}
        />
      </div>

      <section className="admin-panel">
        <div className="section-head admin-section-row">
          <h2>Now playing</h2>
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => props.onGo('now')}>
            View all
          </button>
        </div>
        {overview.nowPlaying.length === 0 ? (
          <p className="muted">Nobody is watching right now.</p>
        ) : (
          <ul className="admin-np-list compact">
            {overview.nowPlaying.map((sess) => (
              <NowPlayingRow
                key={sess.clientId}
                session={sess}
                onOpenTitle={props.onOpenTitle}
              />
            ))}
          </ul>
        )}
      </section>

      <section className="admin-panel">
        <div className="section-head">
          <h2>Recently added</h2>
        </div>
        {overview.recent.length === 0 ? (
          <p className="muted">Scan the library to populate recent titles.</p>
        ) : (
          <ul className="admin-recent-grid">
            {overview.recent.map((t) => (
              <li key={t.id}>
                <button type="button" onClick={() => props.onOpenTitle(t.id)}>
                  <div className="admin-thumb">
                    {t.poster ? <img src={t.poster} alt="" loading="lazy" /> : <span>?</span>}
                  </div>
                  <span>
                    <strong>{t.title}</strong>
                    <em className="muted">{relativeAge(t.scannedAt)}</em>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function StatCard(props: {
  label: string
  value: string | number
  sub?: string
  warn?: boolean
  small?: boolean
  suffix?: string
  onClick?: () => void
}) {
  const className = `admin-stat-card${props.warn ? ' warn' : ''}${props.onClick ? ' clickable' : ''}`
  const inner = (
    <>
      <span className="admin-stat-label">{props.label}</span>
      <strong className={props.small ? 'small' : ''}>
        {props.value}
        {props.suffix ? <span className="suffix">{props.suffix}</span> : null}
      </strong>
      {props.sub ? <span className="muted">{props.sub}</span> : null}
    </>
  )
  if (props.onClick) {
    return (
      <button type="button" className={className} onClick={props.onClick}>
        {inner}
      </button>
    )
  }
  return <div className={className}>{inner}</div>
}
