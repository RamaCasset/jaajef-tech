import { useEffect, useState, type ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { Logo } from './Logo'
import { fr } from '../i18n/fr'
import { unreadNotificationCount } from '../lib/api'

const SOON: string[] = []

export function AppShell({ children }: { children: ReactNode }) {
  const { member, signOut } = useAuth()
  const [unread, setUnread] = useState(0)
  useEffect(() => {
    let alive = true
    // The little number is a convenience: if it cannot be loaded, the link simply shows without it.
    Promise.resolve().then(() => unreadNotificationCount()).then((n) => { if (alive) setUnread(Number(n) || 0) }).catch(() => undefined)
    return () => { alive = false }
  }, [])
  const initial = (member?.profile.display_name ?? '?').slice(0, 1).toUpperCase()
  return (
    <div className="shell">
      <header className="topbar">
        <NavLink to="/cite" aria-label={fr.appName}><Logo size={20} /></NavLink>
        <nav aria-label="Navigation principale" className="topnav">
          <NavLink to="/cite" end>{fr.nav.city}</NavLink>
          <NavLink to="/quetes">{fr.nav.quests}</NavLink>
          <NavLink to="/projets">{fr.nav.projects}</NavLink>
          <NavLink to="/souk">{fr.nav.souk}</NavLink>
          <NavLink to="/blog">{fr.nav.blog}</NavLink>
          <NavLink to="/jobs">{fr.nav.jobs}</NavLink>
          <NavLink to="/notifications" aria-label={unread > 0 ? `${fr.nav.notifications} (${unread})` : fr.nav.notifications}>
            {fr.nav.notifications}{unread > 0 && <span className="kopeks-pill" style={{ marginLeft: 6 }}>{unread}</span>}
          </NavLink>
          {SOON.map((label) => (
            <span key={label} className="topnav-soon" aria-disabled="true" title={fr.nav.soon}>{label}</span>
          ))}
        </nav>
        <div className="topbar-right">
          <span className="kopeks-pill" aria-label={fr.nav.kopeks}>{member?.kopeks ?? 0} {fr.nav.kopeks}</span>
          <NavLink to="/parametres" className="topnav-link">{fr.nav.settings}</NavLink>
          <button type="button" className="avatar-btn" onClick={() => void signOut()} title={fr.home.signOut} aria-label={fr.home.signOut}>{initial}</button>
        </div>
      </header>
      <div className="shell-body">{children}</div>
    </div>
  )
}
