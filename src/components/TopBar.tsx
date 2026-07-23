import type { ReactNode } from 'react'
import { Link, NavLink } from 'react-router-dom'

export type NavKey = 'home' | 'movies' | 'tv' | 'my-list'

type Props = {
  search?: string
  onSearchChange?: (value: string) => void
  searchPlaceholder?: string
  actions?: ReactNode
  showSearch?: boolean
  /** Small pill next to the brand (e.g. Admin). */
  badge?: string
  /** Highlight the active primary nav item. */
  navActive?: NavKey
  /** Hide consumer nav (admin pages). */
  hideNav?: boolean
}

const NAV: Array<{ key: NavKey; to: string; label: string; end?: boolean }> = [
  { key: 'home', to: '/', label: 'Home', end: true },
  { key: 'movies', to: '/movies', label: 'Movies' },
  { key: 'tv', to: '/tv', label: 'TV Shows' },
  { key: 'my-list', to: '/my-list', label: 'My List' },
]

export function TopBar({
  search = '',
  onSearchChange,
  searchPlaceholder = 'Search titles… (/)',
  actions,
  showSearch = false,
  badge,
  navActive,
  hideNav = false,
}: Props) {
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <div className="topbar-brand-block">
          <Link to="/" className="brand" aria-label="WatchTheFlix home">
            <span className="brand-mark" aria-hidden />
            Watch<span>The</span>Flix
          </Link>
          {badge ? <span className="topbar-badge">{badge}</span> : null}
        </div>

        {!hideNav ? (
          <nav className="topbar-nav" aria-label="Browse">
            {NAV.map((item) => (
              <NavLink
                key={item.key}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `topbar-nav-link${isActive || navActive === item.key ? ' is-active' : ''}`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        ) : null}

        {showSearch && onSearchChange ? (
          <label className="topbar-search">
            <span className="sr-only">Search</span>
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <path
                fill="currentColor"
                d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5Zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14Z"
              />
            </svg>
            <input
              id="wtf-topbar-search"
              type="search"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={searchPlaceholder}
              autoComplete="off"
            />
            {search ? (
              <button
                className="search-clear"
                type="button"
                aria-label="Clear search"
                onClick={() => onSearchChange('')}
              >
                ×
              </button>
            ) : null}
          </label>
        ) : (
          <div className="topbar-spacer" />
        )}

        <div className="topbar-actions">
          <div className="topbar-actions-inner">{actions}</div>
        </div>
      </div>
    </header>
  )
}
