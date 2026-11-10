import { useEffect, useState, type ReactNode } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { Logo } from './Logo'
import { Icon } from './Icon'
import { LanguageSwitch } from './LanguageSwitch'
import { NotificationBell } from './NotificationBell'
import { fr } from '../i18n/fr'
import { getMyStaffAccess, listMyChatInbox, listMyCommunities, listMyConversations } from '../lib/api'

const rail = (): { to: string; icon: string; label: string }[] => [
  { to: '/blog', icon: 'blog', label: fr.nav.blog },
  { to: '/questions', icon: 'question', label: fr.nav.questions },
  { to: '/quetes', icon: 'quest', label: fr.nav.quests },
  { to: '/souk', icon: 'souk', label: fr.nav.souk },
  { to: '/jobs', icon: 'jobs', label: fr.nav.jobs },
]

export function AppShell({ children }: { children: ReactNode }) {
  const { member, signOut } = useAuth()
  const [isStaff, setIsStaff] = useState(false)
  const navigate = useNavigate()
  const myId = member?.profile.id
  const { pathname } = useLocation()
  const [chatUnread, setChatUnread] = useState(0)
  // The number on the chat button: unread private messages plus unread community and project messages.
  // It is checked again on every page change and once a minute; if it cannot be read, no number shows.
  useEffect(() => {
    if (!myId) return
    let alive = true
    const sum = (rows: { unread_count: number }[] | null | undefined) => (rows ?? []).reduce((n, r) => n + (Number(r.unread_count) || 0), 0)
    const check = () => {
      const part = (f: () => Promise<{ unread_count: number }[]>) => Promise.resolve().then(f).then(sum).catch(() => 0)
      Promise.all([part(() => listMyConversations()), part(() => listMyChatInbox())]).then(([a, b]) => { if (alive) setChatUnread(a + b) })
    }
    check()
    const timer = setInterval(check, 60000)
    return () => { alive = false; clearInterval(timer) }
  }, [myId, pathname])
  const [spaces, setSpaces] = useState<{ id: string; slug: string; name: string }[]>([])
  useEffect(() => {
    let alive = true
    // The staff link is a convenience: if it cannot be checked, the link simply does not show.
    Promise.resolve().then(() => getMyStaffAccess(myId ?? '')).then((a) => { if (alive) setIsStaff(a.role !== null || a.shopManager || a.shopOwner || a.questWriter) }).catch(() => undefined)
    return () => { alive = false }
  }, [myId])
  // Ctrl+K (or Cmd+K) opens the search, as the hint in the search box says.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); navigate('/recherche') }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate])
  // The communities of the member, shown in the side rail. If they cannot be loaded, the rail simply has none.
  useEffect(() => {
    if (!myId) return
    let alive = true
    Promise.resolve().then(() => listMyCommunities(myId)).then((l) => { if (alive && Array.isArray(l)) setSpaces(l.slice(0, 6)) }).catch(() => undefined)
    return () => { alive = false }
  }, [myId])
  const initial = (member?.profile.display_name ?? '?').slice(0, 1).toUpperCase()
  const username = member?.profile.username
  return (
    <div className="shell">
      <header className="topbar">
        <NavLink to="/projets" aria-label={fr.appName}><Logo size={20} /></NavLink>
        <nav aria-label={fr.nav.main} className="topnav">
          <NavLink to="/projets" end>{fr.nav.city}</NavLink>
          <NavLink to="/depots">{fr.nav.projects}</NavLink>
          <NavLink to="/quetes">{fr.nav.quests}</NavLink>
          <NavLink to="/souk">{fr.nav.souk}</NavLink>
        </nav>
        <NavLink to="/recherche" className="topsearch" aria-label={fr.nav.search}>
          <Icon name="search" size={16} />
          <span>{fr.nav.searchHint}</span>
          <kbd className="kbd-hint" aria-hidden="true">{typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘ K' : 'Ctrl K'}</kbd>
        </NavLink>
        <div className="topbar-right">
          <NavLink to="/messages" className="bell" aria-label={chatUnread > 0 ? fr.nav.messagesUnread(chatUnread) : fr.nav.messages}>
            <Icon name="messages" />
            {chatUnread > 0 && <span className="bell-count" aria-hidden="true">{chatUnread > 99 ? '99+' : chatUnread}</span>}
          </NavLink>
          <NotificationBell />
          <span className="kopeks-pill" aria-label={fr.nav.kopeks}>{member?.kopeks ?? 0} {fr.nav.kopeks}</span>
          <details className="account-menu">
            <summary className="avatar-btn" aria-label={fr.nav.account}>{member?.profile.avatar_url ? <img src={member.profile.avatar_url} alt="" /> : initial}</summary>
            <div className="account-pop">
              {username && <NavLink to="/cite">{fr.nav.profile}</NavLink>}
              <NavLink to="/parametres">{fr.nav.settings}</NavLink>
              <NavLink to="/guide">{fr.nav.guide}</NavLink>
              {isStaff && <NavLink to="/equipe">{fr.staff.navLink}</NavLink>}
              <LanguageSwitch className="lang-in-menu" />
              <button type="button" onClick={() => void signOut()}>{fr.home.signOut}</button>
            </div>
          </details>
        </div>
      </header>
      <div className="shell-frame">
        <nav aria-label={fr.nav.railLabel} className="rail">
          {spaces.map((c, i) => (
            <NavLink key={c.id} to={`/communautes/${c.slug}`} className={`rail-space ${i === 0 ? 'rail-space-first' : `rail-space-${(i % 2) + 1}`}`} title={c.name} aria-label={c.name}>
              {c.name.split(/\s+/).slice(0, 2).map((w) => w.slice(0, 1)).join('').toUpperCase()}
            </NavLink>
          ))}
          <NavLink to="/communautes" end className="rail-explore" title={fr.nav.communities} aria-label={fr.nav.communities}><Icon name="compass" size={26} /></NavLink>
          <hr className="rail-sep" />
          {rail().map((r) => (
            <NavLink key={r.to} to={r.to} className="rail-link" title={r.label}>
              <Icon name={r.icon} size={26} />
              <span>{r.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="shell-body">{children}</div>
      </div>
    </div>
  )
}
