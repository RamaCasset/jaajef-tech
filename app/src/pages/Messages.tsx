import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { fr } from '../i18n/fr'
import { listMyChatInbox, listMyConversations, type ChatInboxRow, type Conversation } from '../lib/api'
import { timeAgo } from '../lib/time'

type Tab = 'private' | 'communities' | 'projects'
const initials = (name: string) => name.trim().slice(0, 2).toUpperCase()

/** The chat inbox: private conversations, communities and project rooms, each with its last message. */
export function Messages() {
  const t = fr.messages
  const [tab, setTab] = useState<Tab>('private')
  const [privates, setPrivates] = useState<Conversation[] | null>(null)
  const [rooms, setRooms] = useState<ChatInboxRow[] | null>(null)
  const [failed, setFailed] = useState(false)

  const load = useCallback(() => {
    setFailed(false)
    listMyConversations().then(setPrivates).catch(() => setFailed(true))
    // The rooms are a bonus next to the private messages: if they fail, that tab simply stays empty.
    listMyChatInbox().then(setRooms).catch(() => setRooms([]))
  }, [])
  useEffect(load, [load])

  const communities = (rooms ?? []).filter((r) => !r.project_id)
  const projects = (rooms ?? []).filter((r) => !!r.project_id)
  const unreadOf = (list: { unread_count: number }[]) => list.reduce((n, r) => n + Number(r.unread_count), 0)
  const tabs: { key: Tab; label: string; unread: number }[] = [
    { key: 'private', label: t.tabPrivate, unread: unreadOf(privates ?? []) },
    { key: 'communities', label: t.tabCommunities, unread: unreadOf(communities) },
    { key: 'projects', label: t.tabProjects, unread: unreadOf(projects) },
  ]

  function roomRows(list: ChatInboxRow[], empty: string) {
    if (!rooms) return <p className="muted">{fr.common.loading}</p>
    if (list.length === 0) {
      return (
        <div className="panel panel-pad">
          <p className="muted">{empty}</p>
          {tab === 'communities' && <Link className="btn" to="/communautes">{t.browseCommunities}</Link>}
        </div>
      )
    }
    return (
      <section className="panel inbox-list">
        {list.map((r) => (
          <article key={r.community_id} className="inbox-row">
            <span className="inbox-avatar" aria-hidden="true">{initials(r.name)}</span>
            <div className="inbox-body">
              <h3 className="inbox-name"><Link className="inbox-stretch" to={`/communautes/${r.slug}`}>{r.name}</Link></h3>
              <p className="muted tiny inbox-preview">
                {r.last_message_preview ? (r.last_author_name ? t.authorSaid(r.last_author_name, r.last_message_preview) : r.last_message_preview) : t.noMessagesYet}
              </p>
            </div>
            <div className="inbox-meta">
              <span className="muted tiny">{timeAgo(r.last_message_at)}</span>
              {Number(r.unread_count) > 0 && <span className="count-pill">{Number(r.unread_count)}</span>}
            </div>
          </article>
        ))}
      </section>
    )
  }

  return (
    <AppShell>
      <main className="page notices-page">
        <header className="page-head">
          <h1 className="page-title">{t.title}</h1>
          <p className="muted">{t.subtitle}</p>
        </header>
        <div className="inbox-tabs" role="tablist">
          {tabs.map((x) => (
            <button key={x.key} type="button" role="tab" aria-selected={tab === x.key} className="chip" aria-pressed={tab === x.key} onClick={() => setTab(x.key)}>
              {x.label}{x.unread > 0 && <span className="inbox-tab-count"> {x.unread}</span>}
            </button>
          ))}
        </div>
        {failed && (
          <div className="alert" role="alert">
            {t.loadFailed} <button type="button" className="btn" onClick={load}>{t.retry}</button>
          </div>
        )}
        {tab === 'private' && (
          <>
            {!failed && !privates && <p className="muted">{fr.common.loading}</p>}
            {privates && privates.length === 0 && <p className="muted">{t.empty}</p>}
            {privates && privates.length > 0 && (
              <section className="panel inbox-list">
                {privates.map((c) => {
                  const name = c.other_display_name || c.other_username
                  return (
                    <article key={c.conversation_id} className="inbox-row">
                      <span className="inbox-avatar" aria-hidden="true">{initials(name)}</span>
                      <div className="inbox-body">
                        <h3 className="inbox-name"><Link className="inbox-stretch" to={`/messages/${c.conversation_id}`}>{name}</Link></h3>
                        <p className="muted tiny inbox-preview">{c.last_message_preview ?? t.noPreview}</p>
                      </div>
                      <div className="inbox-meta">
                        <span className="muted tiny">{timeAgo(c.last_message_at)}</span>
                        {Number(c.unread_count) > 0 && <span className="count-pill">{t.unread(Number(c.unread_count))}</span>}
                      </div>
                    </article>
                  )
                })}
              </section>
            )}
          </>
        )}
        {tab === 'communities' && roomRows(communities, t.emptyCommunities)}
        {tab === 'projects' && roomRows(projects, t.emptyProjects)}
      </main>
    </AppShell>
  )
}
