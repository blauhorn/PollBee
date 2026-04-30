import { memo, useEffect, useRef, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Plus, X, Trash2, LogOut, Info } from 'lucide-react'
import { fetchMe, fetchPolls, createPoll, fetchShareGroups, type Poll, type PollOption, type CreatePollOptionInput, type User, type GroupOption } from '../api'
import IconButton from '../components/IconButton'
import {showSuccess, showError, showLoading} from '../utils/toast'

type PollListPageProps = {
  initialFilter?: string
}

type PollSummaryOption = {
  id: string
  formattedDate: string
  yesCount: number
  noCount: number
  maybeCount: number
  missingCount: number
}

type PollSummary = {
  options: PollSummaryOption[]
}

function buildPollSummary(poll: Poll): PollSummary {
  return {
    options: poll.options.map((option) => ({
      id: option.id,
      formattedDate: formatOptionDate(option),
      yesCount: voteCount(option, 'yes'),
      noCount: voteCount(option, 'no'),
      maybeCount: voteCount(option, 'maybe'),
      missingCount: missingCount(option),
    })),
  }
}



function formatCreatedDate(ts?: number): string {
  if (!ts) return ''

  const normalized = ts < 1_000_000_000_000 ? ts * 1000 : ts
  return new Date(normalized).toLocaleDateString('de-DE')
}

function normalizeTimestamp(timestamp?: number): number | null {
  if (typeof timestamp !== 'number' || Number.isNaN(timestamp)) {
    return null
  }

  return timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp
}

function formatOptionDate(option: PollOption): string {
  const normalized = normalizeTimestamp(option.timestamp)

  if (normalized !== null) {
    return new Date(normalized).toLocaleDateString('de-DE')
  }

  return option.label
}

function formatDateLabel(value: string): string {
  if (!value) return ''
  return new Date(`${value}T00:00:00`).toLocaleDateString('de-DE')
}

function matchesDateRange(
  options: PollOption[],
  fromDate: string,
  toDate: string,
): boolean {
  if (!fromDate && !toDate) return true

  const fromTs = fromDate ? new Date(`${fromDate}T00:00:00`).getTime() : null
  const toTs = toDate ? new Date(`${toDate}T23:59:59.999`).getTime() : null

  return options.some((option) => {
    const optionTs = normalizeTimestamp(option.timestamp)
    if (optionTs === null) return false
    if (fromTs !== null && optionTs < fromTs) return false
    if (toTs !== null && optionTs > toTs) return false
    return true
  })
}

function voteCount(option: PollOption, kind: 'yes' | 'no' | 'maybe'): number {
  return option.voteSummary?.[kind] ?? 0
}

function missingCount(option: PollOption): number {
  const explicitMissing = option.voteSummary?.missing
  if (typeof explicitMissing === 'number') {
    return explicitMissing
  }

  const count = option.voteSummary?.count ?? 0
  const yes = option.voteSummary?.yes ?? 0
  const no = option.voteSummary?.no ?? 0
  const maybe = option.voteSummary?.maybe ?? 0
  return Math.max(0, count - yes - no - maybe)
}

function HeaderIcon({
  symbol,
  label,
}: {
  symbol: string
  label: string
}) {
  return (
    <span
      title={label}
      aria-label={label}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '1.4rem',
        height: '1.4rem',
        fontSize: '1rem',
      }}
    >
      {symbol}
    </span>
  )
}

function getGreeting(): string {
  const hour = new Date().getHours()

  if (hour < 11) return 'Guten Morgen'
  if (hour < 18) return 'Guten Tag'
  return 'Guten Abend'
}

function isPollOpenForCurrentUser(poll: Poll): boolean {
  if (!poll.options || poll.options.length === 0) {
    return false
  }

  return poll.options.some((option) => !option.voteSummary?.currentUser)
}

function isPollFullyAnswered(poll: Poll): boolean {
  if (!poll.options || poll.options.length === 0) return true

  return poll.options.every((option) => {
    const missing = missingCount(option)
    return missing === 0
  })
}

function isPollInPast(poll: Poll): boolean {
  const now = Date.now()

  return poll.options.every((option) => {
    const ts = normalizeTimestamp(option.timestamp)
    if (!ts) return false

    const diffDays = (now - ts) / (1000 * 60 * 60 * 24)
    return diffDays >= 4
  })
}

function getPollStyle(poll: Poll) {
  const closed = isPollClosed(poll)
  const fullyAnswered = isPollFullyAnswered(poll)
  const inPast = isPollInPast(poll)

  let background = '#ffffff'
  let border = '#d9dee7'
  let color = '#111827'

  if (closed || inPast) {
    // 🔵 abgeschlossen oder vergangen
    background = '#eff6ff'
    border = '#bfdbfe'
  } else if (fullyAnswered) {
    // 🟢 offen und vollständig beantwortet
    background = '#f0fdf4'
    border = '#bbf7d0'
  } else {
    // 🔴 offen und noch nicht vollständig beantwortet
    background = '#fef2f2'
    border = '#fecaca'
  }

  if (inPast) {
    color = '#9ca3af'
  }

  return { background, border, color }
}

