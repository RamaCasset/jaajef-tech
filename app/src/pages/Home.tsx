import { useAuth } from '../auth/AuthContext'
import { Link } from 'react-router-dom'
import { Logo } from '../components/Logo'
import { fr } from '../i18n/fr'

export function Home() {
  const { member, signOut } = useAuth()
  const p = member?.profile
  return (
    <main className="center-page">
      <section className="panel auth-card" style={{ width: 'min(100%, 520px)' }}>
        <Logo />
        <h1 style={{ marginTop: 24 }}>{fr.home.welcome}{p ? `, ${p.display_name}` : ''}</h1>
        {p?.clan && p.mastery && (
          <p style={{ margin: '12px 0' }}>
            <span className="tag">{fr.clans[p.clan].name}</span>{' '}
            <span className="muted">{fr.masteries[p.mastery].name}</span>
          </p>
        )}
        <dl className="stats">
          <div><dt>{fr.clan.xp}</dt><dd>{p?.xp ?? 0}</dd></div>
          <div><dt>{fr.clan.kopeks}</dt><dd>{member?.kopeks ?? 0}</dd></div>
          <div><dt>@</dt><dd style={{ fontSize: 14 }}>{p?.username}</dd></div>
        </dl>
        <p style={{ margin: '20px 0 8px' }}><Link to="/projets">{fr.nav.projects} →</Link></p>
        <p className="muted" style={{ margin: '0 0 20px' }}>{fr.home.soon}</p>
        <button className="btn" type="button" onClick={() => void signOut()}>{fr.home.signOut}</button>
      </section>
    </main>
  )
}
