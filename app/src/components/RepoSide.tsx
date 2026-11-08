import { useEffect, useState } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { Icon } from './Icon'
import { useAuth } from '../auth/AuthContext'
import { dateLocale } from '../i18n/lang'
import { fr } from '../i18n/fr'
import { countMyStars, getNextBadge, loadProfile, type NextBadge, type ProfileData } from '../lib/api'

/** The left column of the personal space: profile card, menu, and the next badge. Each part loads on its own. */
export function RepoSide({ repoCount }: { repoCount: number | null }) {
  const t = fr.myRepos
  const { member } = useAuth()
  const username = member?.profile.username
  const myId = member?.profile.id
  const [data, setData] = useState<ProfileData | null>(null)
  const [stars, setStars] = useState<number | null>(null)
  const [badge, setBadge] = useState<NextBadge | null>(null)

  useEffect(() => {
    if (!username || !myId) return
    let alive = true
    loadProfile(username, myId).then((d) => { if (alive) setData(d) }).catch(() => undefined)
    countMyStars(myId).then((n) => { if (alive) setStars(n) }).catch(() => undefined)
    getNextBadge(myId).then((b) => { if (alive) setBadge(b) }).catch(() => undefined)
    return () => { alive = false }
  }, [username, myId])

  const p = data?.profile
  const level = p && data ? 1 + Math.floor(p.xp / data.xpPerLevel) : null
  const since = p ? new Date(p.created_at).toLocaleDateString(dateLocale(), { month: 'long', year: 'numeric' }) : ''

  return (
    <aside className="repo-side">
      <Link className="repo-back" to={username ? `/profil/${username}` : '/cite'}><Icon name="back" size={16} /> {t.back}</Link>
      {p ? (
        <section className="panel repo-card" aria-label={p.display_name}>
          <div className="repo-cover" style={p.banner_url ? { backgroundImage: `url(${p.banner_url})` } : undefined} aria-hidden="true" />
          <div className="repo-card-body">
            <div className="repo-avatar-row">
              <div className="profile-avatar repo-avatar" aria-hidden="true">
                {p.avatar_url ? <img src={p.avatar_url} alt="" /> : p.display_name.slice(0, 1).toUpperCase()}
              </div>
              {level !== null ? <span className="mono repo-level">{t.level(level)}</span> : null}
            </div>
            <h2 className="repo-name">{p.display_name}{p.is_verified ? <span className="tag" style={{ marginLeft: 8 }}>{fr.profile.verified}</span> : null}</h2>
            <p className="mono profile-handle">@{p.username}</p>
            {p.headline ? <p className="repo-headline">{p.headline}</p> : null}
            {p.mastery ? <p><span className="mastery-chip">{fr.masteries[p.mastery].name}</span></p> : null}
            {p.bio ? <p className="muted">{p.bio}</p> : null}
            {p.location ? <p className="muted tiny">{p.location}</p> : null}
            <p className="muted tiny">{fr.profile.since(since)}</p>
            {p.github_username ? <p className="tiny"><a href={`https://github.com/${p.github_username}`} target="_blank" rel="noreferrer">github.com/{p.github_username}</a></p> : null}
          </div>
        </section>
      ) : null}
      <nav className="panel repo-menu" aria-label={t.menuLabel}>
        <NavLink to={username ? `/profil/${username}` : '/cite'} end><Icon name="user" size={18} /> <span>{t.nav.overview}</span></NavLink>
        <NavLink to="/depots" end><Icon name="repo" size={18} /> <span>{t.nav.repos}</span>{repoCount !== null ? <span className="count">{repoCount}</span> : null}</NavLink>
        <NavLink to="/depots/etoiles"><Icon name="star" size={18} /> <span>{t.nav.stars}</span>{stars !== null ? <span className="count">{stars}</span> : null}</NavLink>
        <NavLink to="/parametres/profil"><Icon name="sliders" size={18} /> <span>{t.nav.settings}</span></NavLink>
      </nav>
      {badge ? (
        <section className="panel repo-badge" aria-label={t.nextBadge}>
          <h3><Icon name="arena" size={18} /> {badge.name}</h3>
          <p className="muted tiny">{t.badgeProgress(badge.progress, badge.threshold, Math.max(badge.threshold - badge.progress, 0))}</p>
          <div className="xp-track" role="progressbar" aria-valuemin={0} aria-valuemax={badge.threshold} aria-valuenow={badge.progress} aria-label={badge.name}>
            <div className="xp-fill" style={{ width: `${Math.min(100, Math.round((badge.progress / badge.threshold) * 100))}%` }} />
          </div>
        </section>
      ) : null}
    </aside>
  )
}
