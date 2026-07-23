import { useEffect, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { api } from './api'
import type { AuthUser } from './types'
import { AdminPage } from './pages/AdminPage'
import { DetailPage } from './pages/DetailPage'
import { HomePage } from './pages/HomePage'
import { LoginPage } from './pages/LoginPage'
import { PlayerPage } from './pages/PlayerPage'

export default function App() {
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined)

  useEffect(() => {
    const theme = localStorage.getItem('wtf_theme') || 'dark'
    document.documentElement.dataset.theme = theme
  }, [])

  useEffect(() => {
    api
      .me()
      .then((r) => setUser(r.authed && r.user ? r.user : null))
      .catch(() => setUser(null))
  }, [])

  useEffect(() => {
    const onUnauthorized = () => setUser(null)
    window.addEventListener('wtf:unauthorized', onUnauthorized)
    return () => window.removeEventListener('wtf:unauthorized', onUnauthorized)
  }, [])

  if (user === undefined) {
    return <div className="loading">Starting WatchTheFlix…</div>
  }

  if (!user) {
    return (
      <LoginPage
        onSuccess={() => {
          void api.me().then((r) => setUser(r.user))
        }}
      />
    )
  }

  const isAdmin = user.role === 'admin'

  return (
    <Routes>
      <Route
        path="/"
        element={
          <HomePage
            user={user}
            onLogout={() => setUser(null)}
          />
        }
      />
      <Route
        path="/admin"
        element={
          isAdmin ? (
            <AdminPage user={user} onLogout={() => setUser(null)} />
          ) : (
            <Navigate to="/" replace />
          )
        }
      />
      <Route path="/movie/:id" element={<DetailPage kind="movie" />} />
      <Route path="/tv/:id" element={<DetailPage kind="tv" />} />
      <Route path="/play" element={<PlayerPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
