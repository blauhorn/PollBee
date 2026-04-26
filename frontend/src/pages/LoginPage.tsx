import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

type LoginFlowStartResponse = {
  stateId: string
  loginUrl: string
  expiresIn: number
}

type LoginFlowStatusResponse = {
  status: 'pending' | 'done' | 'failed'
  user?: {
    id: string
    displayName: string
  }
  error?: string
}

const API_BASE = import.meta.env.VITE_API_BASE || '/pollapp/api'
const LAST_SERVER_URL_KEY = 'pollapp:lastServerUrl'
const DEFAULT_SERVER_URL = import.meta.env.VITE_DEFAULT_SERVER_URL ?? ''

export default function LoginPage() {
  const navigate = useNavigate()

  const [serverUrl, setServerUrl] = useState(
    () => localStorage.getItem(LAST_SERVER_URL_KEY) || DEFAULT_SERVER_URL,
  )
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const pollTimerRef = useRef<number | null>(null)

  function clearPollTimer() {
    if (pollTimerRef.current !== null) {
      window.clearInterval(pollTimerRef.current)
      pollTimerRef.current = null
    }
  }

  function startPolling(stateId: string) {
    clearPollTimer()
    pollTimerRef.current = window.setInterval(() => {
      void pollLoginStatus(stateId)
    }, 1500)
  }

  useEffect(() => {
    async function checkSession() {
      try {
        const response = await fetch(`${API_BASE}/auth/me`, {
          credentials: 'include',
        })

        if (response.ok) {
          navigate('/polls', { replace: true })
        }
      } catch {
        // bewusst still
      }
    }

    void checkSession()

    return () => {
      clearPollTimer()
    }
  }, [navigate])

  async function startLoginFlow() {
    const trimmedUrl = serverUrl.trim()

    if (!trimmedUrl) {
      setError('Bitte eine Server-URL eingeben.')
      return
    }

    setLoading(true)
    setError('')
    setMessage('Verbindung wird vorbereitet ...')

    // Wichtig: synchron im User-Klick öffnen, aber OHNE noopener/noreferrer,
    // damit wir ein benutzbares Window-Objekt zurückbekommen.
    const popup = window.open('', '_blank')

    try {
      const response = await fetch(`${API_BASE}/auth/login-flow/start`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          baseUrl: trimmedUrl,
        }),
      })

      if (!response.ok) {
        const text = await response.text()
        throw new Error(text || `Login-Flow Start fehlgeschlagen: ${response.status}`)
      }

      const data = (await response.json()) as LoginFlowStartResponse

      localStorage.setItem(LAST_SERVER_URL_KEY, trimmedUrl)

      if (popup) {
        popup.location.href = data.loginUrl
        setMessage('Anmeldung im Browser abschließen ...')
        startPolling(data.stateId)
        return
      }

      // Nur wenn wirklich GAR kein Popup geöffnet werden konnte:
      setMessage(
        'Anmeldung wird geöffnet. Nach erfolgreicher Anmeldung bitte zu PollBee zurückkehren.',
      )
      window.location.assign(data.loginUrl)
    } catch (err) {
      if (popup && !popup.closed) {
        popup.close()
      }

      const nextMessage =
        err instanceof Error ? err.message : 'Unbekannter Fehler beim Start des Login-Flows'

      setError(nextMessage)
      setMessage('')
      setLoading(false)
    }
  }

  async function pollLoginStatus(stateId: string) {
    try {
      const response = await fetch(`${API_BASE}/auth/login-flow/status/${stateId}`, {
        credentials: 'include',
      })

      if (!response.ok) {
        const text = await response.text()
        throw new Error(text || `Login-Status fehlgeschlagen: ${response.status}`)
      }

      const data = (await response.json()) as LoginFlowStatusResponse

      if (data.status === 'pending') {
        return
      }

      clearPollTimer()

      if (data.status === 'failed') {
        setError(data.error || 'Anmeldung fehlgeschlagen.')
        setMessage('')
        setLoading(false)
        return
      }

      setError('')
      setMessage(`Angemeldet als ${data.user?.displayName ?? 'Benutzer'}.`)
      setLoading(false)
      navigate('/polls', { replace: true })
    } catch (err) {
      clearPollTimer()

      const nextMessage =
        err instanceof Error
          ? err.message
          : 'Unbekannter Fehler beim Prüfen des Login-Status'

      setError(nextMessage)
      setMessage('')
      setLoading(false)
    }
  }

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
        background: '#ffffff',
      }}
    >
      <section
        style={{
          width: '100%',
          maxWidth: '32rem',
          border: '1px solid #d9dee7',
          borderRadius: '1rem',
          padding: '1.25rem',
          background: '#ffffff',
        }}
      >
        <h1
          style={{
            margin: '0 0 0.5rem 0',
            fontSize: '1.4rem',
            lineHeight: 1.2,
          }}
        >
          NTSO PollApp
        </h1>

        <p
          style={{
            margin: '0 0 1rem 0',
            color: '#4b5563',
            lineHeight: 1.45,
          }}
        >
          Mit Nextcloud verbinden, um Umfragen anzuzeigen, abzustimmen und auszuwerten.
        </p>

        <label
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.35rem',
            marginBottom: '1rem',
          }}
        >
          <span style={{ fontSize: '0.95rem', fontWeight: 600 }}>Server-URL</span>
          <input
            type="url"
            value={serverUrl}
            onChange={(e) => setServerUrl(e.target.value)}
            placeholder="https://deine-nextcloud.example"
            autoComplete="url"
            style={{
              padding: '0.75rem 0.85rem',
              border: '1px solid #d1d5db',
              borderRadius: '0.6rem',
              font: 'inherit',
            }}
          />
        </label>

        <button
          type="button"
          onClick={() => {
            void startLoginFlow()
          }}
          disabled={loading}
          style={{
            width: '100%',
            padding: '0.8rem 1rem',
            border: '1px solid #cbd5e1',
            borderRadius: '0.65rem',
            background: loading ? '#f3f4f6' : '#f9fafb',
            cursor: loading ? 'default' : 'pointer',
            font: 'inherit',
            fontWeight: 600,
          }}
        >
          {loading ? 'Verbindung läuft ...' : 'Mit Nextcloud verbinden'}
        </button>

        {message ? (
          <p style={{ margin: '1rem 0 0 0', color: '#374151' }}>{message}</p>
        ) : null}

        {error ? (
          <p style={{ margin: '1rem 0 0 0', color: 'crimson' }}>{error}</p>
        ) : null}
      </section>
    </main>
  )
}