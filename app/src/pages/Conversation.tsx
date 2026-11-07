import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { useAuth } from '../auth/AuthContext'
import { fr } from '../i18n/fr'
import { friendlyError } from '../lib/errors'
import {
  blockUser, deleteDirectMessage, isBlockedByMe, listDirectMessages, listMyConversations, markConversationRead, sendDirectMessage, unblockUser,
  type Conversation as ConversationRow, type DirectMessage,
} from '../lib/api'

const REFRESH_MS = 15000

export function Conversation() {
  const { id = '' } = useParams()
  const { member } = useAuth()
  const me = member?.profile.id ?? ''
  const [other, setOther] = useState<ConversationRow | null | undefined>(undefined)
  const [messages, setMessages] = useState<DirectMessage[] | null>(null)
  const [blocked, setBlocked] = useState(false)
  const [body, setBody] = useState('')
  const [failed, setFailed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const loadMessages = useCallback(() => {
    listDirectMessages(id).then((m) => {
      setMessages(m)
      markConversationRead(id).catch(() => undefined)
    }).catch(() => setFailed(true))
  }, [id])

  const loadAll = useCallback(() => {
    setFailed(false)
    setOther(undefined)
    listMyConversations()
      .then((all) => {
        const c = all.find((x) => x.conversation_id === id) ?? null
        setOther(c)
        if (c) isBlockedByMe(c.other_user_id).then(setBlocked).catch(() => undefined)
      })
      .catch(() => setFailed(true))
    loadMessages()
  }, [id, loadMessages])
  useEffect(loadAll, [loadAll])
  useEffect(() => {
    const timer = setInterval(loadMessages, REFRESH_MS)
    return () => clearInterval(timer)
  }, [loadMessages])

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
    if (!body.trim()) return
    await run(() => sendDirectMessage(id, body), () => { setBody(''); loadMessages() })
  }

  const name = other ? other.other_display_name || other.other_username : ''

  return (
    <AppShell>
      <main className="page souk">
        <p><Link to="/messages">← {fr.messages.back}</Link></p>
        {failed && (
          <div className="alert" role="alert">
            {fr.messages.loadFailed} <button type="button" className="btn" onClick={loadAll}>{fr.messages.retry}</button>
          </div>
        )}
        {!failed && other === undefined && <p className="muted">{fr.common.loading}</p>}
        {other === null && <p className="muted">{fr.messages.notFound}</p>}

        {other && (
          <section className="panel">
            <h1 className="page-title">{fr.messages.thread(name)}</h1>
            <p className="tiny"><Link to={`/profil/${other.other_username}`}>@{other.other_username}</Link></p>
            {error && <div className="alert" role="alert">{error}</div>}
            {blocked && <div className="notice" role="status">{fr.messages.blocked}</div>}

            <button type="button" className="btn" onClick={loadMessages}>{fr.messages.refresh}</button>
            {messages === null && <p className="muted">{fr.common.loading}</p>}
            {messages && messages.length === 0 && <p className="muted">{fr.messages.threadEmpty}</p>}
            <ul style={{ listStyle: 'none', padding: 0 }}>
              {(messages ?? []).map((m) => {
                const mine = m.sender_id === me
                return (
                  <li key={m.id} data-mine={mine ? 'true' : 'false'} style={{ padding: '8px 0', borderTop: '1px solid var(--line)' }}>
                    <div className="tiny muted">
                      {mine ? fr.messages.youLabel : name} · {new Date(m.created_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}
                    </div>
                    {m.deleted_at ? <em className="muted">{fr.messages.deleted}</em> : (
                      <>
                        {m.body && <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{m.body}</p>}
                        {m.file_name && <p className="muted tiny" style={{ margin: 0 }}>{fr.messages.fileSent(m.file_name)}</p>}
                      </>
                    )}
                    {mine && !m.deleted_at && (
                      <button type="button" className="btn" disabled={busy} onClick={() => void run(() => deleteDirectMessage(m.id), loadMessages)}>{fr.messages.deleteMessage}</button>
                    )}
                  </li>
                )
              })}
            </ul>

            <form onSubmit={onSend} noValidate>
              <div className="field">
                <label htmlFor="dm-body">{fr.messages.label}</label>
                <textarea id="dm-body" rows={3} maxLength={4000} value={body} onChange={(e) => setBody(e.target.value)} />
              </div>
              <button className="btn btn-cta" type="submit" disabled={busy || !body.trim()}>{fr.messages.send}</button>
            </form>

            <p style={{ marginTop: 24 }}>
              {blocked ? (
                <button type="button" className="btn" disabled={busy} onClick={() => void run(() => unblockUser(other.other_user_id), () => setBlocked(false))}>{fr.messages.unblock}</button>
              ) : (
                <button type="button" className="btn" disabled={busy} onClick={() => void run(() => blockUser(other.other_user_id), () => setBlocked(true))}>{fr.messages.block}</button>
              )}
            </p>
          </section>
        )}
      </main>
    </AppShell>
  )
}
