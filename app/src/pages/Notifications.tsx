import { dateLocale } from '../i18n/lang'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { fr } from '../i18n/fr'
import { friendlyError } from '../lib/errors'
import {
  answerCollabInvite, listMutedKinds, listNotifications, markAllNotificationsRead, markNotificationRead, setNotificationMute,
  type NotificationKind, type NotificationRow,
} from '../lib/api'

const KINDS = Object.keys(fr.notifications.kinds) as NotificationKind[]
const LOCKED: NotificationKind[] = ['warning', 'suspension', 'project_hidden']

function sentence(n: NotificationRow): string {
  const make = fr.notifications.text[n.kind]
  return make ? make(n.data as Record<string, string>) : n.kind
}

export function Notifications() {
  const [items, setItems] = useState<NotificationRow[] | null>(null)
  const [muted, setMuted] = useState<NotificationKind[]>([])
  const [failed, setFailed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [answered, setAnswered] = useState<Record<string, boolean>>({})

  const load = useCallback(() => {
    setFailed(false)
    listNotifications().then(setItems).catch(() => setFailed(true))
    listMutedKinds().then(setMuted).catch(() => undefined)
  }, [])
  useEffect(load, [load])

  async function open(n: NotificationRow) {
    if (n.read_at) return
    setItems((cur) => cur && cur.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)))
    try { await markNotificationRead(n.id) } catch { load() }
  }

  async function readAll() {
    setItems((cur) => cur && cur.map((x) => ({ ...x, read_at: x.read_at ?? new Date().toISOString() })))
    try { await markAllNotificationsRead() } catch { load() }
  }

  async function answer(n: NotificationRow, invite: string, accept: boolean) {
    setError(null)
    try {
      await answerCollabInvite(invite, accept)
      setAnswered((a) => ({ ...a, [invite]: accept }))
      void open(n)
    } catch (err) {
      setError(friendlyError(err))
    }
  }

  async function toggle(kind: NotificationKind, receive: boolean) {
    setError(null)
    const before = muted
    setMuted(receive ? muted.filter((k) => k !== kind) : [...muted, kind])
    try {
      await setNotificationMute(kind, !receive)
    } catch {
      setMuted(before)
      setError(fr.notifications.muteFailed)
    }
  }

  const unread = items ? items.filter((n) => !n.read_at).length : 0

  return (
    <AppShell>
      <main className="page souk">
        <header className="page-head">
          <h1 className="page-title">{fr.notifications.title}</h1>
          <p className="muted">{fr.notifications.subtitle}</p>
        </header>

        {error && <div className="alert" role="alert">{error}</div>}

        {failed && (
          <div className="panel panel-pad">
            <p className="muted">{fr.notifications.loadFailed}</p>
            <button className="btn" type="button" onClick={load}>{fr.notifications.retry}</button>
          </div>
        )}
        {!failed && !items && <p className="muted">{fr.common.loading}</p>}

        {items && (
          <section className="panel panel-pad" style={{ marginBottom: 24 }}>
            {unread > 0 && (
              <button className="btn" type="button" onClick={() => void readAll()} style={{ marginBottom: 12 }}>{fr.notifications.markAll}</button>
            )}
            {items.length === 0 && <p className="muted">{fr.notifications.empty}</p>}
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {items.map((n) => {
                const who = typeof n.data.actor_username === 'string' ? n.data.actor_username : null
                return (
                  <li key={n.id} data-unread={n.read_at ? 'false' : 'true'} style={{ padding: '10px 0', borderTop: '1px solid var(--line)' }}>
                    <button type="button" className="linklike" onClick={() => void open(n)} style={{ textAlign: 'left', width: '100%', background: 'none', border: 0, color: 'inherit', cursor: 'pointer' }}>
                      {!n.read_at && <span className="tag">{fr.notifications.unread}</span>}{' '}
                      <span>{sentence(n)}</span>
                    </button>
                    {n.kind === 'collab_invite' && typeof n.data.invite_id === 'string' && (
                      <div className="notice-actions">
                        {n.data.invite_id in answered ? (
                          <span className="muted tiny">{answered[n.data.invite_id] ? fr.notifications.inviteAccepted : fr.notifications.inviteDeclined}</span>
                        ) : (
                          <>
                            <button type="button" className="btn btn-cta" onClick={() => void answer(n, String(n.data.invite_id), true)}>{fr.notifications.inviteAccept}</button>
                            <button type="button" className="btn" onClick={() => void answer(n, String(n.data.invite_id), false)}>{fr.notifications.inviteDecline}</button>
                          </>
                        )}
                      </div>
                    )}
                    {n.kind.startsWith('proposal_') && typeof n.data.project_id === 'string' && <div className="tiny"><Link to={`/projets/${n.data.project_id}/propositions`}>{fr.notifications.seeProposals}</Link></div>}
                    {who && <div className="tiny"><Link to={`/profil/${who}`}>@{who}</Link></div>}
                    <div className="muted tiny">{new Date(n.created_at).toLocaleString(dateLocale(), { dateStyle: 'medium', timeStyle: 'short' })}</div>
                  </li>
                )
              })}
            </ul>
          </section>
        )}

        <section className="panel panel-pad">
          <h2>{fr.notifications.settingsTitle}</h2>
          <p className="muted tiny">{fr.notifications.settingsHint}</p>
          {KINDS.map((k) => {
            const locked = LOCKED.includes(k)
            return (
              <label key={k} style={{ display: 'block', padding: '4px 0' }}>
                <input
                  type="checkbox"
                  checked={locked || !muted.includes(k)}
                  disabled={locked}
                  onChange={(e) => void toggle(k, e.target.checked)}
                />{' '}
                {fr.notifications.kinds[k]}{locked ? ` (${fr.notifications.locked})` : ''}
              </label>
            )
          })}
        </section>
      </main>
    </AppShell>
  )
}
