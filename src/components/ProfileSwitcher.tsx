import { useEffect, useState } from 'react'
import { api } from '../api'

export function ProfileSwitcher() {
  const [profiles, setProfiles] = useState<Array<{ id: number; name: string }>>([])
  const [activeId, setActiveId] = useState(1)
  const [name, setName] = useState('')

  useEffect(() => {
    void api
      .profiles()
      .then((r) => {
        setProfiles(r.profiles)
        setActiveId(r.activeId)
      })
      .catch(() => undefined)
  }, [])

  if (!profiles.length) return null

  return (
    <div className="profile-switcher">
      <label>
        <span className="sr-only">Profile</span>
        <select
          value={activeId}
          onChange={(e) => {
            const id = Number(e.target.value)
            void api.selectProfile(id).then(() => {
              setActiveId(id)
              window.location.reload()
            })
          }}
        >
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <form
        className="profile-add"
        onSubmit={(e) => {
          e.preventDefault()
          if (!name.trim()) return
          void api.createProfile(name.trim()).then((r) => {
            setProfiles((prev) => [...prev, r.profile])
            setName('')
          })
        }}
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New profile"
          aria-label="New profile name"
        />
      </form>
    </div>
  )
}
