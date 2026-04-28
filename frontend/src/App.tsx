import { useEffect, useState } from 'react'
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import Layout from './components/Layout'
import PollListPage from './pages/PollListPage'
import PollDetailPage from './pages/PollDetailPage'
import PollResolverPage from './pages/PollResolverPage'
import LoginPage from './pages/LoginPage'
import { fetchMe, logout, type User } from './api'
import PollDebugPage from './pages/PollDebugPage'
import { Toaster } from 'react-hot-toast'

export default function App() {
  const navigate = useNavigate()
  const [currentUser, setCurrentUser] = useState<User | null>(null)
  const [authChecked, setAuthChecked] = useState(false)

  async function refreshCurrentUser() {
    try {
      const user = await fetchMe()
      setCurrentUser(user)
    } catch {
      setCurrentUser(null)
    } finally {
      setAuthChecked(true)
    }
  }

  async function handleLogout() {
    await logout()
    setCurrentUser(null)
    navigate('/login')
  }

  useEffect(() => {
    void refreshCurrentUser()
  }, [])

  if (!authChecked) {
    return <p style={{ padding: '1rem' }}>Prüfe Anmeldung...</p>
  }

    return (
    <>
      <Routes>
        <Route
          path="/"
          element={<Layout currentUser={currentUser} onLogout={handleLogout} />}
        >
          <Route
            index
            element={
              currentUser ? (
                <Navigate to="/polls" replace />
              ) : (
                <Navigate to="/login" replace />
              )
            }
          />

          <Route path="login" element={<LoginPage />} />

          <Route path="polls" element={<PollListPage />} />
          <Route path="polls/:pollId" element={<PollResolverPage />} />
          <Route path="polls/:pollId/debug" element={<PollDebugPage />} />

          <Route path=":filterText" element={<PollListPage />} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>

      <Toaster
        position="top-right"
        toastOptions={{
          duration: 3000,
          style: {
            background: '#1f2937',
            color: '#fff',
          },
        }}
      />
    </>
  )
}