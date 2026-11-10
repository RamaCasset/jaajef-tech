import { useEffect, useState, type ReactNode } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { Logo } from './Logo'
import { Icon } from './Icon'
import { LanguageSwitch } from './LanguageSwitch'
import { NotificationBell } from './NotificationBell'
import { fr } from '../i18n/fr'
import { initialsOf } from '../lib/initials'
import { getMyStaffAccess, listMyChatInbox, listMyCommunities, listMyConversations } from '../lib/api'

const rail = (): { to: string; icon: string; label: string }[] => [
  { to: '/blog', icon: 'blog', label: fr.nav.blog },
  { to: '/questions', icon: 'question', label: fr.nav.questions },
  { to: '/quetes', icon: 'quest', label: fr.nav.quests },
  { to: '/souk', icon: 'souk', label: fr.nav.souk },
  { to: '/jobs', icon: 'jobs', label: fr.nav.jobs },
]

// The left bar and the numbers are kept between pages, so they do not blink out and back in at every page change.
type Space = { id: string; slug: string; name: string; project_id?: string | null }
type Memo = { id?: string; spaces: Space[]; staff: boolean; unread: number }
let memo: Memo = { spaces: [], staff: false, unread: 0 }
const memoFor = (id?: string): Memo => (memo.id === id ? memo : (memo = { id, spaces: [], staff: false, unread: 0 }))

export function AppShell({ children }: { children: ReactNode }) {
  const { member, signOut } = useAuth()
    const navigate = useNavigate()
  const myId = member?.profile.id
  const [isStaff, setIsStaffState] = useState(() => memoFor(myId).staff)
  const setIsStaff = (v: boolean) => { memoFor(myId).staff = v; setIsStaffState(v) }
  const { pathname } = useLocation()
  const [chatUnread, setChatUnreadState] = useState(() => memoFor(myId).unread)
  const setChatUnread = (n: number) => { memoFor(myId).unread = n; setChatUnreadState(n) }
  // The left bar is opened or closed with the 3-bar button; the choice is remembered on this device.
  const [railOpen, setRailOpen] = useState(() => {
    try { return localStorage.getItem('jaajef.rail') === 'open' } catch { return false }
  })
  const toggleRail = () => {
    const next = !railOpen
    setRailOpen(next)
    try { localStorage.setItem('jaajef.rail', next ? 'open' : 'closed') } catch { /* the choice is just not remembered */ }
  }
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
  const [spaces, setSpacesState] = useState(() => memoFor(myId).spaces)
  const setSpaces = (l: Memo['spaces']) => { memoFor(myId).spaces = l; setSpacesState(l) }
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
    Promise.resolve().then(() => listMyCommunities(myId)).then((l) => { if (alive && Array.isArray(l)) setSpaces(l.slice(0, 12).map((c) => ({ id: c.id, slug: c.slug, name: c.name, project_id: c.project_id ?? null }))) }).catch(() => undefined)
    return () => { alive = false }
  }, [myId])
  const groups = [
    { key: 'communities', title: fr.nav.myCommunities, items: spaces.filter((c) => !c.project_id) },
    { key: 'rooms', title: fr.nav.myRooms, items: spaces.filter((c) => !!c.project_id) },
  ].filter((g) => g.items.length > 0)
  const initial = (member?.profile.display_name ?? '?').slice(0, 1).toUpperCase()
  const username = member?.profile.username
  return (
    <div className="shell">
      <header className="topbar">
        <button type="button" className="topbar-menu" aria-expanded={railOpen} aria-label={railOpen ? fr.nav.railClose : fr.nav.railOpen} title={railOpen ? fr.nav.railClose : fr.nav.railOpen} onClick={toggleRail}>
          <Icon name="menu" size={24} />
        </button>
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
      <div className={`shell-frame ${railOpen ? 'rail-open' : ''}`}>
        <nav aria-label={fr.nav.railLabel} className={`rail ${railOpen ? 'rail-wide' : ''}`}>
          <NavLink to="/communautes" end className="rail-item rail-explore" title={fr.nav.communities} aria-label={fr.nav.communities}>
            <span className="rail-ico"><Icon name="compass" size={26} /></span>
            <span className="rail-label">{fr.nav.communities}</span>
          </NavLink>
          {groups.map((g) => (
            <div key={g.key} className="rail-group" role="group" aria-label={g.title}>
              <p className="rail-group-title" aria-hidden="true">{g.title}</p>
              {g.items.map((c, i) => (
                <NavLink key={c.id} to={`/communautes/${c.slug}`} className={`rail-item rail-space ${i === 0 && g.key === 'communities' ? 'rail-space-first' : `rail-space-${(i % 2) + 1}`}`} title={c.name} aria-label={c.name}>
                  <span className="rail-ico rail-letters">{initialsOf(c.name)}</span>
                  <span className="rail-label">{c.name}</span>
                </NavLink>
              ))}
            </div>
          ))}
          <hr className="rail-sep" />
          {rail().map((r) => (
            <NavLink key={r.to} to={r.to} className="rail-item rail-link" title={r.label} aria-label={r.label}>
              <span className="rail-ico"><Icon name={r.icon} size={26} /></span>
              <span className="rail-label">{r.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="shell-body">{children}</div>
      </div>
    </div>
  )
}