function needsCurrentUserResponse(poll: Poll): boolean {
  if (!poll.options || poll.options.length === 0) return false

  return poll.options.some((option) => !option.voteSummary?.currentUser)
}

function hasFutureOptions(poll: Poll): boolean {
  const now = Date.now()

  return poll.options.some((option) => {
    const ts = normalizeTimestamp(option.timestamp)
    return ts !== null && ts > now
  })
}

function isPollClosed(poll: Poll): boolean {
  return poll.isClosed === true
}

function formatClosedDate(poll: Poll): string | null {
  if (!poll.dueDate) return null

  const numeric = Number(poll.dueDate)

  if (!Number.isNaN(numeric) && numeric > 0) {
    const normalized = numeric < 1_000_000_000_000 ? numeric * 1000 : numeric
    return new Date(normalized).toLocaleDateString('de-DE')
  }

  const parsed = Date.parse(poll.dueDate)
  if (!Number.isNaN(parsed)) {
    return new Date(parsed).toLocaleDateString('de-DE')
  }

  return poll.dueDate
}

function DateFilterSummary({
  dateFrom,
  dateTo,
}: {
  dateFrom: string
  dateTo: string
}) {
  if (!dateFrom && !dateTo) {
    return <span style={{ color: '#6b7280' }}>Alle Termine</span>
  }

  return (
    <span style={{ color: '#374151' }}>
      {dateFrom ? `ab ${formatDateLabel(dateFrom)}` : 'ohne Start'}
      {(dateFrom || dateTo) && ' · '}
      {dateTo ? `bis ${formatDateLabel(dateTo)}` : 'ohne Ende'}
    </span>
  )
}

type PollListStickyProps = {
  currentUser: User | null
  openPollCount: number
  textFilter: string
  setTextFilter: (value: string) => void
  dateFrom: string
  setDateFrom: (value: string) => void
  dateTo: string
  setDateTo: (value: string) => void
  menuOpen: boolean
  setMenuOpen: React.Dispatch<React.SetStateAction<boolean>>
  handleLogout: () => void
  setShowInfoScreen: (value: boolean) => void
  basePath: string
}

