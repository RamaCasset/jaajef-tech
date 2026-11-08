import { dateLocale } from '../i18n/lang'
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { Icon } from '../components/Icon'
import { ReportButton } from '../components/ReportButton'
import { BuildBadge, ClanTag } from '../components/ProjectCard'
import { useAuth } from '../auth/AuthContext'
import { loadProfile, startConversation, type ProfileData } from '../lib/api'
import { friendlyError } from '../lib/errors'
import { fr } from '../i18n/fr'

export function Profile() {
  const { username = '' } = useParams()
  const { session } = useAuth()
  const viewerId = session?.user.id ?? ''
  const [data, setData] = useState<ProfileData | null | undefined>(undefined)
  const [failed, setFailed] = useState(false)

  const load = useCallback(() => {
    let alive = true
    setData(undefined)
    setFailed(false)
    loadProfile(username, viewerId).then((d) => { if (alive) setData(d) }).catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [username, viewerId])

  useEffect(() => load(), [load])

  return (
    <AppShell>
      <main className="page profile">
        {failed ? (
          <div className="alert" role="alert">
            {fr.profile.error} <button type="button" className="btn" onClick={() => load()}>{fr.profile.retry}</button>
          </div>
        ) : data === undefined ? (
          <p className="muted">{fr.common.loading}</p>
        ) : data === null ? (
          <p role="status">{fr.profile.notFound}</p>
        ) : (
          <ProfileView data={data} viewerId={viewerId} />
        )}
      </main>
    </AppShell>
  )
}

function ProfileView({ data, viewerId }: { data: ProfileData; viewerId: string }) {
  const navigate = useNavigate()
  const [writeError, setWriteError] = useState<string | null>(null)
  async function write() {
    setWriteError(null)
    try {
      navigate(`/messages/${await startConversation(data.profile.id)}`)
    } catch (err) {
      setWriteError(friendlyError(err))
    }
  }
  const { profile: p, xpPerLevel, badges, projects, questsSolved } = data
  const level = 1 + Math.floor(p.xp / xpPerLevel)
  const inLevel = p.xp % xpPerLevel
  const since = new Date(p.created_at).toLocaleDateString(dateLocale(), { month: 'long', year: 'numeric' })
  return (
    <>
      <section className="panel profile-card">
        <div className="profile-banner" style={p.banner_url ? { backgroundImage: `url(${p.banner_url})` } : undefined} aria-hidden="true" />
        <div className="profile-head">
          <div className="profile-side">
            <div className="profile-avatar" aria-hidden="true">
              {p.avatar_url ? <img src={p.avatar_url} alt="" /> : p.display_name.slice(0, 1).toUpperCase()}
            </div>
            {p.mastery ? <span className="mastery-chip">{fr.masteries[p.mastery].name}</span> : null}
          </div>
          <div className="profile-main">
            <h1 className="page-title">{p.display_name}{p.is_verified ? <span className="tag" style={{ marginLeft: 8 }}>{fr.profile.verified}</span> : null}</h1>
            <p className="mono profile-handle">@{p.username}</p>
            <p><ClanTag clan={p.clan} /></p>
            {p.bio ? <p>{p.bio}</p> : null}
            <p className="muted tiny">
              {[p.location, fr.profile.since(since)].filter(Boolean).join(' · ')}
              {p.github_username ? <> · <a href={`https://github.com/${p.github_username}`} target="_blank" rel="noreferrer">github.com/{p.github_username}</a></> : null}
            </p>
          </div>
          <div className="profile-actions">
            {p.id === viewerId && <Link className="btn btn-cta" to="/parametres/profil">{fr.editProfile.edit}</Link>}
            {p.id !== viewerId && <button type="button" className="btn btn-cta" onClick={() => void write()}>{fr.messages.write}</button>}
            {p.id !== viewerId && <ReportButton type="member" id={p.id} />}
            {writeError && <span role="alert" className="alert">{writeError}</span>}
            {p.available_to_collab ? <span className="build build-passing">{fr.profile.available}</span> : null}
          </div>
        </div>
        <div className="profile-xp">
          <span className="mono">{fr.profile.level(level, inLevel, xpPerLevel)}</span>
          <div className="xp-track" role="progressbar" aria-valuemin={0} aria-valuemax={xpPerLevel} aria-valuenow={inLevel} aria-label={fr.profile.level(level, inLevel, xpPerLevel)}>
            <div className="xp-fill" style={{ width: `${Math.round((inLevel / xpPerLevel) * 100)}%` }} />
          </div>
          <span className="muted tiny">{fr.profile.toNext(xpPerLevel - inLevel, level + 1)}</span>
        </div>
      </section>

      <dl className="profile-stats">
        {questsSolved !== null ? <div className="panel panel-pad"><span className="stat-icon"><Icon name="quest" size={28} /></span><div><dd>{questsSolved}</dd><dt>{fr.profile.stats.quests}</dt></div></div> : null}
        <div className="panel panel-pad"><span className="stat-icon"><Icon name="repo" size={28} /></span><div><dd>{projects.length}</dd><dt>{fr.profile.stats.projects}</dt></div></div>
      </dl>

      <div className="profile-cols">
        <section aria-labelledby="pp">
          <h2 id="pp">{fr.profile.projects}</h2>
          {projects.length === 0 ? <p className="muted">{fr.profile.noProjects}</p> : projects.map((pr) => (
            <article key={pr.id} className="panel project-card">
              <h3><a href={`https://github.com/${pr.github_owner}/${pr.github_repo}`} target="_blank" rel="noreferrer">{pr.github_owner} / {pr.github_repo}</a></h3>
              <p className="muted project-summary">{pr.summary ?? pr.title}</p>
              <div className="project-tags">
                {pr.language ? <span className="tag">{pr.language}</span> : null}
                <span className="muted tiny">★ {pr.github_stars}</span>
                <BuildBadge status={pr.build_status} />
              </div>
            </article>
          ))}
        </section>
        <section aria-labelledby="pb">
          <h2 id="pb">{fr.profile.badges}</h2>
          <p className="muted tiny">{fr.profile.unlocked(badges.length)}</p>
          {badges.length === 0 ? <p className="muted">{fr.profile.noBadges}</p> : (
            <ul className="badge-grid">
              {badges.map((b) => (
                <li key={b.slug} className={`panel badge badge-${b.tier}`}>
                  <span className="badge-icon" aria-hidden="true"><Icon name="arena" size={26} /></span>
                  <strong>{b.name}</strong>
                  <span className="muted tiny">{b.description}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  )
}
