import { useState, type FormEvent } from 'react'
import { api } from '../api'

type Props = {
  onSuccess: () => void
}

export function LoginPage({ onSuccess }: Props) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      await api.login(password)
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-screen page-enter">
      <div className="login-panel">
        <h1>
          Watch<span>The</span>Flix
        </h1>
        <p>Your private cinema. Direct stream from the seedbox — no transcoding.</p>
        <form className="login-form" onSubmit={onSubmit}>
          <input
            type="password"
            autoFocus
            placeholder="App password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
          <button className="btn btn-primary" type="submit" disabled={loading || !password}>
            {loading ? 'Opening…' : 'Enter library'}
          </button>
          {error ? <div className="error-text">{error}</div> : null}
        </form>
      </div>
    </div>
  )
}
