import { Link } from 'react-router-dom'
import { dateLocale } from '../i18n/lang'
import { fr } from '../i18n/fr'
import type { NotificationRow } from '../lib/api'

function sentence(n: NotificationRow): string {
  const make = fr.notifications.text[n.kind]
  return make ? make(n.data as Record<string, string>) : n.kind
}

/** One notice per line, like a mailbox: what happened, who did it, when, and what can be done about it. */
export function NotificationItems({ items, answered, onOpen, onAnswer, onNavigate }: {
  items: NotificationRow[]
  answered: Record<string, boolean | null>
  onOpen: (n: NotificationRow) => void
  onAnswer: (n: NotificationRow, invite: string, accept: boolean) => void
  onNavigate?: () => void
}) {
  return (
    <ul className="notice-list">
      {items.map((n) => {
        const who = typeof n.data.actor_username === 'string' ? n.data.actor_username : null
        const invite = n.kind === 'collab_invite' && typeof n.data.invite_id === 'string' ? n.data.invite_id : null
        return (
          <li key={n.id} data-unread={n.read_at ? 'false' : 'true'} className="notice-item">
            <div className="notice-main">
            <button type="button" className="notice-text" onClick={() => onOpen(n)}>
              {!n.read_at && <span className="tag">{fr.notifications.unread}</span>}{' '}
              <span>{sentence(n)}</span>
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
            </div>
            {n.kind.startsWith('proposal_') && typeof n.data.project_id === 'string' && <div className="tiny"><Link to={`/projets/${n.data.project_id}/propositions`} onClick={onNavigate}>{fr.notifications.seeProposals}</Link></div>}
            {who && <div className="tiny"><Link to={`/profil/${who}`} onClick={onNavigate}>@{who}</Link></div>}
            <div className="muted tiny">{new Date(n.created_at).toLocaleString(dateLocale(), { dateStyle: 'medium', timeStyle: 'short' })}</div>
          </li>
        )
      })}
    </ul>
  )
}
