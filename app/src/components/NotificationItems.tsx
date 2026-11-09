import { Link } from 'react-router-dom'
import { Icon } from './Icon'
import { fr } from '../i18n/fr'
import type { NotificationRow } from '../lib/api'
import { groupByDay, noticeLink, noticeText, noticeTitle, tileOf, whenLabel } from '../lib/notificationMeta'

const SECTION = { today: 'sectionToday', yesterday: 'sectionYesterday', week: 'sectionWeek', older: 'sectionOlder' } as const

/** The notices as a mailbox: grouped by day, each with an icon, a title, what happened, when, and what can be done about it. */
export function NotificationItems({ items, answered, onOpen, onAnswer, onRemove, onNavigate, wide = false }: {
  items: NotificationRow[]
  answered: Record<string, boolean | null>
  onOpen: (n: NotificationRow) => void
  onAnswer: (n: NotificationRow, invite: string, accept: boolean) => void
  onRemove: (n: NotificationRow) => void
  onNavigate?: () => void
  /** The full page: the time goes on the right of the title. */
  wide?: boolean
}) {
  return (
    <div className={`notice-groups ${wide ? 'notice-groups-wide' : ''}`}>
      {groupByDay(items).map((g) => (
        <section key={g.bucket} aria-label={fr.notifications[SECTION[g.bucket]]}>
          <h3 className="notice-section">{fr.notifications[SECTION[g.bucket]]}</h3>
          <ul className="notice-list">
            {g.items.map((n) => {
              const who = typeof n.data.actor_username === 'string' ? n.data.actor_username : null
              const invite = n.kind === 'collab_invite' && typeof n.data.invite_id === 'string' ? n.data.invite_id : null
              const tile = tileOf(n.kind)
              return (
                <li key={n.id} data-unread={n.read_at ? 'false' : 'true'} className="notice-item">
                  <span className={`notice-tile notice-tile-${tile.tone}`} aria-hidden="true">{tile.icon ? <Icon name={tile.icon} size={18} /> : tile.text}</span>
                  <div className="notice-content">
                    <button type="button" className="notice-text" onClick={() => onOpen(n)}>
                      <strong className="notice-title">{noticeTitle(n)}</strong>
                      <span className="notice-sentence">{noticeText(n)}</span>
                    </button>
                    {invite && (
                      <div className="notice-actions">
                        {invite in answered ? (
                          <span className="muted tiny">{answered[invite] === null ? fr.notifications.inviteClosed : answered[invite] ? fr.notifications.inviteAccepted : fr.notifications.inviteDeclined}</span>
                        ) : (
                          <>
                            <button type="button" className="btn btn-cta" onClick={() => onAnswer(n, invite, true)}>{fr.notifications.inviteAccept}</button>
                            <button type="button" className="btn" onClick={() => onAnswer(n, invite, false)}>{fr.notifications.inviteDecline}</button>
                          </>
                        )}
                      </div>
                    )}
                    {noticeLink(n) && <div className="tiny"><Link to={noticeLink(n)!} onClick={onNavigate}>{fr.notifications.see}</Link></div>}
                    {n.kind.startsWith('proposal_') && typeof n.data.project_id === 'string' && <div className="tiny"><Link to={`/projets/${n.data.project_id}/propositions`} onClick={onNavigate}>{fr.notifications.seeProposals}</Link></div>}
                    {who && <div className="tiny"><Link to={`/profil/${who}`} onClick={onNavigate}>@{who}</Link></div>}
                    <div className="notice-meta">
                      <span className="muted tiny notice-when">{whenLabel(n.created_at)}</span>
                      <button type="button" className="linklike tiny" onClick={() => onRemove(n)} aria-label={`${fr.notifications.remove} : ${noticeText(n)}`}>{fr.notifications.remove}</button>
                    </div>
                  </div>
                  {!n.read_at && <span className="notice-dot" role="img" aria-label={fr.notifications.unread} />}
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}