const PollListSticky = memo(function PollListSticky({
  currentUser,
  openPollCount,
  textFilter,
  setTextFilter,
  dateFrom,
  setDateFrom,
  dateTo,
  setDateTo,
  menuOpen,
  setMenuOpen,
  handleLogout,
  setShowInfoScreen,
  basePath,
}: PollListStickyProps) {
  return (
    <section
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 20,
        background: '#ffffff',
        borderBottom: '1px solid #e5e7eb',
        padding: '0.25rem 0.25rem',
      }}
    >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.65rem',
            marginBottom: '0.5rem',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              minWidth: 0,
              flex: 1,
            }}
          >
            <div
              style={{
                position: 'relative', // wichtig für Dropdown
                flexShrink: 0,
              }}
            >
              <div
                onClick={(e) => {
                  e.stopPropagation()
                  setMenuOpen((prev) => !prev)
                }}
                style={{
                  width: '2.75rem',
                  height: '2.75rem',
                  borderRadius: '999px',
                  overflow: 'hidden',
                  flexShrink: 0,
                  background: '#f3f4f6',
                  border: '1px solid #e5e7eb',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 700,
                  color: '#374151',
                  cursor: 'pointer',
                }}
              >
                {currentUser?.avatarUrl ? (
                  <img
                    src={currentUser.avatarUrl}
                    alt={currentUser.displayName}
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      display: 'block',
                    }}
                  />
                ) : (
                  <span>
                    {currentUser?.displayName?.slice(0, 1).toUpperCase() ?? '?'}
                  </span>
                )}
              </div>

               {menuOpen && (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      position: 'absolute',
                      top: '3.2rem',
                      left: 0,
                      background: '#ffffff',
                      border: '1px solid #e5e7eb',
                      borderRadius: '0.75rem',
                      boxShadow: '0 10px 24px rgba(0,0,0,0.12)',
                      minWidth: '180px',
                      zIndex: 1000,
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        padding: '0.7rem 0.9rem',
                        fontSize: '0.9rem',
                        color: '#374151',
                        borderBottom: '1px solid #f1f5f9',
                        background: '#ffffff',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {currentUser?.displayName}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                      <IconButton
                          onClick={handleLogout}
                          title="Abmelden"
                          icon={<LogOut size={20} />}
                        />
                      <IconButton
                          onClick={() => setShowInfoScreen(true)}
                          title="Info"
                          icon={<span style={{ fontWeight: 700, fontSize: '1.05rem' }}>?</span>}
                        />
                    </div>

                    
                </div>
              )}
            </div>

            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: '1rem',
                  fontWeight: 700,
                  lineHeight: 1.2,
                }}
              >
                {getGreeting()}
                {currentUser?.displayName ? `, ${currentUser.displayName}` : ''}
              </div>

              <div
                style={{
                  marginTop: '0.15rem',
                  fontSize: '0.85rem',
                  color: '#6b7280',
                  lineHeight: 1.2,
                }}
              >
                PollBee - <strong>{openPollCount}</strong>{' '}
                {openPollCount === 1 ? 'offene Umfrage' : 'offene Umfragen'}
              </div>
              
            </div>
          </div>

		<div
		  style={{
		    display: 'flex',
		    alignItems: 'center',
		    justifyContent: 'center',
		    flexShrink: 0,
		    minWidth: '4.5rem',
		    background: '#f3f4f6',
		    borderRadius: '0.5rem',
		    padding: '0.35rem 0.5rem',
		  }}
		>
		  <img
        src={`${basePath}branding/logo-ntso.svg`}
        alt="NTSO"
        style={{
          maxHeight: '2rem',
          maxWidth: '5rem',
          display: 'block',
          objectFit: 'contain',
        }}
      />
		</div>
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.75rem',
          }}
        >
  
        <label
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.35rem',
          }}
        >
          <div style={{ position: 'relative' }}>
            <input
              type="text"
              value={textFilter}
              onChange={(e) => setTextFilter(e.target.value)}
              placeholder="Titel oder Beschreibung filtern"
              style={{
                padding: '0.55rem 2rem 0.55rem 0.7rem', // rechts Platz für X
                border: '1px solid #d1d5db',
                borderRadius: '0.55rem',
                font: 'inherit',
                width: '100%',
                boxSizing: 'border-box',
              }}
            />

            {textFilter && (
              <button
                type="button"
                onClick={() => setTextFilter('')}
                aria-label="Filter löschen"
                style={{
                  position: 'absolute',
                  right: '0.45rem',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  color: '#6b7280',
                  fontSize: '0.9rem',
                  lineHeight: 1,
                  padding: '0.2rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: '999px',
                }}
              >
                ✕
              </button>
            )}
          </div>
        </label>
           <div
            style={{
              borderTop: '1px solid #e5e7eb',
              padding: '0.45rem 0.75rem',
              display: 'grid',
              gridTemplateColumns: 'auto 1fr 1fr auto',
              gap: '0.5rem',
              alignItems: 'center',
              background: '#ffffff',
            }}
          >
            <div
              aria-hidden="true"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '0.95rem',
                color: '#4b5563',
                width: '1.5rem',
              }}
            >
              📅
            </div>

            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              aria-label="Datum von"
              style={{
                padding: '0.45rem 0.65rem',
                border: '1px solid #d1d5db',
                borderRadius: '0.5rem',
                font: 'inherit',
                minHeight: '2.1rem',
                background: '#ffffff',
                minWidth: 0,
                boxSizing: 'border-box',
              }}
            />

            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              aria-label="Datum bis"
              style={{
                padding: '0.45rem 0.65rem',
                border: '1px solid #d1d5db',
                borderRadius: '0.5rem',
                font: 'inherit',
                minHeight: '2.1rem',
                background: '#ffffff',
                minWidth: 0,
                boxSizing: 'border-box',
              }}
            />

            <button
              type="button"
              onClick={() => {
                setDateFrom('')
                setDateTo('')
              }}
              aria-label="Datumsfilter löschen"
              title="Datumsfilter löschen"
              style={{
                border: 'none',
                background: 'transparent',
                color: '#6b7280',
                cursor: 'pointer',
                padding: '0.25rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '1rem',
                lineHeight: 1,
                width: '1.75rem',
                height: '1.75rem',
                borderRadius: '999px',
              }}
            >
              ✕
            </button>
          </div>
        </div>
      
    </section>
  )
})

