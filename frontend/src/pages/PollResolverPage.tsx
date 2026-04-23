import { Navigate, useParams } from 'react-router-dom'
import PollDetailPage from './PollDetailPage'
import PollListPage from './PollListPage'

export default function PollResolverPage() {
  const { pollId } = useParams()
  const value = (pollId ?? '').trim()

  if (!value) {
    return <Navigate to="/polls" replace />
  }

  if (/^\d+$/.test(value)) {
    return <PollDetailPage forcedPollId={value} />
  }

  return <PollListPage initialFilter={value} />
}