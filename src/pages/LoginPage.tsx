import { useEffect, useState, type FormEvent } from 'react'
import { api } from '../api'

type Props = {
  onSuccess: () => void
}

export function LoginPage({ onSuccess }: Props) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [setupRequired, setSetupRequired] = useState(false)
  const [allowRegister, setAllowRegister] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    void api
      .authStatus()
      .then((s) => {
        setSetupRequired(s.setupRequired)
        setAllowRegister(s.allowRegister)
        if (s.setupRequired) setMode('register')
      })
      .catch(() => undefined)
      .finally(() => setReady(true))
  }, [])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      if (mode === 'register') {
        await api.register(username, password)
      } else {
        await api.login(username, password)
      }
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed')
    } finally {
      setLoading(false)
    }
  }

  if (!ready) {
    return <div className="loading">Starting WatchTheFlix…</div>
  }

  return (
    <div className="login-screen page-enter">
      <div className="login-panel">
        <p className="login-eyebrow">Private cinema</p>
        <h1>
          Watch<span>The</span>Flix
        </h1>
        {setupRequired ? (
          <p>Create your admin account to open the house.</p>
        ) : (
          <p>Sign in to pick up where you left off.</p>
        )}
        <form className="login-form" onSubmit={onSubmit}>
          <label className="field-label">
            <span>Username</span>
            <input
              type="text"
              autoFocus
              placeholder="your name"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              minLength={3}
              maxLength={32}
              required
            />
          </label>
          <label className="field-label">
            <span>Password</span>
            <input
              type="password"
              placeholder="min 8 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              minLength={8}
              required
            />
          </label>
          {password.length > 0 && password.length < 8 ? (
            <p className="muted login-hint">Password must be at least 8 characters.</p>
          ) : null}
          <button
            className="btn btn-primary btn-block"
            type="submit"
            disabled={loading || !username || password.length < 8}
          >
            {loading
              ? 'Please wait…'
              : mode === 'register'
                ? setupRequired
                  ? 'Create admin'
                  : 'Create account'
                : 'Sign in'}
          </button>
          {error ? <div className="error-text">{error}</div> : null}
        </form>
        {!setupRequired && allowRegister ? (
          <p className="login-switch muted">
            {mode === 'login' ? (
              <>
                No account?{' '}
                <button type="button" className="linkish" onClick={() => setMode('register')}>
                  Register
                </button>
              </>
            ) : (
              <>
                Already have an account?{' '}
                <button type="button" className="linkish" onClick={() => setMode('login')}>
                  Sign in
                </button>
              </>
            )}
          </p>
        ) : null}
        {!setupRequired && !allowRegister && mode === 'login' ? (
          <p className="muted login-switch">Ask an admin if you need an account.</p>
        ) : null}
      </div>
    </div>
  )
}
