import { useEffect, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { api } from './api'
import { AdminPage } from './pages/AdminPage'
import { DetailPage } from './pages/DetailPage'
import { HomePage } from './pages/HomePage'
import { LoginPage } from './pages/LoginPage'
import { PlayerPage } from './pages/PlayerPage'

export default function App() {
  const [authed, setAuthed] = useState<boolean | null>(null)

  useEffect(() => {
    api
      .me()
      .then((r) => setAuthed(r.authed))
      .catch(() => setAuthed(false))
  }, [])

  if (authed === null) {
    return <div className="loading">Starting WatchTheFlix…</div>
  }

  if (!authed) {
    return <LoginPage onSuccess={() => setAuthed(true)} />
  }

  return (
    <Routes>
      <Route path="/" element={<HomePage onLogout={() => setAuthed(false)} />} />
      <Route path="/admin" element={<AdminPage onLogout={() => setAuthed(false)} />} />
      <Route path="/movie/:id" element={<DetailPage kind="movie" />} />
      <Route path="/tv/:id" element={<DetailPage kind="tv" />} />
      <Route path="/play" element={<PlayerPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
