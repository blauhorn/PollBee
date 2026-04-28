export type VoteValue = 'yes' | 'no' | 'maybe'

export type PollOption = {
  id: string
  label: string
  timestamp?: number
  confirmed?: number
  voteSummary?: {
    yes: number
    no: number
    maybe: number
    count: number
    missing?: number | null
    currentUser?: VoteValue
  }
}

export type Poll = {
  id: string
  title: string
  description: string
  status: string
  isClosed?: boolean
  dueDate: string
  summaryText: string
  options: PollOption[]
  owner?: string
  created?: number
}

export type PollParticipant = {
  participantId: string
  displayName: string
  emailAddress?: string
  type?: string
  isGuest?: boolean
  isNoUser?: boolean
  answersByOption: Record<string, string>
  publicComment?: string
  publicCommentTimestamp?: number
  answeredCount: number
  totalOptionCount: number
  completionStatus: 'none' | 'partial' | 'complete'
}

export type PollMissingParticipant = {
  participantId: string
  displayName: string
  answeredCount: number
  totalOptionCount: number
  completionStatus: 'none' | 'partial' | 'complete'
}

export type User = {
  id: string
  displayName: string
  serverUrl?: string
  avatarUrl?: string
  logoUrl?: string
}

export type PollPermissions = {
  isOwner: boolean
  isPollAdmin: boolean
  canToggleClosed: boolean
  canManagePoll: boolean
  canManageAuthors: boolean
}

export type PollDetail = {
  id: string
  title: string
  description: string
  status: string
  isClosed?: boolean
  dueDate: string
  summaryText: string
  type?: string
  allowMaybe?: boolean
  anonymous?: boolean
  showResults?: string
  options: PollOption[]
  participants?: PollParticipant[]
  missingParticipants?: PollMissingParticipant[]
  currentVotes?: Record<string, VoteValue>
  currentUser?: User
  permissions: PollPermissions
  shares?: PollShare[]
}

export type RegisterMember = {
  userId: string
  displayName: string
}

export type RegisterPartialMember = {
  userId: string
  displayName: string
  answeredCount: number
  totalOptionCount: number
}

export type RegisterSummary = {
  registerName: string
  memberCount: number
  totalOptionCount: number
  completeCount: number
  partialCount: number
  missingCount: number
  trafficLight: 'red' | 'yellow' | 'green'
  completeMembers: RegisterMember[]
  partialMembers: RegisterPartialMember[]
  missingMembers: RegisterMember[]
}

export type PollRegisterSummary = {
  pollId: string
  summary: {
    memberCount: number
    completeCount: number
    partialCount: number
    missingCount: number
  }
  registers: RegisterSummary[]
}

export type UserSearchResult = {
  id: string
  displayName: string
  subname?: string
}

export type TransferPollOwnershipPayload = {
  newOwnerId: string
}

export type TransferPollOwnershipResponse = {
  ok: boolean
  poll: PollDetail
}

export type WritableCalendar = {
  id: string
  uri: string
  displayName: string
  owner?: string
  color?: string
}

export type CalendarOptionSelection = {
  optionId: string
  entryStatus: 'inquiry' | 'fixed' | 'canceled'
}

export type CreatePollCalendarEntriesPayload = {
  calendarUri: string
  title: string
  description: string
  location?: string
  optionSelections: CalendarOptionSelection[]
  allDay?: boolean
  startTime?: string
  endTime?: string
  pollAppUrl: string
}

export type CreatePollCalendarEntriesResponse = {
  ok: boolean
  createdCount: number
}

export type CreatePollOptionInput = {
  label: string
  timestamp: number
}

export type CreatePollPayload = {
  title: string
  description: string
  options: CreatePollOptionInput[]
  allowMaybe: boolean
  shareGroupIds: string[]
}

export type CreatePollResponse = {
  ok: boolean
  pollId: string
}

export type PollShareUser = {
  id: string
  userId?: string
  displayName?: string
  emailAddress?: string
  isUnrestrictedOwner?: boolean
  isGuest?: boolean
  isNoUser?: boolean
}

export type PollShare = {
  id: number
  token: string
  type: string
  pollId: number
  user?: PollShareUser
  deleted?: boolean
}