export default function PollListPage({ initialFilter = '' }: PollListPageProps) {
  const navigate = useNavigate()

  const { filterText } = useParams()
  const effectiveInitialFilter = filterText ?? initialFilter ?? ''
  const [textFilter, setTextFilter] = useState(effectiveInitialFilter)

  useEffect(() => {
    setTextFilter(effectiveInitialFilter)
  }, [effectiveInitialFilter])

  const [polls, setPolls] = useState<Poll[]>([])
  const [currentUser, setCurrentUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [showDateFilters, setShowDateFilters] = useState(false)
  const API_BASE = import.meta.env.VITE_API_BASE || '/pollapp/api'
  const [menuOpen, setMenuOpen] = useState(false)
  const handleLogout = async () => {
    try {
      await fetch(`${API_BASE}/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      })
    } catch (e) {
      console.error('Logout failed', e)
    }

    // optional: lokalen Zustand zurücksetzen
    setMenuOpen(false)

    // Weiterleitung zur Login-Seite
    window.location.href = `${BASE_PATH}login`
  }

  const [showCreatePollDialog, setShowCreatePollDialog] = useState(false)
  const [createPollLoading, setCreatePollLoading] = useState(false)
  const [createPollError, setCreatePollError] = useState('')
  const [newPollTitle, setNewPollTitle] = useState('')
  const [newPollDescription, setNewPollDescription] = useState('')
  const [newPollAllowMaybe, setNewPollAllowMaybe] = useState(true)
  const [showInfoScreen, setShowInfoScreen] = useState(false)
  const [releaseVersion, setReleaseVersion] = useState<string>('…')
  const [releaseChangelog, setReleaseChangelog] = useState<string>('')
  const [releaseLoading, setReleaseLoading] = useState(false)
  const [newPollOptions, setNewPollOptions] = useState<
    { id: string; date: string; time: string }[]
  >([
    { id: crypto.randomUUID(), date: '', time: '19:30' },
  ])
  const [saveMessage, setSaveMessage] = useState('')

  const [availableShareGroups, setAvailableShareGroups] = useState<GroupOption[]>([])
  const [selectedShareGroupIds, setSelectedShareGroupIds] = useState<string[]>([])
  const [loadingGroups, setLoadingGroups] = useState(false)

  const [pollSummaries, setPollSummaries] = useState<Record<string, PollSummary>>({})
  const [loadingSummaries, setLoadingSummaries] = useState<Record<string, boolean>>({})


  async function loadSummary(poll: Poll) {
    setLoadingSummaries((prev) => ({ ...prev, [poll.id]: true }))

    try {
      const response = await fetch(`${API_BASE}/polls/${poll.id}/summary`, {
        credentials: 'include',
      })

      if (!response.ok) {
        throw new Error(`Summary konnte nicht geladen werden: ${response.status}`)
      }

      const apiSummary = await response.json()

      const summary: PollSummary = {
        options: apiSummary.options.map((option: any) => ({
          id: String(option.id),
          formattedDate: formatOptionDate(option),
          yesCount: Number(option.voteSummary?.yes ?? 0),
          noCount: Number(option.voteSummary?.no ?? 0),
          maybeCount: Number(option.voteSummary?.maybe ?? 0),
          missingCount: Number(option.voteSummary?.missing ?? 0),
        })),
      }

      setPollSummaries((prev) => ({
        ...prev,
        [poll.id]: summary,
      }))
    } catch (err) {
      console.error('Summary konnte nicht geladen werden', poll.id, err)
    } finally {
      setLoadingSummaries((prev) => ({ ...prev, [poll.id]: false }))
    }
  }


  useEffect(() => {
    async function loadCurrentUser() {
      try {
        const userData = await fetchMe()
        setCurrentUser(userData)
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Unbekannter Fehler'

        if (message.includes('401')) {
          navigate('/login')
          return
        }

        setError(message)
      }
    }

    async function loadPolls() {
      try {
        const pollData = await fetchPolls()
        setPolls(pollData)

        const MAX_PARALLEL_SUMMARIES = 3

        async function loadSummariesInBatches(pollsToLoad: Poll[]) {
          for (let i = 0; i < pollsToLoad.length; i += MAX_PARALLEL_SUMMARIES) {
            const batch = pollsToLoad.slice(i, i + MAX_PARALLEL_SUMMARIES)

            await Promise.all(
              batch.map((poll) => loadSummary(poll)),
            )
          }
        }

        void loadSummariesInBatches(pollData)
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

    void loadCurrentUser()
    void loadPolls()
  }, [navigate])

  const listScrollRef = useRef<HTMLElement | null>(null)
  const [showCreateButton, setShowCreateButton] = useState(true)  

  useEffect(() => {
    const el = listScrollRef.current
    if (!el) return

    let lastScrollTop = el.scrollTop

    function handleScroll() {
      const currentScrollTop = el.scrollTop

      if (currentScrollTop < 80) {
        setShowCreateButton(true)
      } else if (currentScrollTop > lastScrollTop + 8) {
        setShowCreateButton(false)
      } else if (currentScrollTop < lastScrollTop - 8) {
        setShowCreateButton(true)
      }

      lastScrollTop = currentScrollTop
    }

    el.addEventListener('scroll', handleScroll, { passive: true })

    return () => {
      el.removeEventListener('scroll', handleScroll)
    }
  }, [])

  useEffect(() => {
    if (showInfoScreen) {
      fetchLatestRelease()
    }
  }, [showInfoScreen])

  const openPollCount = useMemo(() => {
    return polls.filter(isPollOpenForCurrentUser).length
  }, [polls])

  const filteredPolls = useMemo(() => {
    const needle = textFilter.trim().toLowerCase()

    const filtered = polls.filter((poll) => {
      const haystack =
        `${poll.title} ${poll.description} ${poll.summaryText}`.toLowerCase()

      const textMatches = !needle || haystack.includes(needle)
      const dateMatches = matchesDateRange(poll.options ?? [], dateFrom, dateTo)

      return textMatches && dateMatches
    })

    return filtered.sort((a, b) => {
      const aNeeds = needsCurrentUserResponse(a)
      const bNeeds = needsCurrentUserResponse(b)

      // 🔴 Priorität 1: offene Antworten nach oben
      if (aNeeds !== bNeeds) {
        return aNeeds ? -1 : 1
      }

      // 🔵 Optional: danach nach Aktualität sortieren (neuere oben)
      const aLatest = Math.max(
        ...(a.options ?? []).map((o) => normalizeTimestamp(o.timestamp) ?? 0),
      )
      const bLatest = Math.max(
        ...(b.options ?? []).map((o) => normalizeTimestamp(o.timestamp) ?? 0),
      )

      return bLatest - aLatest
    })
  }, [polls, textFilter, dateFrom, dateTo])

  const renderedPolls = useMemo(() => {
    return filteredPolls.map((poll) => {
      const summary = pollSummaries[poll.id]
      const isLoading = loadingSummaries[poll.id]
      const style = getPollStyle(poll)
      const closed = isPollClosed(poll)
      const needsResponse = needsCurrentUserResponse(poll)
      const futureOptions = hasFutureOptions(poll)
      const closedDate = closed ? formatClosedDate(poll) : ''
      const createdDate = poll.created ? formatCreatedDate(poll.created) : ''

      const preparedOptions =
        poll.options.length > 0
          ? poll.options.map((option) => ({
              ...option,
              formattedDate: formatOptionDate(option),
              yesCount: voteCount(option, 'yes'),
              noCount: voteCount(option, 'no'),
              maybeCount: voteCount(option, 'maybe'),
              missingCount: missingCount(option),
            }))
          : []

      return {
        ...poll,
        _ui: {
          style,
          closed,
          needsResponse,
          futureOptions,
          closedDate,
          createdDate,
          options: preparedOptions,
        },
      }
    })
  }, [filteredPolls])

  const BASE_PATH = import.meta.env.VITE_BASE_PATH || '/pollapp/'

  async function openCreatePollDialog() {
    // Dialog öffnen + alles zurücksetzen
    setShowCreatePollDialog(true)
    setCreatePollError('')
    setNewPollTitle('')
    setNewPollDescription('')
    setNewPollAllowMaybe(true)
    setNewPollOptions([
      { id: crypto.randomUUID(), date: '', time: '19:30' },
    ])

    // neue Teile
    setSelectedShareGroupIds([])
    setAvailableShareGroups([]) // optional: sorgt für "leeren" Zustand beim Laden
    setLoadingGroups(true)
    try {
      const groups = await fetchShareGroups()
      setAvailableShareGroups(groups)
    } catch (error) {
      console.error(error)
      setCreatePollError('Gruppen konnten nicht geladen werden.')
    } finally {
      setLoadingGroups(false)
      }
  }

  function closeCreatePollDialog() {
    if (createPollLoading) return
    setShowCreatePollDialog(false)
  }

  function addPollOptionRow() {
    setNewPollOptions((prev) => [
      ...prev,
      { id: crypto.randomUUID(), date: '', time: '19:30' },
    ])
  }

  function updatePollOptionRow(
    id: string,
    patch: Partial<{ date: string; time: string }>,
  ) {
    setNewPollOptions((prev) =>
      prev.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    )
  }

  function removePollOptionRow(id: string) {
    setNewPollOptions((prev) => {
      if (prev.length <= 1) return prev
      return prev.filter((row) => row.id !== id)
    })
  }

  async function fetchLatestRelease() {
    setReleaseLoading(true)

    try {
      const response = await fetch(
        'https://api.github.com/repos/blauhorn/PollBee/releases/latest'
      )

      if (!response.ok) {
        throw new Error('GitHub API Fehler')
      }

      const data = await response.json()

      // tag_name ist meistens sowas wie "v1.2.3"
      setReleaseVersion(data.tag_name || 'unbekannt')
      setReleaseChangelog(data.body || 'Kein Changelog hinterlegt.')
    } catch (error) {
      console.error(error)
      setReleaseVersion('nicht verfügbar')
      setReleaseChangelog('Changelog konnte nicht geladen werden.')
    } finally {
      setReleaseLoading(false)
    }
  }

  async function handleCreatePoll() {
    const title = newPollTitle.trim()
    const description = newPollDescription.trim()

    if (!title) {
      setCreatePollError('Bitte einen Titel eingeben.')
      return
    }

    const parsedOptions: CreatePollOptionInput[] = []

    for (const row of newPollOptions) {
      if (!row.date) continue

      const dateTimeString = row.time
        ? `${row.date}T${row.time}`
        : `${row.date}T19:30`

      const timestamp = new Date(dateTimeString).getTime()

      if (Number.isNaN(timestamp)) {
        setCreatePollError('Mindestens ein Termin ist ungültig.')
        return
      }

      parsedOptions.push({
        label: row.time ? `${row.date} ${row.time}` : row.date,
        timestamp: Math.floor(timestamp / 1000),
      })
    }

    if (parsedOptions.length === 0) {
      setCreatePollError('Bitte mindestens einen Termin angeben.')
      return
    }

    setCreatePollLoading(true)
    setCreatePollError('')

    try {
      const result = await createPoll({
        title,
        description,
        options: parsedOptions,
        allowMaybe: newPollAllowMaybe,
        shareGroupIds: selectedShareGroupIds,
      })

      setShowCreatePollDialog(false)
      await fetchPolls().then(setPolls)

      showSuccess(`Umfrage „${title}“ wurde erstellt.`)
    } catch (error) {
      console.error(error)

      const message =
        error instanceof Error
          ? error.message
          : 'Umfrage konnte nicht erstellt werden.'

      setCreatePollError(message)
      showError(message)
    } finally {
      setCreatePollLoading(false)
    }
  }


  return (
    <main
      style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: '#ffffff',
      }}
    >
    <style>
      {`
        @keyframes pollbee-loading-sweep {
          0% {
            transform: translateX(-120%);
          }
          50% {
            transform: translateX(180%);
          }
          100% {
            transform: translateX(-120%);
          }
        }
      `}
    </style>
      <PollListSticky
        currentUser={currentUser}
        openPollCount={openPollCount}
        textFilter={textFilter}
        setTextFilter={setTextFilter}
        dateFrom={dateFrom}
        setDateFrom={setDateFrom}
        dateTo={dateTo}
        setDateTo={setDateTo}
        menuOpen={menuOpen}
        setMenuOpen={setMenuOpen}
        handleLogout={handleLogout}
        setShowInfoScreen={setShowInfoScreen}
        basePath={BASE_PATH}
      />

      <section
      ref={listScrollRef}
      style={{
          flex: 1,
          overflowY: 'auto',
          padding: '0.25rem 0.25rem',
        }}
      >
    {loading ? (
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          padding: '2rem 0 1rem',
        }}
      >
	    <div
	      style={{
        width: '8rem',
        height: '0.35rem',
        borderRadius: '999px',
        background: '#e5e7eb',
        overflow: 'hidden',
        position: 'relative',
	      }}
	    >
	    <div
		    style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '40%',
          height: '100%',
          borderRadius: '999px',
          background: '#93c5fd',
          animation: 'pollbee-loading-sweep 1.2s ease-in-out infinite',
        }}
	    />
	    </div>
	  </div>
	) : null}
        {error ? <p style={{ color: 'crimson' }}>Fehler: {error}</p> : null}

        {!loading && !error && filteredPolls.length === 0 ? (
          <p>Keine passenden Umfragen vorhanden.</p>
        ) : null}

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.5rem',
          }}
        >
          {renderedPolls.map((poll) => {
              const summary = pollSummaries[poll.id]
              const isSummaryLoading = loadingSummaries[poll.id]
              
              const isReady = Boolean(summary) || poll.options.length > 0

          return (
            <article
              key={poll.id}
              style={{
                position: 'relative',
                border: `1px solid ${poll._ui.style.border}`,
                borderRadius: '0.8rem',
                padding: '0.5rem',
                background: poll._ui.style.background,
                color: poll._ui.style.color,
                transition: 'background 0.2s ease, border 0.2s ease',
              }}
            >
              {/* 🔶 Offen-Badge */}
                {!poll._ui.closed && poll._ui.needsResponse ? (
                  <div
                    style={{
                      position: 'absolute',
                      top: '0.6rem',
                      right: '0.6rem',
                      width: '0.6rem',
                      height: '0.6rem',
                      borderRadius: '999px',
                      background: '#f59e0b',
                      boxShadow: '0 0 0 2px #ffffff, 0 0 0 4px rgba(245,158,11,0.2)',
                    }}
                  />
                ) : null}

              {/* 🔒 Geschlossen-Badge */}
                {poll._ui.closed && poll._ui.futureOptions ? (
                  <div
                    style={{
                      position: 'absolute',
                      top: '0.6rem',
                      right: '0.6rem',
                      background: '#e5e7eb',
                      color: '#374151',
                      fontSize: '0.72rem',
                      fontWeight: 600,
                      lineHeight: 1,
                      padding: '0.35rem 0.55rem',
                      borderRadius: '999px',
                      boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.25rem',
                    }}
                  >
                    <span>🔒{poll._ui.closedDate}</span>
                  
                  </div>
                ) : null}
               <Link
                  to={isReady ? `/polls/${poll.id}` : '#'}
                  onClick={(event) => {
                    if (!isReady) {
                      event.preventDefault()
                    }
                  }}
                  style={{
                    display: 'block',
                    color: 'inherit',
                    textDecoration: 'none',
                    opacity: isReady ? 1 : 0.75,
                  }}
>
                  <div style={{ marginBottom: '0.45rem' }}>
                    <div
                      style={{
                        fontSize: '1.15rem',
                        fontWeight: 700,
                        lineHeight: 1.3,
                        marginBottom: '0.35rem',
                      }}
                    >
                      {poll.title}
                    </div>
                    <div
          style={{
            fontSize: '0.78rem',
            color: '#6b7280',
            fontStyle: 'italic',
            marginTop: '0.15rem',
            marginBottom: '0.2rem',
          }}
        >
          {poll.owner ? `von ${poll.owner}` : ''}
          {poll.created ? ` · ${poll._ui.createdDate}` : ''}
        
        </div>

                    <div
                      style={{
                        fontSize: '0.92rem',
                        color: '#4b5563',
                        lineHeight: 1.4,
                      }}
                    >
                      {poll.description}
                    </div>
                  </div>

                  <div style={{ overflowX: 'auto' }}>
                    <table
                      style={{
                        width: '100%',
                        borderCollapse: 'collapse',
                        fontSize: '0.95rem',
                      }}
                    >
                      <thead>
                        <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                          <th
                            style={{
                              textAlign: 'left',
                              padding: '0.55rem 0.4rem 0.55rem 0',
                              fontWeight: 600,
                            }}
                          >
                            Datum
                          </th>
                          <th
                            style={{
                              textAlign: 'center',
                              padding: '0.55rem 0.4rem',
                              fontWeight: 600,
                            }}
                          >
                            <HeaderIcon symbol="✅" label="Ja" />
                          </th>
                          <th
                            style={{
                              textAlign: 'center',
                              padding: '0.55rem 0.4rem',
                              fontWeight: 600,
                            }}
                          >
                            <HeaderIcon symbol="❌" label="Nein" />
                          </th>
                          <th
                            style={{
                              textAlign: 'center',
                              padding: '0.55rem 0.4rem',
                              fontWeight: 600,
                            }}
                          >
                            <HeaderIcon symbol="❔" label="Vielleicht" />
                          </th>
                          <th
                            style={{
                              textAlign: 'center',
                              padding: '0.55rem 0.4rem',
                              fontWeight: 600,
                            }}
                          >
                            <HeaderIcon symbol="⏳" label="Fehlt" />
                          </th>
                        </tr>
                      </thead>

                      <tbody>
                        {isSummaryLoading && !summary ? (
                          <tr>
                            <td colSpan={5} style={{ padding: '0.75rem 0', color: '#6b7280', fontStyle: 'italic' }}>
                              Lade Zusammenfassung...
                            </td>
                          </tr>
                        ) : summary ? (
                          summary.options.map((option) => (
                            <tr key={option.id} style={{ borderBottom: '1px solid #f0f2f5' }}>
                              <td style={{ padding: '0.55rem 0.4rem 0.55rem 0' }}>
                                {option.formattedDate}
                              </td>
                              <td style={{ textAlign: 'center', padding: '0.4rem 0.35rem' }}>
                                {option.yesCount}
                              </td>
                              <td style={{ textAlign: 'center', padding: '0.4rem 0.35rem' }}>
                                {option.noCount}
                              </td>
                              <td style={{ textAlign: 'center', padding: '0.4rem 0.35rem' }}>
                                {option.maybeCount}
                              </td>
                              <td style={{ textAlign: 'center', padding: '0.4rem 0.35rem' }}>
                                {option.missingCount}
                              </td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={5} style={{ padding: '0.75rem 0', color: '#6b7280', fontStyle: 'italic' }}>
                              Keine Daten verfügbar.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </Link>
            </article>
             )
        })}
        </div>

        <div
        style={{
          position: 'fixed',
          right: '1rem',
          bottom: 'calc(env(safe-area-inset-bottom) + 1rem)',
          zIndex: 1100,
          opacity: showCreateButton ? 1 : 0,
          transform: showCreateButton ? 'translateY(0)' : 'translateY(20px)',
          pointerEvents: showCreateButton ? 'auto' : 'none',
          transition: 'opacity 0.2s ease, transform 0.2s ease',
        }}
      >
        <IconButton
          icon={<Plus size={24} />}
          onClick={openCreatePollDialog}
          variant="primary"
          size={56}
          title="Neue Umfrage erstellen"
        />


  
      </div>  
      </section>
      
      {showCreatePollDialog ? (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 2000,
            padding: '1rem',
          }}
          onClick={closeCreatePollDialog}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: '36rem',
              maxHeight: '90vh',
              overflowY: 'auto',
              background: '#ffffff',
              borderRadius: '1rem',
              boxShadow: '0 20px 60px rgba(0,0,0,0.22)',
              padding: '1.25rem',
              boxSizing: 'border-box',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '0.85rem',
              }}
            >
              <div style={{ fontSize: '1.05rem', fontWeight: 700 }}>
                Neue Umfrage
              </div>

              <IconButton
                onClick={closeCreatePollDialog}
                disabled={createPollLoading}
                title="Schließen"
                icon={<X size={18} />}
                size={40}
              />
            </div>

            <div style={{ display: 'grid', gap: '0.85rem' }}>
              <label style={{ display: 'grid', gap: '0.35rem' }}>
                <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>Titel</span>
                <input
                  type="text"
                  value={newPollTitle}
                  onChange={(e) => setNewPollTitle(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.7rem 0.8rem',
                    border: '1px solid #d1d5db',
                    borderRadius: '0.65rem',
                    font: 'inherit',
                    boxSizing: 'border-box',
                  }}
                />
              </label>

              <label style={{ display: 'grid', gap: '0.35rem' }}>
                <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>Beschreibung</span>
                <textarea
                  value={newPollDescription}
                  onChange={(e) => setNewPollDescription(e.target.value)}
                  rows={4}
                  style={{
                    width: '100%',
                    padding: '0.7rem 0.8rem',
                    border: '1px solid #d1d5db',
                    borderRadius: '0.65rem',
                    font: 'inherit',
                    boxSizing: 'border-box',
                    resize: 'vertical',
                  }}
                />
              </label>

              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.55rem',
                  fontSize: '0.92rem',
                }}
              >
                <input
                  type="checkbox"
                  checked={newPollAllowMaybe}
                  onChange={(e) => setNewPollAllowMaybe(e.target.checked)}
                />
                <span>„Vielleicht“ erlauben</span>
              </label>

              <div style={{ display: 'grid', gap: '0.45rem' }}>
                  <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>
                    Teilen mit Gruppen
                  </div>

                  <div
                    style={{
                      border: '1px solid #e5e7eb',
                      borderRadius: '0.75rem',
                      padding: '0.65rem 0.75rem',
                      display: 'grid',
                      gap: '0.45rem',
                      maxHeight: '10rem',
                      overflowY: 'auto',
                    }}
                  >
                    {availableShareGroups.length === 0 ? (
                      <div style={{ color: '#64748b', fontSize: '0.88rem' }}>
                        Keine Gruppen verfügbar.
                      </div>
                    ) : (
                      availableShareGroups.map((group) => (
                        <label
                          key={group.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.55rem',
                            fontSize: '0.92rem',
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={selectedShareGroupIds.includes(group.id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedShareGroupIds((current) => [...current, group.id])
                              } else {
                                setSelectedShareGroupIds((current) =>
                                  current.filter((id) => id !== group.id),
                                )
                              }
                            }}
                          />
                          <span>{group.displayName || group.id}</span>
                        </label>
                      ))
                    )}
                  </div>
                </div>

              <div style={{ display: 'grid', gap: '0.45rem' }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>Termine</div>

                <IconButton
                  onClick={addPollOptionRow}
                  title="Termin hinzufügen"
                  icon={<Plus size={18} />}
                  size={40}
                />
                </div>

                <div
                  style={{
                    border: '1px solid #e5e7eb',
                    borderRadius: '0.75rem',
                    overflow: 'hidden',
                    background: '#ffffff',
                  }}
                >
                  {newPollOptions.map((row, index) => (
                    <div
                      key={row.id}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr auto',
                        gap: '0.6rem',
                        padding: '0.75rem 0.85rem',
                        borderBottom:
                          index === newPollOptions.length - 1 ? 'none' : '1px solid #f1f5f9',
                        alignItems: 'center',
                      }}
                    >
                      <input
                        type="date"
                        value={row.date}
                        onChange={(e) =>
                          updatePollOptionRow(row.id, { date: e.target.value })
                        }
                        style={{
                          width: '100%',
                          padding: '0.65rem 0.7rem',
                          border: '1px solid #d1d5db',
                          borderRadius: '0.6rem',
                          font: 'inherit',
                          boxSizing: 'border-box',
                        }}
                      />

                      <input
                        type="time"
                        value={row.time}
                        onChange={(e) =>
                          updatePollOptionRow(row.id, { time: e.target.value })
                        }
                        style={{
                          width: '100%',
                          padding: '0.65rem 0.7rem',
                          border: '1px solid #d1d5db',
                          borderRadius: '0.6rem',
                          font: 'inherit',
                          boxSizing: 'border-box',
                        }}
                      />

                      <IconButton
                        onClick={() => removePollOptionRow(row.id)}
                        disabled={newPollOptions.length <= 1}
                        title="Termin entfernen"
                        icon={<Trash2 size={18} />}
                        variant={newPollOptions.length <= 1 ? 'default' : 'danger'}
                        size={40}
                      />
                    </div>
                  ))}
                </div>
              </div>

              {createPollError ? (
                <div style={{ color: '#b91c1c', fontSize: '0.9rem' }}>
                  {createPollError}
                </div>
              ) : null}

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  gap: '0.5rem',
                  marginTop: '0.4rem',
                }}
              >
                <IconButton
                  onClick={closeCreatePollDialog}
                  disabled={createPollLoading}
                  title="Abbrechen"
                  icon={<X size={18} />}
                  size={40}
                />

                <IconButton
                  onClick={handleCreatePoll}
                  disabled={createPollLoading}
                  title="Umfrage erstellen"
                  icon={<Plus size={18} />}
                  variant="primary"
                  size={40}
                />
              </div>
            </div>
          </div>
        </div>
      ) : null}


      {showInfoScreen && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            background: 'rgba(15, 23, 42, 0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1rem',
          }}
          onClick={() => setShowInfoScreen(false)}
        >
          <div
            style={{
              width: '100%',
              maxWidth: '420px',
              background: '#fff',
              borderRadius: '1rem',
              padding: '1.25rem',
              boxShadow: '0 20px 45px rgba(15, 23, 42, 0.25)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ marginTop: 0 }}>PollBee</h2>

            <p>
              PollBee ist eine mobile Oberfläche für die Nextcloud-Umfragen des NTSO.
            </p>

            <p style={{ color: '#64748b', fontSize: '0.95rem' }}>
              Version: {releaseLoading ? 'lädt…' : `Release ${releaseVersion}`}
              <div style={{ marginTop: '1rem' }}>
                <h3 style={{ marginBottom: '0.4rem' }}>Changelog</h3>

                <div
                  style={{
                    maxHeight: '220px',
                    overflowY: 'auto',
                    whiteSpace: 'pre-wrap',
                    fontSize: '0.9rem',
                    lineHeight: 1.45,
                    color: '#334155',
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    borderRadius: '0.7rem',
                    padding: '0.75rem',
                  }}
                >
                  {releaseLoading ? 'lädt…' : releaseChangelog}
                </div>
              </div>
            </p>

            <a
              href="https://github.com/blauhorn/PollBee"
              target="_blank"
              rel="noreferrer"
              style={{
                color: '#2563eb',
                fontWeight: 600,
                textDecoration: 'none',
              }}
            >
              Projekt auf GitHub öffnen
            </a>

            <div style={{ marginTop: '1.25rem', textAlign: 'right' }}>
              <button
                type="button"
                onClick={() => setShowInfoScreen(false)}
                style={{
                  border: 0,
                  borderRadius: '0.6rem',
                  padding: '0.55rem 0.9rem',
                  background: '#0f172a',
                  color: '#fff',
                  font: 'inherit',
                  cursor: 'pointer',
                }}
              >
                Schließen
              </button>
            </div>
          </div>
        </div>
      )}  
    </main>
  )
}
