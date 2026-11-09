import { useEffect, useState, type ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { Logo } from './Logo'
import { Icon } from './Icon'
import { LanguageSwitch } from './LanguageSwitch'
import { NotificationBell } from './NotificationBell'
import { fr } from '../i18n/fr'
import { getMyStaffAccess } from '../lib/api'

const rail = (): { to: string; icon: string; label: string }[] => [
  { to: '/communautes', icon: 'communities', label: fr.nav.communities },
  { to: '/blog', icon: 'blog', label: fr.nav.blog },
  { to: '/quetes', icon: 'quest', label: fr.nav.quests },
  { to: '/souk', icon: 'souk', label: fr.nav.souk },
  { to: '/jobs', icon: 'jobs', label: fr.nav.jobs },
]

export function AppShell({ children }: { children: ReactNode }) {
  const { member, signOut } = useAuth()
  const [isStaff, setIsStaff] = useState(false)
  const myId = member?.profile.id
  useEffect(() => {
    let alive = true
    // The staff link is a convenience: if it cannot be checked, the link simply does not show.
    Promise.resolve().then(() => getMyStaffAccess(myId ?? '')).then((a) => { if (alive) setIsStaff(a.role !== null || a.shopManager || a.shopOwner || a.questWriter) }).catch(() => undefined)
    return () => { alive = false }
  }, [myId])
  const initial = (member?.profile.display_name ?? '?').slice(0, 1).toUpperCase()
  const username = member?.profile.username
  return (
    <div className="shell">
      <header className="topbar">
        <NavLink to="/projets" aria-label={fr.appName}><Logo size={20} /></NavLink>
        <nav aria-label={fr.nav.main} className="topnav">
          <NavLink to="/projets">{fr.nav.city}</NavLink>
          <NavLink to="/quetes">{fr.nav.quests}</NavLink>
          <NavLink to="/souk">{fr.nav.souk}</NavLink>
        </nav>
        <NavLink to="/recherche" className="topsearch" aria-label={fr.nav.search}>
          <Icon name="search" size={16} />
          <span>{fr.nav.searchHint}</span>
        </NavLink>
        <div className="topbar-right">
          <NavLink to="/messages" className="bell" aria-label={fr.nav.messages}>
            <Icon name="messages" />
          </NavLink>
          <NotificationBell />
          <span className="kopeks-pill" aria-label={fr.nav.kopeks}>{member?.kopeks ?? 0} {fr.nav.kopeks}</span>
          <details className="account-menu">
            <summary className="avatar-btn" aria-label={fr.nav.account}>{member?.profile.avatar_url ? <img src={member.profile.avatar_url} alt="" /> : initial}</summary>
            <div className="account-pop">
              {username && <NavLink to="/cite">{fr.nav.profile}</NavLink>}
              <NavLink to="/depots">{fr.myRepos.title}</NavLink>
              <NavLink to="/arene">{fr.nav.arena}</NavLink>
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
          {rail().map((r) => (
            <NavLink key={r.to} to={r.to} className="rail-link" title={r.label}>
              <Icon name={r.icon} />
              <span>{r.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="shell-body">{children}</div>
      </div>
    </div>
  )
}