export type GroupOption = {
  id: string
  displayName: string
}

const API_BASE = import.meta.env.VITE_API_BASE || '/pollapp/api'

async function getNextcloudRequestToken(): Promise<string> {
  if (cachedRequestToken) {
    return cachedRequestToken
  }

  const candidates = [
    '/apps/files/',
    '/',
  ]

  for (const path of candidates) {
    const response = await fetch(path, {
      method: 'GET',
      credentials: 'include',
      headers: {
        Accept: 'text/html',
      },
    })

    if (!response.ok) {
      continue
    }

    const html = await response.text()

    const metaMatch = html.match(
      /<meta[^>]+name=["']requesttoken["'][^>]+content=["']([^"']+)["']/i,
    )
    if (metaMatch?.[1]) {
      cachedRequestToken = metaMatch[1]
      return cachedRequestToken
    }

    const jsMatch = html.match(/oc_requesttoken['"]?\s*[:=]\s*['"]([^'"]+)['"]/i)
    if (jsMatch?.[1]) {
      cachedRequestToken = jsMatch[1]
      return cachedRequestToken
    }
  }

  throw new Error('Nextcloud requesttoken nicht gefunden')
}

async function apiFetch(input: string, init?: RequestInit) {
  const response = await fetch(`${API_BASE}${input}`, {
    credentials: 'include',
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })

  return response
}

async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const data = await response.json()
    return data.detail || data.message || fallback
  } catch {
    return fallback
  }
}

export async function fetchHealth(): Promise<{ status: string }> {
  const response = await apiFetch('/health')
  if (!response.ok) {
    throw new Error(`Health request failed: ${response.status}`)
  }
  return response.json()
}

export async function login(
  baseUrl: string,
  username: string,
  appPassword: string,
): Promise<{ user: User }> {
  const response = await apiFetch('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ baseUrl, username, appPassword }),
  })

  if (!response.ok) {
    throw new Error(`Login failed: ${response.status}`)
  }

  return response.json()
}

export async function logout(): Promise<{ success: boolean }> {
  const response = await apiFetch('/auth/logout', {
    method: 'POST',
  })

  if (!response.ok) {
    throw new Error(`Logout failed: ${response.status}`)
  }

  return response.json()
}

export async function fetchMe(): Promise<User> {
  const response = await apiFetch('/auth/me')

  if (!response.ok) {
    throw new Error(`Auth me failed: ${response.status}`)
  }

  return response.json()
}

export async function fetchPolls(): Promise<Poll[]> {
  const response = await apiFetch('/polls')
  if (!response.ok) {
    throw new Error(`Polls request failed: ${response.status}`)
  }
  return response.json()
}
export async function submitPollComment(pollId: string, comment: string): Promise<void> {
  console.log('submitPollComment called', { pollId, comment })
  const response = await apiFetch(`/polls/${pollId}/comment`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ comment }),
  })

  if (!response.ok) {
    throw new Error(`Poll comment request failed: ${response.status}`)
  }
}

export async function fetchPollById(pollId: string): Promise<PollDetail> {
  const response = await apiFetch(`/polls/${pollId}`)
  if (!response.ok) {
    throw new Error(`Poll detail request failed: ${response.status}`)
  }
  return response.json()
}

export type PollDebugData = {
  poll: unknown
  options: unknown
  votes: unknown
  currentUser: {
    id: string
    displayName: string
  }
}

export async function fetchPollDebug(pollId: string): Promise<PollDebugData> {
  const response = await apiFetch(`/polls/${pollId}/debug`)
  if (!response.ok) {
    throw new Error(`Poll debug request failed: ${response.status}`)
  }
  return response.json()
}

export async function submitVote(
  pollId: string,
  optionId: string,
  value: VoteValue,
): Promise<{ success: boolean }> {
  const response = await apiFetch(`/polls/${pollId}/votes`, {
    method: 'POST',
    body: JSON.stringify({
      optionId,
      value,
    }),
  })

  if (!response.ok) {
    throw new Error(`Vote request failed: ${response.status}`)
  }

  return response.json()
}

