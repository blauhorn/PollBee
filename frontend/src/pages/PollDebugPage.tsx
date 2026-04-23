import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { fetchPollDebug, type PollDebugData } from '../api'

export default function PollDebugPage() {
  const { pollId } = useParams<{ pollId: string }>()
  const navigate = useNavigate()
  const [data, setData] = useState<PollDebugData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    async function load() {
      if (!pollId) {
        setError('Keine Poll-ID vorhanden.')
        setLoading(false)
        return
      }

      try {
        const debugData = await fetchPollDebug(pollId)
        setData(debugData)
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Unbekannter Fehler'

        if (message.includes('401')) {
          navigate('/login')
          return
        }

        setError(message)
      } finally {
        setLoading(false)
      }
    }

    void load()
  }, [pollId, navigate])

  if (loading) {
    return <p>Lade Debug-Daten...</p>
  }

  if (error) {
    return (
      <main>
        <p style={{ color: 'crimson' }}>Fehler: {error}</p>
        <p>
          <Link to="/polls">Zurück zur Poll-Liste</Link>
        </p>
      </main>
    )
  }

  if (!data) {
    return (
      <main>
        <p>Keine Debug-Daten vorhanden.</p>
      </main>
    )
  }

  return (
    <main>
      <p>
        <Link to={`/polls/${pollId}`}>← Zurück zur Detailseite</Link>
      </p>

      <h2>Debug-Daten für Poll {pollId}</h2>

      <p>
        <strong>Aktueller Nutzer:</strong> {data.currentUser.displayName} ({data.currentUser.id})
      </p>

      <h3>Poll</h3>
      <pre style={{ whiteSpace: 'pre-wrap', overflowX: 'auto' }}>
        {JSON.stringify(data.poll, null, 2)}
      </pre>

      <h3>Optionen</h3>
      <pre style={{ whiteSpace: 'pre-wrap', overflowX: 'auto' }}>
        {JSON.stringify(data.options, null, 2)}
      </pre>

      <h3>Votes</h3>
      <pre style={{ whiteSpace: 'pre-wrap', overflowX: 'auto' }}>
        {JSON.stringify(data.votes, null, 2)}
      </pre>
    </main>
  )
}
