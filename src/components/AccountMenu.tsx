import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import type { AuthUser } from '../types'
import { clearProfileReady, profileAvatarColors, profileInitials } from '../utils/profileGate'

type Profile = { id: number; name: string }

type Props = {
  user: AuthUser
  onLogout: () => void
  onScan?: () => void
  scanning?: boolean
}

export function AccountMenu({ user, onLogout, onScan, scanning }: Props) {
  const isAdmin = user.role === 'admin'
  const [open, setOpen] = useState(false)
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [activeId, setActiveId] = useState<number | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void api
      .profiles()
      .then((r) => {
        setProfiles(r.profiles)
        setActiveId(r.activeId)
      })
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const active = profiles.find((p) => p.id === activeId) ?? profiles[0]
  const [c1, c2] = profileAvatarColors(active?.id ?? user.id)

  async function logout() {
    clearProfileReady()
    await api.logout()
    onLogout()
  }

  return (
    <div className="account-menu" ref={rootRef}>
      <button
        type="button"
        className="account-trigger"
        aria-label="Account menu"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
      >
        <span
          className="account-avatar"
          style={{ background: `linear-gradient(145deg, ${c1}, ${c2})` }}
          aria-hidden
        >
          {profileInitials(active?.name ?? user.username)}
        </span>
        <span className="account-trigger-label hide-sm">
          {active?.name ?? user.username}
        </span>
        <span className="account-caret hide-sm" aria-hidden>
          ▾
        </span>
      </button>

      {open ? (
        <div className="account-dropdown" role="menu">
          <div className="account-dropdown-head">
            <span
              className="account-avatar lg"
              style={{ background: `linear-gradient(145deg, ${c1}, ${c2})` }}
              aria-hidden
            >
              {profileInitials(active?.name ?? user.username)}
            </span>
            <div>
              <strong>{active?.name ?? user.username}</strong>
              <span className="muted">
                {user.username}
                {isAdmin ? ' · admin' : ''}
              </span>
            </div>
          </div>

          {profiles.length > 1 ? (
            <div className="account-profiles">
              <p className="account-section-label">Switch profile</p>
              {profiles.map((p) => {
                const [a, b] = profileAvatarColors(p.id)
                return (
                  <button
                    key={p.id}
                    type="button"
                    role="menuitem"
                    className={`account-profile-item${p.id === activeId ? ' is-active' : ''}`}
                    onClick={() => {
                      void api.selectProfile(p.id).then(() => {
                        window.location.reload()
                      })
                    }}
                  >
                    <span
                      className="account-avatar sm"
                      style={{ background: `linear-gradient(145deg, ${a}, ${b})` }}
                      aria-hidden
                    >
                      {profileInitials(p.name)}
                    </span>
                    {p.name}
                  </button>
                )
              })}
            </div>
          ) : null}

          <div className="account-menu-actions">
            <Link
              role="menuitem"
              className="account-item"
              to="/profiles"
              onClick={() => {
                clearProfileReady()
                setOpen(false)
              }}
            >
              Who’s watching
            </Link>
            <Link role="menuitem" className="account-item" to="/my-list" onClick={() => setOpen(false)}>
              My List
            </Link>
            {isAdmin ? (
              <Link role="menuitem" className="account-item" to="/admin" onClick={() => setOpen(false)}>
                Manage library
              </Link>
            ) : null}
            {isAdmin && onScan ? (
              <button
                type="button"
                role="menuitem"
                className="account-item"
                disabled={scanning}
                onClick={() => {
                  setOpen(false)
                  onScan()
                }}
              >
                {scanning ? 'Scanning…' : 'Scan library'}
              </button>
            ) : null}
            <button type="button" role="menuitem" className="account-item danger" onClick={() => void logout()}>
              Sign out
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
