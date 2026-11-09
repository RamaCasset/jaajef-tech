import { useMemo, useState } from 'react'
import { AppShell } from '../components/AppShell'
import { Icon } from '../components/Icon'
import { NoticeFilters } from '../components/NoticeFilters'
import { NotificationItems } from '../components/NotificationItems'
import { NotificationRhythm } from '../components/NotificationRhythm'
import { fr } from '../i18n/fr'
import { bucketOf, matchesFilter, noticeText, noticeTitle, type NoticeFilter } from '../lib/notificationMeta'
import { useNotifications } from '../lib/useNotifications'

/** The inbox: every notice, like a mailbox. Choosing what to receive is in the settings. */
export function Notifications() {
  const { items, failed, error, answered, unread, load, open, readAll, remove, clearAll, answer } = useNotifications(50)
  const t = fr.notifications
  const [filter, setFilter] = useState<NoticeFilter>('all')
  const [query, setQuery] = useState('')
  const [newestFirst, setNewestFirst] = useState(true)

  const shown = useMemo(() => {
    if (!items) return null
    const q = query.trim().toLowerCase()
    const list = items.filter((n) => matchesFilter(n, filter) && (!q || `${noticeTitle(n)} ${noticeText(n)}`.toLowerCase().includes(q)))
    return newestFirst ? list : [...list].reverse()
  }, [items, filter, query, newestFirst])
  const today = items ? items.filter((n) => bucketOf(n.created_at) === 'today').length : 0
  const week = items ? items.filter((n) => ['today', 'yesterday', 'week'].includes(bucketOf(n.created_at))).length : 0

  return (
    <AppShell>
      <main className="page notices-page">
        <header className="page-head-row">
          <div>
            <p className="eyebrow">{t.eyebrow}</p>
            <h1 className="page-title">{t.title} {unread > 0 && <span className="count-pill">{t.unreadPill(unread)}</span>}</h1>
            <p className="muted">{t.pageSubtitle}</p>
          </div>
          <div className="notice-head-actions">
            {unread > 0 && <button className="btn" type="button" onClick={() => void readAll()}>{t.markAll}</button>}
            {items && items.length > 0 && <button className="btn" type="button" onClick={() => void clearAll()}>{t.clearAll}</button>}
          </div>
        </header>

        {error && <div className="alert" role="alert">{error}</div>}

        <div className="notice-search-row">
          <label className="notice-search">
            <Icon name="search" size={16} />
            <input type="search" placeholder={t.searchPlaceholder} aria-label={t.searchPlaceholder} value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <button type="button" className="btn" onClick={() => setNewestFirst((v) => !v)}>{newestFirst ? t.newest : t.oldest}</button>
        </div>
        <NoticeFilters value={filter} onChange={setFilter} unread={unread} full />

        <div className="notices-layout">
          <div>
            {failed && (
              <div className="panel panel-pad">
                <p className="muted">{t.loadFailed}</p>
                <button className="btn" type="button" onClick={load}>{t.retry}</button>
              </div>
            )}
            {!failed && !items && <p className="muted">{fr.common.loading}</p>}
            {shown && (
              <section className="panel notices-panel">
                {items && items.length === 0 && <p className="muted notice-empty">{t.empty}</p>}
                {items && items.length > 0 && shown.length === 0 && <p className="muted notice-empty">{t.noMatch}</p>}
                <NotificationItems wide items={shown} answered={answered} onOpen={(n) => void open(n)} onAnswer={(n, i, a) => void answer(n, i, a)} onRemove={(n) => void remove(n)} />
                {items && items.length > 0 && <p className="muted tiny notice-foot">{unread === 0 ? t.upToDate(items.length) : t.unreadPill(unread)}</p>}
              </section>
            )}
          </div>
          <aside className="notices-side">
            <section className="panel side-card" aria-label={t.activity}>
              <h2 className="side-title">{t.activity}</h2>
              <dl className="activity">
                <div><dt>{t.activityUnread}</dt><dd>{unread}</dd></div>
                <div><dt>{t.activityToday}</dt><dd>{today}</dd></div>
                <div><dt>{t.activityWeek}</dt><dd>{week}</dd></div>
              </dl>
            </section>
            <NotificationRhythm />
            <div className="quiet"><strong>{t.quietTitle}</strong><p className="muted tiny">{t.quietText}</p></div>
          </aside>
        </div>
      </main>
    </AppShell>
  )
}
