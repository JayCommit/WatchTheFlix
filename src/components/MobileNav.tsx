import { NavLink } from 'react-router-dom'

const links = [
  { to: '/', label: 'Home', end: true },
  { to: '/movies', label: 'Movies', end: false },
  { to: '/tv', label: 'TV', end: false },
  { to: '/my-list', label: 'My List', end: false },
] as const

export function MobileNav() {
  return (
    <nav className="mobile-nav" aria-label="Primary">
      {links.map((l) => (
        <NavLink
          key={l.to}
          to={l.to}
          end={l.end}
          className={({ isActive }) => `mobile-nav-link${isActive ? ' is-active' : ''}`}
        >
          <span className="mobile-nav-icon" aria-hidden>
            {l.to === '/' ? '⌂' : l.to === '/movies' ? '▶' : l.to === '/tv' ? '▦' : '+'}
          </span>
          {l.label}
        </NavLink>
      ))}
    </nav>
  )
}
