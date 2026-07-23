import { useEffect, useState, type FormEvent } from 'react'
import { api } from '../api'
import { markProfileReady, profileAvatarColors, profileInitials } from '../utils/profileGate'

export type Profile = { id: number; name: string }

type Props = {
  onSelected: () => void
  /** When true, skip auto-enter for single-profile accounts (used by the post-login gate). */
  allowAutoEnter?: boolean
}

export function ProfilesPage({ onSelected, allowAutoEnter = true }: Props) {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [activeId, setActiveId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [busyId, setBusyId] = useState<number | null>(null)
  const [managing, setManaging] = useState(false)

  async function load() {
    setLoading(true)
    setError('')
    try {
      const r = await api.profiles()
      setProfiles(r.profiles)
      setActiveId(r.activeId)
      // Single profile → go straight in (post-login gate only)
      if (allowAutoEnter && r.profiles.length === 1) {
        const only = r.profiles[0]
        if (r.activeId !== only.id) {
          await api.selectProfile(only.id)
        }
        markProfileReady()
        onSelected()
        return
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load profiles')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function selectProfile(id: number) {
    if (managing) return
    setBusyId(id)
    setError('')
    try {
      await api.selectProfile(id)
      markProfileReady()
      onSelected()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not select profile')
      setBusyId(null)
    }
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault()
    const name = newName.trim()
    if (!name) return
    setCreating(true)
    setError('')
    try {
      const r = await api.createProfile(name)
      setProfiles((prev) => [...prev, r.profile])
      setNewName('')
      if (!managing && profiles.length === 0) {
        await api.selectProfile(r.profile.id)
        markProfileReady()
        onSelected()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create profile')
    } finally {
      setCreating(false)
    }
  }

  async function onDelete(id: number) {
    if (profiles.length <= 1) return
    const target = profiles.find((p) => p.id === id)
    if (!target) return
    if (!window.confirm(`Remove profile “${target.name}”? Watch progress for this profile will be lost.`)) {
      return
    }
    setBusyId(id)
    setError('')
    try {
      await api.deleteProfile(id)
      const next = profiles.filter((p) => p.id !== id)
      setProfiles(next)
      if (activeId === id && next[0]) {
        await api.selectProfile(next[0].id)
        setActiveId(next[0].id)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete profile')
    } finally {
      setBusyId(null)
    }
  }

  if (loading) {
    return <div className="loading">Loading profiles…</div>
  }

  return (
    <div className="profiles-screen page-enter">
      <div className="profiles-ambient" aria-hidden />
      <div className="profiles-panel">
        <p className="profiles-brand">
          Watch<span>The</span>Flix
        </p>
        <h1>{managing ? 'Manage profiles' : 'Who’s watching?'}</h1>
        <p className="profiles-sub">
          {managing
            ? 'Add or remove profiles. Each keeps its own watchlist and progress.'
            : 'Pick a profile to personalize your watchlist and continue watching.'}
        </p>

        <ul className="profiles-grid" role="list">
          {profiles.map((p, i) => {
            const [c1, c2] = profileAvatarColors(p.id)
            return (
              <li key={p.id} style={{ animationDelay: `${i * 60}ms` }}>
                <button
                  type="button"
                  className={`profile-tile${managing ? ' is-manage' : ''}${
                    busyId === p.id ? ' is-busy' : ''
                  }`}
                  onClick={() => void selectProfile(p.id)}
                  disabled={busyId != null}
                >
                  <span
                    className="profile-avatar"
                    style={{ background: `linear-gradient(145deg, ${c1}, ${c2})` }}
                    aria-hidden
                  >
                    {profileInitials(p.name)}
                  </span>
                  <span className="profile-name">{p.name}</span>
                  {activeId === p.id && !managing ? (
                    <span className="profile-active-dot" aria-label="Current" />
                  ) : null}
                </button>
                {managing && profiles.length > 1 ? (
                  <button
                    type="button"
                    className="profile-delete"
                    disabled={busyId != null}
                    onClick={() => void onDelete(p.id)}
                  >
                    Remove
                  </button>
                ) : null}
              </li>
            )
          })}

          {profiles.length < 5 ? (
            <li className="profile-add-tile" style={{ animationDelay: `${profiles.length * 60}ms` }}>
              {managing || profiles.length === 0 ? (
                <form className="profile-create-form" onSubmit={onCreate}>
                  <button
                    type="button"
                    className="profile-tile profile-tile-add"
                    onClick={() => {
                      const input = document.getElementById('wtf-new-profile') as HTMLInputElement | null
                      input?.focus()
                    }}
                    tabIndex={-1}
                    aria-hidden
                  >
                    <span className="profile-avatar profile-avatar-add" aria-hidden>
                      +
                    </span>
                    <span className="profile-name">Add profile</span>
                  </button>
                  <label className="profile-create-field">
                    <span className="sr-only">New profile name</span>
                    <input
                      id="wtf-new-profile"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder="Profile name"
                      maxLength={40}
                      disabled={creating}
                    />
                  </label>
                  <button
                    className="btn btn-primary btn-sm"
                    type="submit"
                    disabled={creating || !newName.trim()}
                  >
                    {creating ? 'Adding…' : 'Add'}
                  </button>
                </form>
              ) : (
                <button
                  type="button"
                  className="profile-tile profile-tile-add"
                  onClick={() => setManaging(true)}
                >
                  <span className="profile-avatar profile-avatar-add" aria-hidden>
                    +
                  </span>
                  <span className="profile-name">Add profile</span>
                </button>
              )}
            </li>
          ) : null}
        </ul>

        {error ? <p className="error-text profiles-error">{error}</p> : null}

        <div className="profiles-footer">
          {managing ? (
            <button type="button" className="btn btn-ghost" onClick={() => setManaging(false)}>
              Done
            </button>
          ) : (
            <button type="button" className="btn btn-ghost" onClick={() => setManaging(true)}>
              Manage profiles
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
