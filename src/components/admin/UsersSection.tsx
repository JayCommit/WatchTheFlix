import { useEffect, useState } from 'react'
import { api } from '../../api'
import type { AuthUser } from '../../types'
import { AdminSkeleton } from './AdminSkeleton'

export function UsersSection(props: { currentUser: AuthUser; notify: (msg: string) => void }) {
  const [users, setUsers] = useState<AuthUser[]>([])
  const [loading, setLoading] = useState(true)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<'user' | 'admin'>('user')

  async function refresh() {
    setLoading(true)
    try {
      const res = await api.adminUsers()
      setUsers(res.users)
    } catch (err) {
      props.notify(err instanceof Error ? err.message : 'Failed to load users')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="admin-convert">
      <section className="admin-card">
        <div className="section-head">
          <h2>Create user</h2>
        </div>
        <form
          className="admin-inline-form"
          onSubmit={(e) => {
            e.preventDefault()
            void (async () => {
              try {
                await api.adminCreateUser({ username, password, role })
                props.notify(`Created ${username}`)
                setUsername('')
                setPassword('')
                setRole('user')
                await refresh()
              } catch (err) {
                props.notify(err instanceof Error ? err.message : 'Create failed')
              }
            })()
          }}
        >
          <input
            className="admin-input"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            minLength={3}
          />
          <input
            className="admin-input"
            type="password"
            placeholder="Password (8+)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
          />
          <select
            className="admin-select"
            value={role}
            onChange={(e) => setRole(e.target.value as 'user' | 'admin')}
          >
            <option value="user">User</option>
            <option value="admin">Admin</option>
          </select>
          <button className="btn btn-primary" type="submit">
            Add
          </button>
        </form>
        <p className="muted">
          First account on a fresh install is always admin. Public self-register is off unless{' '}
          <code>ALLOW_PUBLIC_REGISTRATION=true</code>.
        </p>
      </section>

      <section className="admin-card">
        <div className="section-head">
          <h2>Accounts</h2>
          <button className="btn btn-ghost" type="button" onClick={() => void refresh()}>
            Refresh
          </button>
        </div>
        {loading ? (
          <AdminSkeleton rows={4} />
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <strong>{u.username}</strong>
                      {u.id === props.currentUser.id ? (
                        <span className="muted"> · you</span>
                      ) : null}
                    </td>
                    <td>
                      <select
                        value={u.role}
                        disabled={u.id === props.currentUser.id}
                        onChange={(e) => {
                          const next = e.target.value as 'admin' | 'user'
                          void api
                            .adminPatchUser(u.id, { role: next })
                            .then(() => refresh())
                            .catch((err) =>
                              props.notify(err instanceof Error ? err.message : 'Update failed'),
                            )
                        }}
                      >
                        <option value="user">User</option>
                        <option value="admin">Admin</option>
                      </select>
                    </td>
                    <td>{u.disabled ? <span className="error-text">Disabled</span> : 'Active'}</td>
                    <td>
                      <div className="admin-actions">
                        <button
                          className="btn btn-ghost btn-sm"
                          type="button"
                          onClick={() => {
                            const next = window.prompt(`New password for ${u.username} (min 8 chars)`)
                            if (next == null) return
                            if (next.trim().length < 8) {
                              props.notify('Password must be at least 8 characters')
                              return
                            }
                            void api
                              .adminPatchUser(u.id, { password: next.trim() })
                              .then(() => props.notify(`Password reset for ${u.username}`))
                              .catch((err) =>
                                props.notify(
                                  err instanceof Error ? err.message : 'Password reset failed',
                                ),
                              )
                          }}
                        >
                          Reset password
                        </button>
                        <button
                          className="btn btn-ghost btn-sm"
                          type="button"
                          disabled={u.id === props.currentUser.id}
                          onClick={() => {
                            void api
                              .adminPatchUser(u.id, { disabled: !u.disabled })
                              .then(() => refresh())
                              .catch((err) =>
                                props.notify(err instanceof Error ? err.message : 'Update failed'),
                              )
                          }}
                        >
                          {u.disabled ? 'Enable' : 'Disable'}
                        </button>
                        <button
                          className="btn btn-ghost btn-sm"
                          type="button"
                          disabled={u.id === props.currentUser.id}
                          onClick={() => {
                            if (!window.confirm(`Delete user ${u.username}?`)) return
                            void api
                              .adminDeleteUser(u.id)
                              .then(() => refresh())
                              .catch((err) =>
                                props.notify(err instanceof Error ? err.message : 'Delete failed'),
                              )
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