export async function fetchPollRegisterSummary(
  pollId: string,
): Promise<PollRegisterSummary> {
  const response = await apiFetch(`/polls/${pollId}/register-summary`)
  if (!response.ok) {
    throw new Error(`Register summary request failed: ${response.status}`)
  }
  return response.json()
}

export async function submitPollCommentDirect(
  pollId: string,
  comment: string,
): Promise<void> {
  const token = await getNextcloudRequestToken()

  const response = await fetch(
    `/apps/polls/poll/${pollId}/comment?time=${Date.now()}`,
    {
      method: 'POST',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        requesttoken: token,
        'nc-polls-client-id': 'pollbee',
        'nc-polls-client-time-zone':
          Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Berlin',
      },
      body: JSON.stringify({
        comment: comment.trim(),
        confidential: false,
      }),
    },
  )

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Poll comment request failed: ${response.status} ${text}`)
  }
}

export async function togglePollClosed(
  pollId: string,
): Promise<{ ok: boolean; poll: PollDetail }> {
  const response = await apiFetch(`/polls/${pollId}/toggle-closed`, {
    method: 'POST',
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(text || 'Umfrage konnte nicht geändert werden')
  }

  return response.json()
}

export async function searchUsers(query: string): Promise<UserSearchResult[]> {
  const response = await apiFetch(`/users/search?q=${encodeURIComponent(query)}`)

  if (!response.ok) {
    throw new Error(`User search failed: ${response.status}`)
  }

  return response.json()
}

export async function transferPollOwnership(
  pollId: string,
  newOwnerId: string,
): Promise<TransferPollOwnershipResponse> {
  const response = await apiFetch(`/polls/${pollId}/transfer-ownership`, {
    method: 'POST',
    body: JSON.stringify({ newOwnerId }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(text || 'Eigentümerschaft konnte nicht übertragen werden')
  }

  return response.json()
}

export async function fetchWritableCalendars(): Promise<WritableCalendar[]> {
  const response = await apiFetch('/calendars')

  if (!response.ok) {
    throw new Error(`Calendar request failed: ${response.status}`)
  }

  return response.json()
}

export async function createPollCalendarEntries(
  pollId: string,
  payload: CreatePollCalendarEntriesPayload,
): Promise<CreatePollCalendarEntriesResponse> {
  const response = await apiFetch(`/polls/${pollId}/calendar-events`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(text || 'Kalendereinträge konnten nicht erzeugt werden')
  }

  return response.json()
}

export async function createPoll(payload: CreatePollPayload) {
  const response = await fetch(`${API_BASE}/polls`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    throw new Error('Umfrage konnte nicht erstellt werden.')
  }

  return response.json()
}

export async function setPollShareAdmin(shareToken: string): Promise<PollShare> {
  const response = await fetch(
    `${API_BASE}/polls/shares/${encodeURIComponent(shareToken)}/admin`,
    {
      method: 'PUT',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
      },
    },
  )

  if (!response.ok) {
    throw new Error(
      await readErrorMessage(response, 'Co-Autor konnte nicht hinzugefügt werden.'),
    )
  }

  const data = await response.json()
  return data.share
}

export async function removePollShareAdmin(shareToken: string): Promise<PollShare> {
  const response = await fetch(
    `${API_BASE}/polls/shares/${encodeURIComponent(shareToken)}/admin`,
    {
      method: 'DELETE',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
      },
    },
  )

  if (!response.ok) {
    throw new Error(
      await readErrorMessage(response, 'Co-Autor konnte nicht entfernt werden.'),
    )
  }

  const data = await response.json()
  return data.share
}

export async function createPollShare(
  pollId: string,
  userId: string,
): Promise<PollShare> {
  const response = await fetch(`${API_BASE}/polls/${pollId}/shares`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      userId,
    }),
  })

  if (!response.ok) {
    throw new Error('Benutzer konnte nicht zur Umfrage hinzugefügt werden.')
  }

  const data = await response.json()
  return data.share
}

export async function fetchShareGroups(): Promise<GroupOption[]> {
  const response = await fetch(`${API_BASE}/groups`, {
    credentials: 'include',
  })

  if (!response.ok) {
    throw new Error('Gruppen konnten nicht geladen werden.')
  }

  const data = await response.json()
  return data.groups ?? []
}

let cachedRequestToken: string | null = null
