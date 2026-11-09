import { Link } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { NotificationItems } from '../components/NotificationItems'
import { fr } from '../i18n/fr'
import { useNotifications } from '../lib/useNotifications'

/** The inbox: every notice, like a mailbox. Choosing what to receive is in the settings. */
export function Notifications() {
  const { items, failed, error, answered, unread, load, open, readAll, answer } = useNotifications(50)

  return (
    <AppShell>
      <main className="page souk">
        <header className="page-head">
          <h1 className="page-title">{fr.notifications.title}</h1>
          <p className="muted">{fr.notifications.subtitle}</p>
          <p className="tiny"><Link to="/parametres#notifications">{fr.notifications.chooseInSettings}</Link></p>
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
          <section className="panel panel-pad">
            {unread > 0 && (
              <button className="btn" type="button" onClick={() => void readAll()} style={{ marginBottom: 12 }}>{fr.notifications.markAll}</button>
            )}
            {items.length === 0 && <p className="muted">{fr.notifications.empty}</p>}
            <NotificationItems items={items} answered={answered} onOpen={(n) => void open(n)} onAnswer={(n, i, a) => void answer(n, i, a)} />
          </section>
        )}
      </main>
    </AppShell>
  )
}
