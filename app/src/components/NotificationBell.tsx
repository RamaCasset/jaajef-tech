import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from './Icon'
import { NotificationItems } from './NotificationItems'
import { fr } from '../i18n/fr'
import { unreadNotificationCount } from '../lib/api'
import { useNotifications } from '../lib/useNotifications'

const SHOWN = 8

/** The bell in the top bar: a click opens the latest notices right under it, like a mailbox preview. */
export function NotificationBell() {
  const [open, setOpen] = useState(false)
  const [count, setCount] = useState(0)
  const box = useRef<HTMLDivElement>(null)
  const feed = useNotifications(SHOWN, open)

  // The little number is a convenience: if it cannot be loaded, the bell simply shows without it.
  const unreadInList = feed.items ? feed.unread : -1
  useEffect(() => {
    let alive = true
    Promise.resolve().then(() => unreadNotificationCount()).then((n) => { if (alive) setCount(Number(n) || 0) }).catch(() => undefined)
    return () => { alive = false }
  }, [unreadInList])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  const label = count > 0 ? `${fr.nav.notifications} (${count})` : fr.nav.notifications
  return (
    <div className="bell-box" ref={box}>
      <button type="button" className="bell" aria-label={label} aria-haspopup="true" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Icon name="bell" />
        {count > 0 && <span className="bell-count">{count}</span>}
      </button>
      {open && (
        <div className="bell-pop" role="region" aria-label={fr.notifications.title}>
          <div className="bell-pop-head">
            <strong>{fr.notifications.title}</strong>
            <span className="bell-pop-tools">
              {feed.unread > 0 && <button type="button" className="linklike tiny" onClick={() => void feed.readAll()}>{fr.notifications.markAll}</button>}
              {feed.items && feed.items.length > 0 && <button type="button" className="linklike tiny" onClick={() => void feed.clearAll()}>{fr.notifications.clearAll}</button>}
            </span>
          </div>
          {feed.error && <div className="alert" role="alert">{feed.error}</div>}
          {feed.failed && <p className="muted tiny">{fr.notifications.loadFailed} <button type="button" className="linklike" onClick={feed.load}>{fr.notifications.retry}</button></p>}
          {!feed.failed && !feed.items && <p className="muted tiny">{fr.common.loading}</p>}
          {feed.items && feed.items.length === 0 && <p className="muted tiny">{fr.notifications.empty}</p>}
          {feed.items && feed.items.length > 0 && (
            <NotificationItems items={feed.items} answered={feed.answered} onOpen={(n) => void feed.open(n)} onAnswer={(n, i, a) => void feed.answer(n, i, a)} onRemove={(n) => void feed.remove(n)} onNavigate={() => setOpen(false)} />
          )}
          <p className="bell-pop-foot"><Link to="/notifications" onClick={() => setOpen(false)}>{fr.notifications.viewAll}</Link></p>
        </div>
      )}
    </div>
  )
}
