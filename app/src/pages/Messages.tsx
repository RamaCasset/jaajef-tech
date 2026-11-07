import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { fr } from '../i18n/fr'
import { listMyConversations, type Conversation } from '../lib/api'

export function Messages() {
  const [items, setItems] = useState<Conversation[] | null>(null)
  const [failed, setFailed] = useState(false)

  const load = useCallback(() => {
    setFailed(false)
    listMyConversations().then(setItems).catch(() => setFailed(true))
  }, [])
  useEffect(load, [load])

  return (
    <AppShell>
      <main className="page souk">
        <header className="page-head">
          <h1 className="page-title">{fr.messages.title}</h1>
          <p className="muted">{fr.messages.subtitle}</p>
        </header>
        {failed && (
          <div className="alert" role="alert">
            {fr.messages.loadFailed} <button type="button" className="btn" onClick={load}>{fr.messages.retry}</button>
          </div>
        )}
        {!failed && !items && <p className="muted">{fr.common.loading}</p>}
        {items && items.length === 0 && <p className="muted">{fr.messages.empty}</p>}
        {items && items.length > 0 && (
          <section className="panel">
            {items.map((c) => (
              <article key={c.conversation_id} style={{ padding: '10px 0', borderTop: '1px solid var(--line)' }}>
                <h3 style={{ margin: 0 }}>
                  <Link to={`/messages/${c.conversation_id}`}>{c.other_display_name || c.other_username}</Link>
                  {c.unread_count > 0 && <span className="tag" style={{ marginLeft: 8 }}>{fr.messages.unread(Number(c.unread_count))}</span>}
                </h3>
                <p className="muted tiny">{c.last_message_preview ?? fr.messages.noPreview}</p>
              </article>
            ))}
          </section>
        )}
      </main>
    </AppShell>
  )
}
