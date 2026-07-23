import { useEffect, useState } from 'react'
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { api } from './api'
import type { AuthUser } from './types'
import { AdminPage } from './pages/AdminPage'
import { BrowsePage } from './pages/BrowsePage'
import { DetailPage } from './pages/DetailPage'
import { HomePage } from './pages/HomePage'
import { LoginPage } from './pages/LoginPage'
import { PlayerPage } from './pages/PlayerPage'
import { ProfilesPage } from './pages/ProfilesPage'
import { clearProfileReady, isProfileReady, markProfileReady } from './utils/profileGate'

function ProfilesRoute({ onReady }: { onReady: () => void }) {
  const navigate = useNavigate()
  return (
    <ProfilesPage
      allowAutoEnter={false}
      onSelected={() => {
        onReady()
        navigate('/', { replace: true })
      }}
    />
  )
}

export default function App() {
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined)
  const [profileReady, setProfileReady] = useState(() => isProfileReady())

  useEffect(() => {
    api
      .me()
      .then((r) => setUser(r.authed && r.user ? r.user : null))
      .catch(() => setUser(null))
  }, [])

  useEffect(() => {
    const onUnauthorized = () => {
      clearProfileReady()
      setProfileReady(false)
      setUser(null)
    }
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
          clearProfileReady()
          setProfileReady(false)
          void api.me().then((r) => setUser(r.user))
        }}
      />
    )
  }

  if (!profileReady) {
    return (
      <ProfilesPage
        onSelected={() => {
          markProfileReady()
          setProfileReady(true)
        }}
      />
    )
  }

  const isAdmin = user.role === 'admin'
  const handleLogout = () => {
    clearProfileReady()
    setProfileReady(false)
    setUser(null)
  }

  return (
    <Routes>
      <Route path="/" element={<HomePage user={user} onLogout={handleLogout} />} />
      <Route
        path="/movies"
        element={<BrowsePage mode="movies" user={user} onLogout={handleLogout} />}
      />
      <Route path="/tv" element={<BrowsePage mode="tv" user={user} onLogout={handleLogout} />} />
      <Route
        path="/my-list"
        element={<BrowsePage mode="my-list" user={user} onLogout={handleLogout} />}
      />
      <Route
        path="/profiles"
        element={
          <ProfilesRoute
            onReady={() => {
              markProfileReady()
              setProfileReady(true)
            }}
          />
        }
      />
      <Route
        path="/admin"
        element={
          isAdmin ? (
            <AdminPage user={user} onLogout={handleLogout} />
          ) : (
            <Navigate to="/" replace />
          )
        }
      />
      <Route
        path="/movie/:id"
        element={<DetailPage kind="movie" user={user} onLogout={handleLogout} />}
      />
      <Route
        path="/tv/:id"
        element={<DetailPage kind="tv" user={user} onLogout={handleLogout} />}
      />
      <Route path="/play" element={<PlayerPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
