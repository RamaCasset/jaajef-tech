import { dateLocale } from '../i18n/lang'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { ReportButton } from '../components/ReportButton'
import { useAuth } from '../auth/AuthContext'
import { fr } from '../i18n/fr'
import { friendlyError } from '../lib/errors'
import {
  decideJoinRequest, deleteCommunity, deleteMessage, getCommunityBySlug, leaveCommunity, listChannelMessages, listChannels,
  listCommunityMembers, listPendingJoinRequests, removeCommunityMember, sendMessage, setMemberRole, transferCommunity,
  type Channel, type ChatMessage, type Community as CommunityData, type CommunityMember, type JoinRequest,
} from '../lib/api'

const REFRESH_MS = 15000
const QUESTIONS_ROOM = 'questions'

export function Community() {
  const { slug = '' } = useParams()
  const { member } = useAuth()
  const me = member?.profile.id ?? ''
  const navigate = useNavigate()

  const [community, setCommunity] = useState<CommunityData | null | undefined>(undefined)
  const [channels, setChannels] = useState<Channel[]>([])
  const [members, setMembers] = useState<CommunityMember[]>([])
  const [requests, setRequests] = useState<JoinRequest[]>([])
  const [channelId, setChannelId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[] | null>(null)
  const [body, setBody] = useState('')
  const [failed, setFailed] = useState(false)
  const [peopleLoaded, setPeopleLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [giveTo, setGiveTo] = useState<string | null>(null)
  const [confirmSlug, setConfirmSlug] = useState('')

  const myRole = members.find((m) => m.user_id === me)?.role ?? null
  const isOwner = myRole === 'owner'
  const canModerate = myRole === 'owner' || myRole === 'moderator'
  const channel = channels.find((c) => c.id === channelId) ?? null
  const showQuestions = channelId === QUESTIONS_ROOM
  const canWrite = !!channel && (channel.kind !== 'announcement' || canModerate)

  const loadAll = useCallback(() => {
    setFailed(false)
    setCommunity(undefined)
    setPeopleLoaded(false)
    getCommunityBySlug(slug)
      .then(async (c) => {
        setCommunity(c)
        if (!c) return
        const [ch, mem] = await Promise.all([listChannels(c.id), listCommunityMembers(c.id)])
        setChannels(ch)
        setMembers(mem)
        setPeopleLoaded(true)
        setChannelId((cur) => cur ?? ch[0]?.id ?? null)
        const role = mem.find((m) => m.user_id === me)?.role
        if (role === 'owner' || role === 'moderator') listPendingJoinRequests(c.id).then(setRequests).catch(() => undefined)
      })
      .catch(() => setFailed(true))
  }, [slug, me])
  useEffect(loadAll, [loadAll])

  const loadMessages = useCallback(() => {
    if (!channelId || channelId === QUESTIONS_ROOM) return
    listChannelMessages(channelId).then(setMessages).catch(() => undefined)
  }, [channelId])
  useEffect(() => {
    setMessages(null)
    loadMessages()
    if (!channelId) return
    const timer = setInterval(loadMessages, REFRESH_MS)
    return () => clearInterval(timer)
  }, [channelId, loadMessages])

  async function run(fn: () => Promise<unknown>, after?: () => void) {
    setError(null)
    setBusy(true)
    try {
      await fn()
      after?.()
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  async function onSend(e: FormEvent) {
    e.preventDefault()
    if (!channelId || !body.trim()) return
    await run(() => sendMessage(channelId, body), () => { setBody(''); loadMessages() })
  }

  const reloadPeople = () => {
    if (!community) return
    listCommunityMembers(community.id).then(setMembers).catch(() => undefined)
    listPendingJoinRequests(community.id).then(setRequests).catch(() => undefined)
  }

  return (
    <AppShell>
      <main className="page souk">
        <p><Link to="/communautes">← {fr.community.back}</Link></p>
        {failed && (
          <div className="alert" role="alert">
            {fr.community.loadFailed} <button type="button" className="btn" onClick={loadAll}>{fr.community.retry}</button>
          </div>
        )}
        {!failed && community === undefined && <p className="muted">{fr.common.loading}</p>}
        {community === null && <p className="muted">{fr.community.notFound}</p>}

        {community && peopleLoaded && !myRole && <p className="muted">{fr.community.notMember}</p>}

        {community && myRole && (
          <>
            {error && <div className="alert" role="alert">{error}</div>}

            <div className="chat-layout">
              <aside className="panel chat-side">
                <div className="chat-community">
                  <h1>{community.name}</h1>
                  {community.description && <p className="muted tiny">{community.description}</p>}
                  <p className="tiny muted">{fr.communities.members(members.length)}</p>
                </div>
                <h2 className="eyebrow">{fr.community.channels}</h2>
                <div role="tablist" aria-orientation="vertical" className="chat-channels">
                  {channels.map((c) => (
                    <button key={c.id} type="button" role="tab" aria-selected={c.id === channelId} className={`chat-channel ${c.id === channelId ? 'chat-channel-on' : ''}`} onClick={() => setChannelId(c.id)}>
                      # {c.name}
                    </button>
                  ))}
                  <button type="button" role="tab" aria-selected={showQuestions} className={`chat-channel ${showQuestions ? 'chat-channel-on' : ''}`} onClick={() => setChannelId(QUESTIONS_ROOM)}>
                    <span className="chat-hash"><Icon name="question" size={14} /></span> {fr.qa.room}
                  </button>
                </div>
              </aside>

              {showQuestions ? (
                <section className="chat-main" aria-label={fr.qa.room}>
                  <CommunityQuestions communityId={community.id} communitySlug={community.slug} />
                </section>
              ) : (

              <section className="panel chat-main" aria-label={channel ? `# ${channel.name}` : fr.community.channels}>
                <header className="chat-head">
                  <strong>{channel ? `# ${channel.name}` : ''}</strong>
                  <button type="button" className="btn" onClick={loadMessages}>{fr.community.refresh}</button>
                </header>

                <div className="chat-messages">
                  {messages === null && <p className="muted">{fr.common.loading}</p>}
                  {messages && messages.length === 0 && <p className="muted">{fr.community.noMessages}</p>}
                  <ul className="chat-list">
                    {(messages ?? []).map((m) => (
                      <li key={m.id} className="chat-msg">
                        <span className="mini-avatar" aria-hidden="true">{(m.author_name || m.author_username).slice(0, 1).toUpperCase()}</span>
                        <div className="chat-body">
                          <div className="tiny muted">
                            <Link to={`/profil/${m.author_username}`}>{m.author_name || m.author_username}</Link>
                            {' · '}{new Date(m.created_at).toLocaleString(dateLocale(), { dateStyle: 'short', timeStyle: 'short' })}
                          </div>
                          {m.deleted_at ? <em className="muted">{fr.community.deleted}</em> : <p>{m.body}</p>}
                          <div className="chat-actions">
                            {!m.deleted_at && m.author_id !== me && <ReportButton type="message" id={m.id} />}
                            {!m.deleted_at && (m.author_id === me || canModerate) && (
                              <button type="button" className="btn" disabled={busy} onClick={() => void run(() => deleteMessage(m.id), loadMessages)}>{fr.community.deleteMessage}</button>
                            )}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>

                {canWrite ? (
                  <form onSubmit={onSend} noValidate className="chat-compose">
                    <label htmlFor="body" className="sr-only">{fr.community.messageLabel}</label>
                    <textarea id="body" rows={2} maxLength={4000} placeholder={fr.community.messageLabel} value={body} onChange={(e) => setBody(e.target.value)} />
                    <button className="btn btn-cta" type="submit" disabled={busy || !body.trim()}>{fr.community.send}</button>
                  </form>
                ) : (
                  channel && <p className="muted chat-compose">{fr.community.announcementOnly}</p>
                )}
              </section>
              )}
            </div>

            {canModerate && (
              <section className="panel panel-pad" style={{ marginBottom: 24 }}>
                <h2>{fr.community.requestsTitle}</h2>
                {requests.length === 0 && <p className="muted">{fr.community.requestsEmpty}</p>}
                {requests.map((r) => (
                  <div key={r.id} style={{ padding: '6px 0' }}>
                    <Link to={`/profil/${r.username}`}>@{r.username}</Link>{r.message ? ` — ${r.message}` : ''}{' '}
                    <button type="button" className="btn" disabled={busy} onClick={() => void run(() => decideJoinRequest(r.id, true), reloadPeople)}>{fr.community.approve}</button>{' '}
                    <button type="button" className="btn" disabled={busy} onClick={() => void run(() => decideJoinRequest(r.id, false), reloadPeople)}>{fr.community.decline}</button>
                  </div>
                ))}
              </section>
            )}

            <section className="panel panel-pad" style={{ marginBottom: 24 }}>
              <h2>{fr.community.membersTitle}</h2>
              {members.map((m) => (
                <div key={m.user_id} style={{ padding: '6px 0' }}>
                  <Link to={`/profil/${m.username}`}>{m.display_name || m.username}</Link> · <span className="muted">{fr.communities.roles[m.role]}</span>
                  {m.user_id !== me && m.role !== 'owner' && canModerate && !(myRole === 'moderator' && m.role === 'moderator') && (
                    <> <button type="button" className="btn" disabled={busy} aria-label={`${fr.community.remove} : ${m.username}`} onClick={() => void run(() => removeCommunityMember(community.id, m.user_id), reloadPeople)}>{fr.community.remove}</button></>
                  )}
                  {isOwner && m.user_id !== me && (
                    <>
                      {' '}<button type="button" className="btn" disabled={busy} aria-label={`${m.role === 'moderator' ? fr.community.makeMember : fr.community.makeModerator} : ${m.username}`}
                        onClick={() => void run(() => setMemberRole(community.id, m.user_id, m.role === 'moderator' ? 'member' : 'moderator'), reloadPeople)}>
                        {m.role === 'moderator' ? fr.community.makeMember : fr.community.makeModerator}
                      </button>
                      {' '}<button type="button" className="btn" disabled={busy} aria-label={`${fr.community.giveOwnership} : ${m.username}`} onClick={() => setGiveTo(m.user_id)}>{fr.community.giveOwnership}</button>
                    </>
                  )}
                  {giveTo === m.user_id && (
                    <p role="alert" className="alert">
                      {fr.community.giveConfirm(m.display_name || m.username)}{' '}
                      <button type="button" className="btn btn-cta" disabled={busy} onClick={() => void run(() => transferCommunity(community.id, m.user_id), () => { setGiveTo(null); loadAll() })}>{fr.community.giveYes}</button>
                    </p>
                  )}
                </div>
              ))}
            </section>

            {!isOwner && (
              <button type="button" className="btn" disabled={busy} onClick={() => void run(() => leaveCommunity(community.id), () => navigate('/communautes'))}>{fr.community.leave}</button>
            )}

            {isOwner && (
              <section className="panel panel-pad">
                <h2>{fr.community.dangerTitle}</h2>
                <p className="muted">{fr.community.dangerText} <strong>{community.slug}</strong></p>
                <div className="field">
                  <label htmlFor="confirm-slug">{community.slug}</label>
                  <input id="confirm-slug" value={confirmSlug} onChange={(e) => setConfirmSlug(e.target.value)} />
                </div>
                <button type="button" className="btn" disabled={busy || confirmSlug !== community.slug} onClick={() => void run(() => deleteCommunity(community.id, confirmSlug), () => navigate('/communautes'))}>{fr.community.dangerButton}</button>
              </section>
            )}
          </>
        )}
      </main>
    </AppShell>
  )
}
