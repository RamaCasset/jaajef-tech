import { useEffect, useState, type ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { Logo } from './Logo'
import { fr } from '../i18n/fr'
import { getMyStaffAccess } from '../lib/api'

const SOON: string[] = []

export function AppShell({ children }: { children: ReactNode }) {
  const { member, signOut } = useAuth()
  const [isStaff, setIsStaff] = useState(false)
  const myId = member?.profile.id
  useEffect(() => {
    let alive = true
    // The staff link is a convenience: if it cannot be checked, the link simply does not show.
    Promise.resolve().then(() => getMyStaffAccess(myId ?? '')).then((a) => { if (alive) setIsStaff(a.role !== null || a.shopManager || a.questWriter) }).catch(() => undefined)
    return () => { alive = false }
  }, [myId])
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
          <NavLink to="/jobs">{fr.nav.jobs}</NavLink>
          {isStaff && <NavLink to="/equipe">{fr.staff.navLink}</NavLink>}
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
