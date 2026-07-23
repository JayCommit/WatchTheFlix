import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

type Props = {
  search?: string
  onSearchChange?: (value: string) => void
  searchPlaceholder?: string
  actions?: ReactNode
  showSearch?: boolean
}

export function TopBar({
  search = '',
  onSearchChange,
  searchPlaceholder = 'Search titles…',
  actions,
  showSearch = false,
}: Props) {
  return (
    <header className="topbar">
      <Link to="/" className="brand" aria-label="WatchTheFlix home">
        Watch<span>The</span>Flix
      </Link>


      {showSearch && onSearchChange ? (
        <label className="topbar-search">
          <span className="sr-only">Search</span>
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path
              fill="currentColor"
              d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5Zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14Z"
            />
          </svg>
          <input
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

      <div className="topbar-actions">{actions}</div>
    </header>
  )
}
