import { Fragment, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { MessageCircle, Share2, Check, Lock, LockOpen, UserCog, CalendarPlus, X, ArrowLeft, Trash2, Plus, MoreVertical, Pencil } from 'lucide-react'
import IconButton from '../components/IconButton'
import {showSuccess, showError, showLoading} from '../utils/toast'

import {
  fetchMe,
  fetchPollById,
  fetchPollRegisterSummary,
  submitPollCommentDirect,
  submitVote,
  togglePollClosed,
  searchUsers,
  transferPollOwnership,
  fetchWritableCalendars,
  createPollCalendarEntries,
  createPollShare,
  setPollShareAdmin,
  removePollShareAdmin,
  type PollDetail,
  type PollOption,
  type PollParticipant,
  type PollRegisterSummary,
  type UserSearchResult, 
  type WritableCalendar,
  type User,
  type VoteValue,
  type PollShare,
} from '../api'

function PollDetailActions({
  poll,
  onPollUpdated,
}: {
  poll: PollDetail
  onPollUpdated: (poll: PollDetail) => void
}) {
  const [busy, setBusy] = useState(false)
  const isAllowed = poll.permissions?.canToggleClosed

  async function handleToggleClosed() {
    if (!isAllowed || busy) return
    setBusy(true)
    try {
      const updated = await togglePollClosed(poll.id)
      onPollUpdated(updated.poll)
    } catch (err) {
      console.error(err)
      alert('Der Status der Umfrage konnte nicht geändert werden.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={handleToggleClosed}
      disabled={!isAllowed || busy}
      title={
        isAllowed
          ? poll.isClosed
            ? 'Umfrage öffnen'
            : 'Umfrage schließen'
          : 'Nur der Eigentümer darf die Umfrage öffnen oder schließen'
      }
      className="icon-button"
    >
      {poll.isClosed ? <Lock size={18} /> : <LockOpen size={18} />}
    </button>
  )
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

function formatCreatedDate(ts?: number): string {
  if (!ts) return ''

  const normalized = ts < 1_000_000_000_000 ? ts * 1000 : ts
  return new Date(normalized).toLocaleDateString('de-DE')
}

function voteCount(option: PollOption, kind: 'yes' | 'no' | 'maybe'): number {
  return option.voteSummary?.[kind] ?? 0
}

function missingCount(option: PollOption): number {
  if (typeof option.voteSummary?.missing === 'number') {
    return option.voteSummary.missing
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

function isCurrentUserName(name: string, currentUserName?: string): boolean {
  if (!currentUserName) return false
  return name.trim().toLowerCase() === currentUserName.trim().toLowerCase()
}

function hasFutureOptions(options: PollOption[]): boolean {
  const now = Date.now()

  return options.some((option) => {
    const ts = normalizeTimestamp(option.timestamp)
    return ts !== null && ts > now
  })
}

function isPollClosed(poll: PollDetail): boolean {
  return poll.isClosed === true
}

function getPollOwner(poll: PollDetail): string {
  const extended = poll as PollDetail & { owner?: string }
  return extended.owner ?? ''
}

function getPollCreated(poll: PollDetail): number | undefined {
  const extended = poll as PollDetail & { created?: number }
  return extended.created
}
function getPollStyleForDetail(poll: PollDetail) {
  const closed = isPollClosed(poll)
  const fullyAnswered =
    poll.options.length === 0
      ? true
      : poll.options.every((option) => missingCount(option) === 0)
  const inPast = poll.options.every((option) => {
    const ts = normalizeTimestamp(option.timestamp)
    if (!ts) return false
    return (Date.now() - ts) / (1000 * 60 * 60 * 24) >= 4
  })

  let background = '#ffffff'
  let border = '#d9dee7'
  let color = '#111827'

  if (closed || inPast) {
    background = '#eff6ff'
    border = '#bfdbfe'
  } else if (fullyAnswered) {
    background = '#f0fdf4'
    border = '#bbf7d0'
  } else {
    background = '#fff7ed'
    border = '#fed7aa'
  }

  if (inPast) {
    color = '#9ca3af'
  }

  return { background, border, color }
}
function formatCommentTimestamp(ts?: number): string {
  if (!ts) return ''

  const normalized = ts < 1_000_000_000_000 ? ts * 1000 : ts
  return new Date(normalized).toLocaleString('de-DE')
}

function commentKey(optionId: string, name: string): string {
  return `${optionId}::${name}`
}


type ParticipantChip = {
  displayName: string
  publicComment?: string
  publicCommentTimestamp?: number
}

type GroupedOptionDetails = {
  yes: ParticipantChip[]
  no: ParticipantChip[]
  maybe: ParticipantChip[]
  missing: ParticipantChip[]
}
type PollDetailPageProps = {
  forcedPollId?: string
}

function participantToChip(participant: PollParticipant): ParticipantChip {
  return {
    displayName: participant.displayName,
    publicComment: participant.publicComment,
    publicCommentTimestamp: participant.publicCommentTimestamp,
  }
}

function PollOwnerActionMenu({
  canEdit,
  canDelete,
  onEdit,
  onDelete,
  onManageAuthors,
}: {
  canEdit: boolean
  canDelete: boolean
  onEdit: () => void
  onDelete: () => void
  onManageAuthors: () => void
}) {
  const [open, setOpen] = useState(false)

  function closeAndRun(action: () => void) {
    setOpen(false)
    action()
  }

  return (
    <div style={{ position: 'relative' }}>
      <IconButton
        onClick={() => setOpen((value) => !value)}
        title="Weitere Aktionen"
        icon={<MoreVertical size={20} />}
      />

      {open ? (
        <>
          <button
            type="button"
            aria-label="Menü schließen"
            onClick={() => setOpen(false)}
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 1200,
              border: 0,
              background: 'transparent',
            }}
          />

          <div
            style={{
              position: 'absolute',
              right: 0,
              bottom: 'calc(100% + 0.6rem)',
              zIndex: 1300,
              minWidth: '14rem',
              padding: '0.35rem',
              borderRadius: '0.85rem',
              background: '#ffffff',
              boxShadow: '0 16px 40px rgba(15, 23, 42, 0.22)',
              border: '1px solid #e5e7eb',
            }}
          >
            <button
              type="button"
              disabled={!canEdit}
              onClick={() => closeAndRun(onEdit)}
              style={menuItemStyle}
            >
              <Pencil size={18} />
              Titel & Beschreibung ändern
            </button>

            <button
              type="button"
              onClick={() => closeAndRun(onManageAuthors)}
              style={menuItemStyle}
            >
              <UserCog size={18} />
              Autoren verwalten
            </button>

            <div
              style={{
                height: 1,
                background: '#e5e7eb',
                margin: '0.3rem',
              }}
            />

            <button
              type="button"
              disabled={!canDelete}
              onClick={() => closeAndRun(onDelete)}
              style={{
                ...menuItemStyle,
                color: '#b91c1c',
              }}
            >
              <Trash2 size={18} />
              Umfrage löschen
            </button>
          </div>
        </>
      ) : null}
    </div>
  )
}

const menuItemStyle: React.CSSProperties = {
  width: '100%',
  display: 'flex',
  alignItems: 'center',
  gap: '0.65rem',
  padding: '0.7rem 0.75rem',
  border: 0,
  borderRadius: '0.65rem',
  background: 'transparent',
  font: 'inherit',
  fontSize: '0.92rem',
  textAlign: 'left',
  cursor: 'pointer',
}

export default function PollDetailPage({ forcedPollId }: PollDetailPageProps) {
  const navigate = useNavigate()
  const pollId = forcedPollId ?? params.pollId ?? ''

  const [poll, setPoll] = useState<PollDetail | null>(null)
  const [registerSummary, setRegisterSummary] = useState<PollRegisterSummary | null>(null)
  const [currentUser, setCurrentUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [voteValues, setVoteValues] = useState<Record<string, VoteValue>>({})
  const [saveMessage, setSaveMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({})
  const [expandedComments, setExpandedComments] = useState<Record<string, boolean>>({})
  const [toggleBusy, setToggleBusy] = useState(false)

  const [showAuthorDialog, setShowAuthorDialog] = useState(false)
  const [pollAdminLoading, setPollAdminLoading] = useState(false)
  const [pollAdminError, setPollAdminError] = useState('')
  const [ownerSearch, setOwnerSearch] = useState('')
  const [ownerSearchResults, setOwnerSearchResults] = useState<UserSearchResult[]>([])
  const [selectedNewOwnerId, setSelectedNewOwnerId] = useState('')
  const [selectedNewOwnerLabel, setSelectedNewOwnerLabel] = useState('')
  const [transferConfirm, setTransferConfirm] = useState(false)
  const [transferLoading, setTransferLoading] = useState(false)
  const [transferError, setTransferError] = useState('')
  const [selectedNewAdminToken, setSelectedNewAdminToken] = useState('')
  const [selectedNewAdminLabel, setSelectedNewAdminLabel] = useState('')
  
  const [coAuthorSearch, setCoAuthorSearch] = useState('')
  const [coAuthorSearchResults, setCoAuthorSearchResults] = useState<UserSearchResult[]>([])
  const [selectedNewPollAdmins, setSelectedNewPollAdmins] = useState<UserSearchResult[]>([])
  const [pollAdminConfirm, setPollAdminConfirm] = useState(false)

  const [showCalendarDialog, setShowCalendarDialog] = useState(false)
  const [calendarLoading, setCalendarLoading] = useState(false)
  const [calendarSaving, setCalendarSaving] = useState(false)
  const [calendarError, setCalendarError] = useState('')
  const [calendarSuccess, setCalendarSuccess] = useState('')
  const [writableCalendars, setWritableCalendars] = useState<WritableCalendar[]>([])
  const [selectedCalendarUri, setSelectedCalendarUri] = useState('')
  const [calendarTitle, setCalendarTitle] = useState('')
  const [calendarDescription, setCalendarDescription] = useState('')
  const [calendarLocation, setCalendarLocation] = useState('')
  const [calendarAllDay, setCalendarAllDay] = useState(false)
  const [calendarStartTime, setCalendarStartTime] = useState('19:30')
  const [calendarEndTime, setCalendarEndTime] = useState('22:00')
  const [calendarOptionSelections, setCalendarOptionSelections] = useState<
    Record<string, { selected: boolean; entryStatus: 'inquiry' | 'fixed' | 'canceled' }>
> ({})

  
  async function loadPollDetail() {
    if (!pollId) {
      navigate('/polls', { replace: true })
      return
    }

    try {
      const [pollData, registerData, meData] = await Promise.all([
        fetchPollById(pollId),
        fetchPollRegisterSummary(pollId),
        fetchMe(),
      ])

      console.log('pollData', pollData)
      console.log('participants', pollData.participants)

      setPoll(pollData)
      setRegisterSummary(registerData)
      setCurrentUser(meData)
      setVoteValues(pollData.currentVotes ?? {})
      setError('')
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unbekannter Fehler'

      if (message.includes('401')) {
        navigate('/login', { replace: true })
        return
      }

      console.error('Poll detail request failed:', err)

      navigate('/polls', {
        replace: true,
        state: {
          message: 'Die angeforderte Umfrage wurde nicht gefunden oder konnte nicht geladen werden.',
        },
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadPollDetail()
  }, [pollId])

  function buildPollAppUrl(pollId: string) {
    return new URL(`${BASE_PATH}polls/${pollId}`, window.location.origin).toString()
  }

  function handleVoteChange(optionId: string, value: VoteValue) {
    setVoteValues((prev) => ({
      ...prev,
      [optionId]: value,
    }))
    setSaveMessage('')
  }

  function toggleRow(optionId: string) {
    setExpandedRows((prev) => ({
      ...prev,
      [optionId]: !prev[optionId],
    }))
  }

  function toggleCalendarOptionSelected(optionId: string) {
    setCalendarOptionSelections((prev) => ({
      ...prev,
      [optionId]: {
        ...(prev[optionId] ?? { selected: false, entryStatus: 'inquiry' }),
        selected: !prev[optionId]?.selected,
      },
    }))
  }

  function setCalendarOptionStatus(
    optionId: string,
    status: 'inquiry' | 'fixed' | 'canceled',
  ) {
    setCalendarOptionSelections((prev) => ({
      ...prev,
      [optionId]: {
        ...(prev[optionId] ?? { selected: true, entryStatus: 'inquiry' }),
        selected: true,
        entryStatus: status,
      },
    }))
  }

  async function handleSave() {
    if (!pollId || !poll) {
      return
    }

    setSaving(true)
    setSaveMessage('')

    try {
      for (const option of poll.options) {
        const value = voteValues[option.id]
        if (value) {
          await submitVote(pollId, option.id, value)
        }
      }

      showSuccess('Deine Stimme wurde gespeichert.')

      const [refreshed, registerData] = await Promise.all([
        fetchPollById(pollId),
        fetchPollRegisterSummary(pollId),
      ])

      setPoll(refreshed)
      setVoteValues(refreshed.currentVotes ?? {})
      setRegisterSummary(registerData)
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unbekannter Fehler'

      if (message.includes('401')) {
        navigate('/login')
        return
      }

      showError(`Fehler beim Speichern: ${message}`)
    } finally {
      setSaving(false)
    }
  }
  async function handleSharePoll() {
    if (!poll?.id) {
      setSaveMessage('Die Umfrage konnte nicht geteilt werden.')
      return
    }

    const shareUrl = buildPollAppUrl(poll.id)
    const shareTitle = poll.title || 'Umfrage'
    const shareText = `📅 ${shareTitle}\n\nBitte abstimmen 👇`

    try {
      if (navigator.share) {
        await navigator.share({
          title: shareTitle,
          text: shareText,
          url: shareUrl,
        })
        return
      }

      await navigator.clipboard.writeText(shareUrl)
      setSaveMessage('Link zur Umfrage wurde in die Zwischenablage kopiert.')
    } catch (error) {
      // 👇 HIER ist der wichtige Teil
      if (error instanceof DOMException && error.name === 'AbortError') {
        // Nutzer hat Teilen abgebrochen → einfach ignorieren
        return
      }

      console.error('Teilen fehlgeschlagen:', error)

      try {
        await navigator.clipboard.writeText(shareUrl)
        setSaveMessage('Teilen nicht verfügbar. Link wurde in die Zwischenablage kopiert.')
      } catch {
        setSaveMessage('Teilen ist auf diesem Gerät leider nicht verfügbar.')
      }
    }
  }

  function openPollInNextcloud() {
  if (!pollId) {
    return
  }

    window.open(`/apps/polls/vote/${pollId}`, '_blank')
}

  async function handleToggleClosed() {
    if (!poll || !poll.permissions?.canToggleClosed || toggleBusy) {
      return
    }

    setToggleBusy(true)
    try {
      const result = await togglePollClosed(poll.id)
      setPoll(result.poll)
      showSuccess('Umfragestatus wurde geändert')
    } catch (err) {
      console.error(err)
      showError('Der Status der Umfrage konnte nicht geändert werden.')
    } finally {
      setToggleBusy(false)
    }
  }

  async function handleOwnerSearch(query: string) {
  setOwnerSearch(query)
  setTransferError('')

  if (!query.trim()) {
    setOwnerSearchResults([])
    return
  }

  try {
    const results = await searchUsers(query.trim())
    const filtered = results.filter((user) => user.id !== poll.currentUser?.id)
    setOwnerSearchResults(filtered)
  } catch (error) {
    console.error(error)
    setTransferError('Benutzersuche fehlgeschlagen.')
  }
}

  async function handleCoAuthorSearch(value: string) {
    setCoAuthorSearch(value)

    if (value.trim().length < 2) {
      setCoAuthorSearchResults([])
      return
    }

    try {
      const results = await searchUsers(value)
      setCoAuthorSearchResults(results)
    } catch (error) {
      console.error('Co-author search failed:', error)
      setCoAuthorSearchResults([])
    }
  }

  function openTransferOwnerDialog() {
    setShowAuthorDialog(true)
    setOwnerSearch('')
    setOwnerSearchResults([])
    setSelectedNewOwnerId('')
    setSelectedNewOwnerLabel('')
    setTransferConfirm(false)
    setTransferError('')
  }

  function closeTransferOwnerDialog() {
    if (transferLoading) return
    setShowAuthorDialog(false)
  }

  async function handleTransferOwnership() {
    if (!poll?.id || !selectedNewOwnerId || !transferConfirm || transferLoading) {
      return
    }

    setTransferLoading(true)
    setTransferError('')

    try {
      await transferPollOwnership(poll.id, selectedNewOwnerId)

      setShowAuthorDialog(false)
      showSuccess('Eigentümer erfolgreich übertragen')

      await loadPollDetail()
    } catch (error) {
      console.error(error)

      const message =
        error instanceof Error
          ? error.message
          : 'Eigentümerschaft konnte nicht übertragen werden.'

      setTransferError(message)
      showError(message)
    } finally {
      setTransferLoading(false)
    }
  }

  async function openCalendarDialog() {
    setShowCalendarDialog(true)
    setCalendarLoading(true)
    setCalendarSaving(false)
    setCalendarError('')
    setCalendarSuccess('')
    setCalendarTitle(poll.title || '')
    setCalendarDescription(poll.description || '')
    setCalendarLocation('')
    setCalendarAllDay(false)
    setCalendarStartTime('19:30')
    setCalendarEndTime('22:00')

    const initialSelections: Record<
      string,
      { selected: boolean; entryStatus: 'inquiry' | 'fixed' | 'canceled' }
    > = {}

    for (const option of poll.options) {
      initialSelections[option.id] = {
        selected: true,
        entryStatus: 'inquiry',
      }
    }

    setCalendarOptionSelections(initialSelections)

    try {
      const calendars = await fetchWritableCalendars()
      setWritableCalendars(calendars)
      setSelectedCalendarUri((prev) => prev || calendars[0]?.uri || '')
    } catch (error) {
      console.error(error)
      setCalendarError('Kalender konnten nicht geladen werden.')
      setWritableCalendars([])
      setSelectedCalendarUri('')
    } finally {
      setCalendarLoading(false)
    }
  }

  function closeCalendarDialog() {
    if (calendarSaving) return
    setShowCalendarDialog(false)
  }

  async function handleCreateCalendarEntries() {
    if (!poll?.id || !selectedCalendarUri || calendarSaving) {
      return
    }

    setCalendarSaving(true)
    setCalendarError('')
    setCalendarSuccess('')

    const pollAppUrl = buildPollAppUrl(poll.id)

    const optionSelections = Object.entries(calendarOptionSelections)
      .filter(([, value]) => value.selected)
      .map(([optionId, value]) => ({
        optionId,
        entryStatus: value.entryStatus,
      }))

    if (optionSelections.length === 0) {
      const message = 'Bitte mindestens eine Option auswählen.'
      setCalendarError(message)
      showError(message)
      setCalendarSaving(false)
      return
    }

    try {
      const result = await createPollCalendarEntries(poll.id, {
        calendarUri: selectedCalendarUri,
        title: calendarTitle.trim() || poll.title,
        description: calendarDescription.trim(),
        location: calendarLocation.trim(),
        optionSelections,
        allDay: calendarAllDay,
        startTime: calendarAllDay ? undefined : calendarStartTime,
        endTime: calendarAllDay ? undefined : calendarEndTime,
        pollAppUrl,
      })

      showSuccess(`${result.createdCount} Kalendereinträge erzeugt.`)
      setShowCalendarDialog(false)
    } catch (error) {
      console.error(error)

      const message =
        error instanceof Error
          ? error.message
          : 'Kalendereinträge konnten nicht erzeugt werden.'

      setCalendarError(message)
      showError(message)
    } finally {
      setCalendarSaving(false)
    }
  }
  async function handleMakePollAdmin(share: PollShare) {
    setPollAdminError('')
    setPollAdminLoading(true)

    try {
      await setPollShareAdmin(share.token)
      await loadPollDetail()
    } catch (error) {
      setPollAdminError(
        error instanceof Error ? error.message : 'Co-Autor konnte nicht hinzugefügt werden.',
      )
    } finally {
      setPollAdminLoading(false)
    }
  }

  async function handleGrantSelectedPollAdmins() {
    setPollAdminError('')
    setPollAdminLoading(true)

    try {
      for (const user of selectedNewPollAdmins) {
        let share = pollShares.find((item) => {
          return item.user?.id === user.id || item.user?.userId === user.id
        })

        if (!share) {
          share = await createPollShare(poll!.id, user.id)
        }

        if (!share.token) {
          throw new Error(
            `Kein Share-Token für ${user.displayName || user.id} erhalten.`,
          )
        }

        await setPollShareAdmin(share.token)
      }

      setSelectedNewPollAdmins([])
      setPollAdminConfirm(false)
      await loadPollDetail()

      showSuccess('Co-Autor(en) hinzugefügt')
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Co-Autoren konnten nicht hinzugefügt werden.'

      setPollAdminError(message)
      showError(message)
    } finally {
      setPollAdminLoading(false)
    }
  }

  async function handleRemovePollAdmin(share: PollShare) {
    setPollAdminError('')
    setPollAdminLoading(true)

    try {
      await removePollShareAdmin(share.token)
      await loadPollDetail()

      showSuccess('Co-Autor entfernt')
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Co-Autor konnte nicht entfernt werden.'

      setPollAdminError(message)
      showError(message)
    } finally {
      setPollAdminLoading(false)
    }
  }

  function closeAuthorDialog() {
    setShowAuthorDialog(false)

    setOwnerSearch('')
    setOwnerSearchResults([])
    setSelectedNewOwnerId('')
    setSelectedNewOwnerLabel('')
    setTransferConfirm(false)
    setTransferError('')

    setCoAuthorSearch('')
    setCoAuthorSearchResults([])
    setSelectedNewPollAdmins([])
    setPollAdminConfirm(false)
    setPollAdminError('')
  }

  function openAuthorDialog() {
    setShowAuthorDialog(true)
    setPollAdminError('')
    setTransferError('')
    setTransferConfirm(false)
    setSelectedNewOwnerId('')
    setSelectedNewOwnerLabel('')
  }

  const optionDetails = useMemo(() => {
    if (!poll) return {}

    const byOption: Record<string, Record<string, GroupedOptionDetails>> = {}

    const makeEmptyGroup = (): GroupedOptionDetails => ({
      yes: [],
      no: [],
      maybe: [],
      missing: [],
    })

    const uniqueChips = (items: ParticipantChip[]) =>
      Array.from(
        new Map(
          items.map((item) => [item.displayName.trim().toLowerCase(), item]),
        ).values(),
      ).sort((a, b) => a.displayName.localeCompare(b.displayName, 'de'))

    for (const option of poll.options) {
      byOption[option.id] = {}
    }

    if (!registerSummary) {
      for (const option of poll.options) {
        byOption[option.id]['Ohne Register'] = makeEmptyGroup()
      }

      for (const participant of poll.participants ?? []) {
        for (const option of poll.options) {
          const answer = participant.answersByOption[option.id]
          const group = byOption[option.id]['Ohne Register']
          const chip = participantToChip(participant)

          if (answer === 'yes') group.yes.push(chip)
          else if (answer === 'no') group.no.push(chip)
          else if (answer === 'maybe') group.maybe.push(chip)
          else group.missing.push(chip)
        }
      }

      for (const option of poll.options) {
        const group = byOption[option.id]['Ohne Register']
        group.yes = uniqueChips(group.yes)
        group.no = uniqueChips(group.no)
        group.maybe = uniqueChips(group.maybe)
        group.missing = uniqueChips(group.missing)
      }

      return byOption
    }

    const registerByDisplayName = new Map<string, string>()

    for (const registerItem of registerSummary.registers) {
      const registerName = registerItem.registerName

      for (const member of registerItem.completeMembers) {
        registerByDisplayName.set(member.displayName.trim().toLowerCase(), registerName)
      }
      for (const member of registerItem.partialMembers) {
        registerByDisplayName.set(member.displayName.trim().toLowerCase(), registerName)
      }
      for (const member of registerItem.missingMembers) {
        registerByDisplayName.set(member.displayName.trim().toLowerCase(), registerName)
      }

      for (const option of poll.options) {
        byOption[option.id][registerName] = makeEmptyGroup()
      }
    }

    for (const participant of poll.participants ?? []) {
      const registerName =
        registerByDisplayName.get(participant.displayName.trim().toLowerCase()) ??
        'Ohne Register'

      for (const option of poll.options) {
        if (!byOption[option.id][registerName]) {
          byOption[option.id][registerName] = makeEmptyGroup()
        }

        const answer = participant.answersByOption[option.id]
        const group = byOption[option.id][registerName]
        const chip = participantToChip(participant)

        if (answer === 'yes') {
          group.yes.push(chip)
        } else if (answer === 'no') {
          group.no.push(chip)
        } else if (answer === 'maybe') {
          group.maybe.push(chip)
        }
      }
    }

    for (const registerItem of registerSummary.registers) {
      const registerName = registerItem.registerName

      for (const member of registerItem.missingMembers) {
        for (const option of poll.options) {
          byOption[option.id][registerName].missing.push({
            displayName: member.displayName,
          })
        }
      }

      for (const member of registerItem.partialMembers) {
        const participant = (poll.participants ?? []).find(
          (item) =>
            item.displayName.trim().toLowerCase() ===
            member.displayName.trim().toLowerCase(),
        )

        for (const option of poll.options) {
          const answer = participant?.answersByOption?.[option.id]
          if (!answer) {
            byOption[option.id][registerName].missing.push(
              participant
                ? participantToChip(participant)
                : { displayName: member.displayName },
            )
          }
        }
      }
    }

    for (const option of poll.options) {
      for (const registerName of Object.keys(byOption[option.id])) {
        const group = byOption[option.id][registerName]

        group.yes = uniqueChips(group.yes)
        group.no = uniqueChips(group.no)
        group.maybe = uniqueChips(group.maybe)
        group.missing = uniqueChips(group.missing)
      }
    }

    return byOption
  }, [poll, registerSummary])

  const iconButtonStyle: React.CSSProperties = {
    width: '44px',
    height: '44px',
    borderRadius: '50%',
    border: '1px solid #e2e8f0',
    background: '#ffffff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  }

  const primaryButtonStyle: React.CSSProperties = {
    width: '44px',
    height: '44px',
    borderRadius: '50%',
    border: 'none',
    background: '#2563eb', // schönes Blau
    color: '#ffffff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
  }

  const BASE_PATH = import.meta.env.VITE_BASE_PATH || '/pollapp/'

  function getOptionTotals(optionId: string) {
  const grouped = optionDetails[optionId] ?? {}

  let yes = 0
  let no = 0
  let maybe = 0
  let missing = 0

  for (const group of Object.values(grouped)) {
    yes += group.yes.length
    no += group.no.length
    maybe += group.maybe.length
    missing += group.missing.length
  }

  return { yes, no, maybe, missing }
}

  const saveDisabled = !poll || isPollClosed(poll) || !hasFutureOptions(poll.options)

  function renderNameList(
    entries: ParticipantChip[],
    emptyText: string,
    currentUserName: string | undefined,
    optionId: string,
    answerType: 'yes' | 'no' | 'maybe' | 'missing',
    
  ) {
    void answerType
    console.log('entries for option', optionId, entries)
    if (entries.length === 0) {
      return <span style={{ color: '#9ca3af' }}>{emptyText}</span>
    }

    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
        {entries.map((entry) => {
          const name = entry.displayName
          const comment = entry.publicComment ?? ''
          const commentTs = entry.publicCommentTimestamp
          const hasComment = comment.trim().length > 0
          const isOwnName = isCurrentUserName(name, currentUserName)
          const key = commentKey(optionId, name)
          const showComment = !!expandedComments[key]

          return (
            <div key={name} style={{ position: 'relative' }}>
              <button
                type="button"
                onClick={() =>
                  setExpandedComments((prev) => ({
                    ...prev,
                    [key]: !prev[key],
                  }))
                }
                style={{
                  padding: '0.2rem 0.45rem',
                  borderRadius: '0.45rem',
                  background: isOwnName ? '#d1fae5' : '#f3f4f6',
                  lineHeight: 1.3,
                  border: '1px solid #e5e7eb',
                  cursor: 'pointer',
                  font: 'inherit',
                  position: 'relative',
                }}
              >
                {name}

                {hasComment ? (
                  <span
                    style={{
                      position: 'absolute',
                      top: '-0.12rem',
                      right: '-0.12rem',
                      width: '0.42rem',
                      height: '0.42rem',
                      borderRadius: '999px',
                      background: '#2563eb',
                    }}
                  />
                ) : null}
              </button>

              {showComment ? (
                <div
                  style={{
                    marginTop: '0.3rem',
                    padding: '0.45rem 0.55rem',
                    border: '1px solid #e5e7eb',
                    borderRadius: '0.55rem',
                    background: '#ffffff',
                    minWidth: '14rem',
                    maxWidth: '22rem',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                  }}
                >
                  <div style={{ fontSize: '0.9rem', lineHeight: 1.35 }}>
                    {comment || 'Kein Kommentar'}
                  </div>
                  <div
                    style={{
                      marginTop: '0.35rem',
                      fontSize: '0.78rem',
                      color: '#6b7280',
                    }}
                  >
                    {commentTs ? `Kommentar vom: ${formatCommentTimestamp(commentTs)}` : 'Zeitpunkt unbekannt'}
                  </div>
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
    )
  }

  function addSelectedNewPollAdmin(user: UserSearchResult) {
    const alreadySelected = selectedNewPollAdmins.some((item) => item.id === user.id)

    const alreadyAdmin = pollAdmins.some((share) => {
      return share.user?.id === user.id || share.user?.userId === user.id
    })

    if (alreadySelected || alreadyAdmin) {
      return
    }

    setSelectedNewPollAdmins((current) => [...current, user])
    setCoAuthorSearch('')
    setCoAuthorSearchResults([])
  }

  function removeSelectedNewPollAdmin(userId: string) {
    setSelectedNewPollAdmins((current) =>
      current.filter((user) => user.id !== userId),
    )
  }

  if (loading) {
    return <p style={{ padding: '1rem' }}>Lade Poll-Details...</p>
  }

  if (error) {
    return (
      <main style={{ padding: '1rem' }}>
        <p style={{ color: 'crimson' }}>Fehler: {error}</p>
        <p>
          <Link to="/polls">Zurück zur Poll-Liste</Link>
        </p>
      </main>
    )
  }

  if (!poll) {
    return (
      <main style={{ padding: '1rem' }}>
        <p>Umfrage nicht gefunden.</p>
        <p>
          <Link to="/polls">Zurück zur Poll-Liste</Link>
        </p>
      </main>
    )
  }

  const owner = getPollOwner(poll)
  const created = getPollCreated(poll)
  const pollShares: PollShare[] = poll?.shares ?? []

  const pollAdmins = pollShares.filter((share) => {
    if (share.deleted) return false
    if (!share.user?.isUnrestrictedOwner) return false
    if (share.user.id === poll?.owner?.id) return false
    return true
  })

  const isPollAdmin = poll?.permissions?.isPollAdmin === true
  const canManageAuthors = poll?.permissions?.canManageAuthors === true
  const pollAdminCandidates = pollShares.filter((share) => {
    if (share.deleted) return false
    if (!share.user) return false
    if (share.user.isGuest || share.user.isNoUser) return false
    if (share.user.isUnrestrictedOwner) return false
    return true
  })

  return (
  <main
    style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      background: '#ffffff',
      paddingBottom: '6.5rem',
    }}
  >
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
          gap: '0.85rem',
          marginBottom: '0.5rem',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            minWidth: 0,
            flex: 1,
          }}
        >
         <Link
            to="/polls"
            aria-label="Zurück zur Poll-Liste"
            style={{
              width: '40px',
              height: '40px',
              borderRadius: '50%',
              border: '1px solid #e5e7eb',
              background: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#374151',
              textDecoration: 'none',
              flexShrink: 0,
            }}
          >
            <ArrowLeft size={18} />
          </Link>

          <div
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
              <span>{currentUser?.displayName?.slice(0, 1).toUpperCase() ?? '?'}</span>
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
              PollBee
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
            src={`${BASE_PATH}branding/logo-ntso.svg`}
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

      <div>
        <div
          style={{
            fontSize: '1.15rem',
            fontWeight: 700,
            lineHeight: 1.3,
            marginBottom: '0.2rem',
          }}
        >
          {poll.title}
        </div>

        {(owner || created) ? (
          <div
            style={{
              fontSize: '0.78rem',
              color: '#6b7280',
              fontStyle: 'italic',
              marginBottom: '0.2rem',
            }}
          >
            {owner ? `von ${owner}` : ''}
            {created ? ` · ${formatCreatedDate(created)}` : ''}
          </div>
        ) : null}

        {poll.description ? (
          <div
            style={{
              fontSize: '0.92rem',
              color: '#4b5563',
              lineHeight: 1.4,
            }}
          >
            {poll.description}
          </div>
        ) : null}
      </div>
    </section>

    <section
      style={{
        flex: 1,
        overflowY: 'auto',
        padding: '0.85rem',
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void handleSave()
        }}
      >
        <div
          style={{
            border: `1px solid ${getPollStyleForDetail(poll).border}`,
            borderRadius: '0.8rem',
            overflow: 'hidden',
            background: getPollStyleForDetail(poll).background,
            color: getPollStyleForDetail(poll).color,
          }}
        >
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
                    padding: '0.55rem 0.4rem 0.55rem 0.75rem',
                    fontWeight: 600,
                  }}
                >
                  Datum
                </th>
                <th style={{ textAlign: 'center', padding: '0.55rem 0.35rem', fontWeight: 600 }}>
                  <HeaderIcon symbol="✅" label="Ja" />
                </th>
                <th style={{ textAlign: 'center', padding: '0.55rem 0.35rem', fontWeight: 600 }}>
                  <HeaderIcon symbol="❌" label="Nein" />
                </th>
                <th style={{ textAlign: 'center', padding: '0.55rem 0.35rem', fontWeight: 600 }}>
                  <HeaderIcon symbol="❔" label="Vielleicht" />
                </th>
                <th style={{ textAlign: 'center', padding: '0.55rem 0.35rem', fontWeight: 600 }}>
                  <HeaderIcon symbol="⏳" label="Fehlt" />
                </th>
              </tr>
            </thead>

            <tbody>
              {poll.options.map((option) => {
                const expanded = !!expandedRows[option.id]
                const selectedValue = voteValues[option.id]
                const grouped = optionDetails[option.id] ?? {}
                const totals = getOptionTotals(option.id)

                return (
                  <Fragment key={option.id}>
                    <tr
                      onClick={() => toggleRow(option.id)}
                      style={{
                        borderBottom: expanded ? 'none' : '1px solid #f0f2f5',
                        cursor: 'pointer',
                      }}
                    >
                      <td style={{ padding: '0.5rem 0.35rem 0.5rem 0.75rem' }}>
                        <div style={{ fontWeight: 600 }}>{formatOptionDate(option)}</div>
                        <div
                          onClick={(event) => event.stopPropagation()}
                          style={{
                            marginTop: '0.35rem',
                            display: 'flex',
                            gap: '0.45rem',
                            flexWrap: 'wrap',
                            fontSize: '0.9rem',
                          }}
                        >
                          <label>
                            <input
                              type="radio"
                              name={`vote-${option.id}`}
                              value="yes"
                              checked={selectedValue === 'yes'}
                              disabled={saveDisabled}
                              onChange={() => handleVoteChange(option.id, 'yes')}
                            />{' '}
                            Ja
                          </label>

                          <label>
                            <input
                              type="radio"
                              name={`vote-${option.id}`}
                              value="no"
                              checked={selectedValue === 'no'}
                              disabled={saveDisabled}
                              onChange={() => handleVoteChange(option.id, 'no')}
                            />{' '}
                            Nein
                          </label>

                          {poll.allowMaybe ? (
                            <label>
                              <input
                                type="radio"
                                name={`vote-${option.id}`}
                                value="maybe"
                                checked={selectedValue === 'maybe'}
                                disabled={saveDisabled}
                                onChange={() => handleVoteChange(option.id, 'maybe')}
                              />{' '}
                              Vielleicht
                            </label>
                          ) : null}
                        </div>
                      </td>

                      <td style={{ textAlign: 'center', padding: '0.4rem 0.35rem' }}>
                        {totals.yes}
                      </td>
                      <td style={{ textAlign: 'center', padding: '0.4rem 0.35rem' }}>
                        {totals.no}
                      </td>
                      <td style={{ textAlign: 'center', padding: '0.4rem 0.35rem' }}>
                        {totals.maybe}
                      </td>
                      <td style={{ textAlign: 'center', padding: '0.4rem 0.35rem' }}>
                        {totals.missing}
                      </td>
                    </tr>

                    {expanded ? (
                      <tr
                        style={{
                          borderBottom: '1px solid #f0f2f5',
                          background: '#fafafa',
                        }}
                      >
                        <td colSpan={5} style={{ padding: '0.75rem' }}>
                          <div
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '0.9rem',
                            }}
                          >
                            {Object.entries(grouped).map(([registerName, group]) => {
                              const typedGroup = group as GroupedOptionDetails

                              return (
                                <div
                                  key={registerName}
                                  style={{
                                    border: '1px solid #e5e7eb',
                                    borderRadius: '0.7rem',
                                    padding: '0.75rem',
                                    background: '#ffffff',
                                  }}
                                >
                                  <div
                                    style={{
                                      fontWeight: 700,
                                      marginBottom: '0.6rem',
                                    }}
                                  >
                                    {registerName}
                                  </div>

                                  <div
                                    style={{
                                      display: 'grid',
                                      gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
                                      gap: '0.75rem',
                                    }}
                                  >
                                    <div>
                                      <div style={{ fontWeight: 600, marginBottom: '0.35rem' }}>
                                        ✅
                                      </div>
                                      {renderNameList(
                                        typedGroup.yes,
                                        'Niemand',
                                        currentUser?.displayName ?? poll.currentUser?.displayName,
                                        option.id,
                                        'yes',
                                      )}
                                    </div>

                                    <div>
                                      <div style={{ fontWeight: 600, marginBottom: '0.35rem' }}>
                                        ❌
                                      </div>
                                      {renderNameList(
                                        typedGroup.no,
                                        'Niemand',
                                        currentUser?.displayName ?? poll.currentUser?.displayName,
                                        option.id,
                                        'no',
                                      )}
                                    </div>

                                    <div>
                                      <div style={{ fontWeight: 600, marginBottom: '0.35rem' }}>
                                        ❔
                                      </div>
                                      {renderNameList(
                                        typedGroup.maybe,
                                        'Niemand',
                                        currentUser?.displayName ?? poll.currentUser?.displayName,
                                        option.id,
                                        'maybe',
                                      )}
                                    </div>

                                    <div>
                                      <div style={{ fontWeight: 600, marginBottom: '0.35rem' }}>
                                        ⏳
                                      </div>
                                      {renderNameList(
                                        typedGroup.missing,
                                        'Niemand',
                                        currentUser?.displayName ?? poll.currentUser?.displayName,
                                        option.id,
                                        'missing',
                                      )}
                                    </div>
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>

        <div
          style={{
            marginTop: '0.85rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            flexWrap: 'wrap',
          }}
        >
          {saveDisabled ? (
            <span style={{ fontSize: '0.9rem', color: '#6b7280' }}>
              Speichern nur möglich, wenn die Umfrage offen ist und noch zukünftige Termine enthält.
            </span>
          ) : null}
        </div>

        {saveMessage ? (
          <p style={{ marginTop: '0.85rem' }}>
            <strong>{saveMessage}</strong>
          </p>
        ) : null}
      </form>
    </section>

    <div
      style={{
        position: 'fixed',
        left: '0.75rem',
        right: '0.75rem',
        bottom: 'max(0.85rem, env(safe-area-inset-bottom))',
        display: 'flex',
        justifyContent: 'center',
        zIndex: 1000,
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.6rem',
          padding: '0.55rem 0.65rem',
          background: 'rgba(255, 255, 255, 0.92)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          borderRadius: '999px',
          boxShadow: '0 10px 30px rgba(15, 23, 42, 0.15)',
          pointerEvents: 'auto',
          maxWidth: '100%',
          overflowX: 'auto',
        }}
      >
        <IconButton
          onClick={openPollInNextcloud}
          title="Kommentar schreiben"
          icon={<MessageCircle size={20} />}
        />

        <IconButton
          onClick={handleSharePoll}
          title="Teilen"
          icon={<Share2 size={20} />}
        />

        <IconButton
          onClick={handleToggleClosed}
          disabled={!poll?.permissions?.canToggleClosed || toggleBusy}
          title={
            poll?.permissions?.canToggleClosed
              ? poll?.isClosed
                ? 'Umfrage öffnen'
                : 'Umfrage schließen'
              : 'Nur der Eigentümer darf die Umfrage öffnen oder schließen'
          }
          icon={poll?.isClosed ? <Lock size={20} /> : <LockOpen size={20} />}
          variant={
            !poll?.permissions?.canToggleClosed
              ? 'default'
              : poll?.isClosed
                ? 'danger'
                : 'default'
          }
        />



        <IconButton
          onClick={openCalendarDialog}
          disabled={!isPollAdmin}
          title={
            isPollAdmin
              ? 'Kalendereinträge aus Umfrage erzeugen'
              : 'Nur Eigentümer oder Co-Autoren können Kalendereinträge erzeugen'
          }
          icon={<CalendarPlus size={20} />}
        />

        <IconButton
          onClick={handleSave}
          disabled={saving || saveDisabled}
          title="Stimme speichern"
          icon={<Check size={20} />}
          variant="primary"
        />

        <PollOwnerActionMenu
          canEdit={canManageAuthors}
          canDelete={canManageAuthors}
          onEdit={() => {
            // später: openEditPollDialog()
            showError('Bearbeiten ist noch nicht implementiert.')
          }}
          onDelete={() => {
            // später: openDeletePollDialog()
            showError('Löschen ist noch nicht implementiert.')
          }}
          onManageAuthors={openAuthorDialog}
        />
      </div>
    </div>

    {showAuthorDialog ? (
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
        onClick={closeAuthorDialog}
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
          }}
        >
          <div style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: '0.5rem' }}>
            Autoren verwalten
          </div>

          <div
            style={{
              fontSize: '0.92rem',
              color: '#4b5563',
              lineHeight: 1.45,
              marginBottom: '1rem',
            }}
          >
            Hier kannst du die Eigentümerschaft übertragen oder weiteren Bandmitgliedern
            Co-Autor-Rechte geben. Co-Autoren können die Umfrage in PollBee verwalten.
          </div>

          {/* Eigentümerwechsel */}
          <div
            style={{
              border: '1px solid #e5e7eb',
              borderRadius: '0.85rem',
              padding: '1rem',
              background: '#f8fafc',
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: '0.35rem' }}>
              Eigentümerwechsel
            </div>

            <div
              style={{
                fontSize: '0.9rem',
                color: '#4b5563',
                lineHeight: 1.45,
                marginBottom: '0.85rem',
              }}
            >
              Die Umfrage wird an einen anderen Nextcloud-Benutzer übertragen. Danach bist du
              nicht mehr Eigentümer dieser Umfrage.
            </div>

            <input
              type="text"
              value={ownerSearch}
              onChange={(e) => void handleOwnerSearch(e.target.value)}
              placeholder="Neuen Eigentümer suchen"
              style={{
                width: '100%',
                padding: '0.7rem 0.8rem',
                border: '1px solid #d1d5db',
                borderRadius: '0.65rem',
                font: 'inherit',
                boxSizing: 'border-box',
                background: '#ffffff',
              }}
            />

            <div
              style={{
                marginTop: '0.65rem',
                maxHeight: '12rem',
                overflowY: 'auto',
                border: '1px solid #e5e7eb',
                borderRadius: '0.65rem',
                background: '#ffffff',
              }}
            >
              {ownerSearchResults.length === 0 ? (
                <div style={{ padding: '0.8rem', color: '#6b7280', fontSize: '0.9rem' }}>
                  Keine Treffer.
                </div>
              ) : (
                ownerSearchResults.map((user) => {
                  const selected = selectedNewOwnerId === user.id

                  return (
                    <button
                      key={user.id}
                      type="button"
                      onClick={() => {
                        setSelectedNewOwnerId(user.id)
                        setSelectedNewOwnerLabel(user.displayName || user.id)
                      }}
                      style={{
                        width: '100%',
                        textAlign: 'left',
                        border: 'none',
                        borderBottom: '1px solid #f1f5f9',
                        background: selected ? '#eff6ff' : '#ffffff',
                        padding: '0.8rem',
                        cursor: 'pointer',
                      }}
                    >
                      <div style={{ fontWeight: 600 }}>{user.displayName || user.id}</div>
                      <div style={{ fontSize: '0.85rem', color: '#6b7280' }}>{user.id}</div>
                    </button>
                  )
                })
              )}
            </div>

            {selectedNewOwnerId ? (
              <label
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '0.6rem',
                  marginTop: '0.9rem',
                  fontSize: '0.92rem',
                  lineHeight: 1.4,
                }}
              >
                <input
                  type="checkbox"
                  checked={transferConfirm}
                  onChange={(e) => setTransferConfirm(e.target.checked)}
                  style={{ marginTop: '0.15rem' }}
                />
                <span>
                  Ich bestätige die Übertragung an <strong>{selectedNewOwnerLabel}</strong>.
                </span>
              </label>
            ) : null}

            {transferError ? (
              <div style={{ marginTop: '0.75rem', color: '#b91c1c', fontSize: '0.9rem' }}>
                {transferError}
              </div>
            ) : null}

            <div
              style={{
                marginTop: '0.85rem',
                display: 'flex',
                justifyContent: 'flex-end',
              }}
            >
              <IconButton
                onClick={handleTransferOwnership}
                disabled={!selectedNewOwnerId || !transferConfirm || transferLoading}
                title="Eigentümerschaft übertragen"
                icon={<Check size={18} />}
                variant="primary"
                size={40}
              />
            </div>
          </div>

          {/* Co-Autoren */}
          <div
            style={{
              marginTop: '1rem',
              border: '1px solid #e5e7eb',
              borderRadius: '0.85rem',
              padding: '1rem',
              background: '#ffffff',
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: '0.35rem' }}>
              Co-Autoren
            </div>

            <div
              style={{
                fontSize: '0.9rem',
                color: '#4b5563',
                lineHeight: 1.45,
                marginBottom: '0.85rem',
              }}
            >
              Co-Autoren erhalten zusätzliche Verwaltungsrechte für diese Umfrage.
            </div>

            <div
              style={{
                display: 'flex',
                gap: '0.5rem',
                alignItems: 'center',
                marginBottom: '0.65rem',
              }}
            >
              <input
                type="text"
                value={coAuthorSearch}
                onChange={(e) => void handleCoAuthorSearch(e.target.value)}
                placeholder="Co-Autor suchen"
                style={{
                  flex: 1,
                  padding: '0.7rem 0.8rem',
                  border: '1px solid #d1d5db',
                  borderRadius: '0.65rem',
                  font: 'inherit',
                  boxSizing: 'border-box',
                }}
              />

              <IconButton
                onClick={() => {
                  if (coAuthorSearchResults.length === 1) {
                    addSelectedNewPollAdmin(coAuthorSearchResults[0])
                  }
                }}
                disabled={coAuthorSearchResults.length !== 1 || pollAdminLoading}
                title="Co-Autor zur Liste hinzufügen"
                icon={<Plus size={18} />}
                variant="primary"
                size={40}
              />
            </div>

            {coAuthorSearchResults.length > 0 ? (
              <div
                style={{
                  marginBottom: '0.85rem',
                  maxHeight: '10rem',
                  overflowY: 'auto',
                  border: '1px solid #e5e7eb',
                  borderRadius: '0.65rem',
                  background: '#ffffff',
                }}
              >
                {coAuthorSearchResults.map((user) => {
                  const alreadySelected = selectedNewPollAdmins.some((item) => item.id === user.id)

                  const alreadyAdmin = pollAdmins.some((share) => {
                    return share.user?.id === user.id || share.user?.userId === user.id
                  })

                  return (
                    <button
                      key={user.id}
                      type="button"
                      disabled={alreadySelected || alreadyAdmin}
                      onClick={() => addSelectedNewPollAdmin(user)}
                      style={{
                        width: '100%',
                        textAlign: 'left',
                        border: 'none',
                        borderBottom: '1px solid #f1f5f9',
                        background: alreadySelected || alreadyAdmin ? '#f8fafc' : '#ffffff',
                        padding: '0.8rem',
                        cursor: alreadySelected || alreadyAdmin ? 'default' : 'pointer',
                        opacity: alreadySelected || alreadyAdmin ? 0.6 : 1,
                      }}
                    >
                      <div style={{ fontWeight: 600 }}>
                        {user.displayName || user.id}
                      </div>
                      <div style={{ fontSize: '0.85rem', color: '#6b7280' }}>
                        {alreadyAdmin
                          ? 'Bereits Co-Autor'
                          : alreadySelected
                            ? 'Bereits vorgemerkt'
                            : user.id}
                      </div>
                    </button>
                  )
                })}
              </div>
            ) : null}

            <div style={{ fontWeight: 600, marginBottom: '0.45rem' }}>
              Eingetragene Co-Autoren
            </div>

            {pollAdmins.length === 0 && selectedNewPollAdmins.length === 0 ? (
              <div style={{ color: '#6b7280', fontSize: '0.9rem', marginBottom: '0.85rem' }}>
                Es sind noch keine Co-Autoren eingetragen.
              </div>
            ) : (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.5rem',
                  marginBottom: '0.9rem',
                }}
              >
                {pollAdmins.map((share) => (
                  <div
                    key={share.token}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '0.75rem',
                      padding: '0.65rem 0.75rem',
                      border: '1px solid #e5e7eb',
                      borderRadius: '0.65rem',
                      background: '#f8fafc',
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600 }}>
                        {share.user?.displayName || share.user?.id || share.token}
                      </div>
                      <div style={{ fontSize: '0.85rem', color: '#6b7280' }}>
                        bereits aktiv
                      </div>
                    </div>

                    <IconButton
                      onClick={() => void handleRemovePollAdmin(share)}
                      disabled={pollAdminLoading}
                      title="Co-Autor entfernen"
                      icon={<Trash2 size={18} />}
                      size={36}
                    />
                  </div>
                ))}

                {selectedNewPollAdmins.map((user) => (
                  <div
                    key={user.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '0.75rem',
                      padding: '0.65rem 0.75rem',
                      border: '1px solid #bfdbfe',
                      borderRadius: '0.65rem',
                      background: '#eff6ff',
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600 }}>
                        {user.displayName || user.id}
                      </div>
                      <div style={{ fontSize: '0.85rem', color: '#2563eb' }}>
                        neu vorgemerkt
                      </div>
                    </div>

                    <IconButton
                      onClick={() => removeSelectedNewPollAdmin(user.id)}
                      disabled={pollAdminLoading}
                      title="Vorgemerkten Co-Autor entfernen"
                      icon={<Trash2 size={18} />}
                      size={36}
                    />
                  </div>
                ))}
              </div>
            )}

            {selectedNewPollAdmins.length > 0 ? (
              <>
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '0.6rem',
                    marginTop: '0.9rem',
                    fontSize: '0.92rem',
                    lineHeight: 1.4,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={pollAdminConfirm}
                    onChange={(e) => setPollAdminConfirm(e.target.checked)}
                    style={{ marginTop: '0.15rem' }}
                  />
                  <span>
                    Ich bestätige, dass die vorgemerkten Bandmitglieder Co-Autor-Rechte erhalten sollen.
                  </span>
                </label>

                <div
                  style={{
                    marginTop: '0.85rem',
                    display: 'flex',
                    justifyContent: 'flex-end',
                  }}
                >
                  <IconButton
                    onClick={() => void handleGrantSelectedPollAdmins()}
                    disabled={!pollAdminConfirm || pollAdminLoading}
                    title="Co-Autoren speichern"
                    icon={<Check size={18} />}
                    variant="primary"
                    size={40}
                  />
                </div>
              </>
            ) : null}

            {pollAdminError ? (
              <div style={{ marginTop: '0.75rem', color: '#b91c1c', fontSize: '0.9rem' }}>
                {pollAdminError}
              </div>
            ) : null}
          </div>

          <div
            style={{
              marginTop: '1rem',
              display: 'flex',
              justifyContent: 'flex-end',
              gap: '0.5rem',
            }}
          >
            <IconButton
              onClick={closeAuthorDialog}
              disabled={transferLoading || pollAdminLoading}
              title="Schließen"
              icon={<X size={18} />}
              size={40}
            />

         

          </div>
        </div>
      </div>
    ) : null}

    {showCalendarDialog ? (
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
        onClick={closeCalendarDialog}
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
              gap: '0.75rem',
              marginBottom: '0.75rem',
            }}
          >
            <div style={{ fontSize: '1.05rem', fontWeight: 700 }}>
              Kalendereinträge erzeugen
            </div>

            
          </div>

          <div
            style={{
              display: 'grid',
              gap: '0.85rem',
            }}
          >
            <label style={{ display: 'grid', gap: '0.35rem' }}>
              <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>Kalender</span>
              <select
                value={selectedCalendarUri}
                onChange={(e) => setSelectedCalendarUri(e.target.value)}
                disabled={calendarLoading || calendarSaving}
                style={{
                  width: '100%',
                  padding: '0.7rem 0.8rem',
                  border: '1px solid #d1d5db',
                  borderRadius: '0.65rem',
                  font: 'inherit',
                  boxSizing: 'border-box',
                  background: '#ffffff',
                }}
              >
                {writableCalendars.map((calendar) => (
                  <option key={calendar.uri} value={calendar.uri}>
                    {calendar.displayName}
                  </option>
                ))}
              </select>
            </label>

            <label style={{ display: 'grid', gap: '0.35rem' }}>
              <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>Titel</span>
              <input
                type="text"
                value={calendarTitle}
                onChange={(e) => setCalendarTitle(e.target.value)}
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
                value={calendarDescription}
                onChange={(e) => setCalendarDescription(e.target.value)}
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

            <label style={{ display: 'grid', gap: '0.35rem' }}>
              <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>Ort</span>
              <input
                type="text"
                value={calendarLocation}
                onChange={(e) => setCalendarLocation(e.target.value)}
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
                checked={calendarAllDay}
                onChange={(e) => setCalendarAllDay(e.target.checked)}
              />
              <span>Ganztägiger Termin</span>
            </label>

            {!calendarAllDay ? (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: '0.75rem',
                }}
              >
                <label style={{ display: 'grid', gap: '0.35rem' }}>
                  <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>Startzeit</span>
                  <input
                    type="time"
                    value={calendarStartTime}
                    onChange={(e) => setCalendarStartTime(e.target.value)}
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
                  <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>Endzeit</span>
                  <input
                    type="time"
                    value={calendarEndTime}
                    onChange={(e) => setCalendarEndTime(e.target.value)}
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
              </div>
            ) : null}

            <div style={{ display: 'grid', gap: '0.45rem' }}>
              <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>Optionen</div>

              <div
                style={{
                  border: '1px solid #e5e7eb',
                  borderRadius: '0.75rem',
                  maxHeight: '14rem',
                  overflowY: 'auto',
                  background: '#ffffff',
                }}
              >
                {poll.options.map((option) => {
                  const selection = calendarOptionSelections[option.id] ?? {
                    selected: false,
                    entryStatus: 'inquiry' as const,
                  }

                  return (
                    <div
                      key={option.id}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'auto 1fr auto',
                        gap: '0.75rem',
                        alignItems: 'start',
                        padding: '0.75rem 0.85rem',
                        borderBottom: '1px solid #f1f5f9',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selection.selected}
                        onChange={() => toggleCalendarOptionSelected(option.id)}
                        style={{ marginTop: '0.25rem' }}
                      />

                      <div>
                        <div style={{ fontWeight: 600 }}>{formatOptionDate(option)}</div>
                        <div style={{ fontSize: '0.85rem', color: '#6b7280' }}>
                          {option.label}
                        </div>
                      </div>

                      <select
                        value={selection.entryStatus}
                        disabled={!selection.selected}
                        onChange={(e) =>
                          setCalendarOptionStatus(
                            option.id,
                            e.target.value as 'inquiry' | 'fixed' | 'canceled',
                          )
                        }
                        style={{
                          minWidth: '7.5rem',
                          padding: '0.45rem 0.55rem',
                          border: '1px solid #d1d5db',
                          borderRadius: '0.55rem',
                          font: 'inherit',
                          background: selection.selected ? '#ffffff' : '#f3f4f6',
                          color: selection.selected ? '#111827' : '#9ca3af',
                        }}
                      >
                        <option value="inquiry">ANFRAGE</option>
                        <option value="fixed">FIX</option>
                        <option value="canceled">CANCELED</option>
                      </select>
                    </div>
                  )
                })}
              </div>
            </div>

            {calendarError ? (
              <div style={{ color: '#b91c1c', fontSize: '0.9rem' }}>{calendarError}</div>
            ) : null}

            {calendarSuccess ? (
              <div style={{ color: '#166534', fontSize: '0.9rem' }}>{calendarSuccess}</div>
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
                onClick={closeCalendarDialog}
                disabled={calendarSaving}
                title="Abbrechen"
                icon={<X size={18} />}
                size={40}
              />

              <IconButton
                onClick={handleCreateCalendarEntries}
                disabled={
                  calendarSaving ||
                  calendarLoading ||
                  !selectedCalendarUri ||
                  Object.values(calendarOptionSelections).filter((item) => item.selected).length === 0
                }
                title="Kalendereinträge erzeugen"
                icon={<Check size={18} />}
                variant="primary"
                size={40}
              />              

            </div>
          </div>
        </div>
      </div>
    ) : null}

  </main>
)
}