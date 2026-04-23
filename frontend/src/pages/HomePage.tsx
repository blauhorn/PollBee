import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchHealth } from '../api'

export default function HomePage() {
  const [health, setHealth] = useState<string>('lädt...')
  const [error, setError] = useState<string>('')

  useEffect(() => {
    async function load() {
      try {
        const data = await fetchHealth()
        setHealth(data.status)
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Unbekannter Fehler'
        setError(message)
      }
    }

    void load()
  }, [])

  return (
    <main>
      <p>
        API-Status: <strong>{health}</strong>
      </p>

      {error ? <p style={{ color: 'crimson' }}>Fehler: {error}</p> : null}

      <p>Willkommen zur Web-App für NTSO-Umfragen.</p>

      <p>
        <Link to="/login">Zum Login</Link>
      </p>

      <p>
        <Link to="/polls">Zur Poll-Liste</Link>
      </p>
    </main>
  )
}
