import { useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Icon } from './Icon'
import { MyOffers } from './MyOffers'
import { ReportButton } from './ReportButton'
import { BuildBadge, ClanTag } from './ProjectCard'
import { dateLocale } from '../i18n/lang'
import { fr } from '../i18n/fr'
import { friendlyError } from '../lib/errors'
import { listMyBlogPosts, listAuthorBlogPosts, startConversation, type MyBlogPost, type ProfileData } from '../lib/api'

type Tab = 'code' | 'blog' | 'offers'

/** A member's page: cover, identity, level, numbers, then tabs. Used for profiles and for the Cité home (with `extra` under the numbers). */
export function ProfileView({ data, viewerId, extra }: { data: ProfileData; viewerId: string; extra?: ReactNode }) {
  const t = fr.profile
  const navigate = useNavigate()
  const [writeError, setWriteError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('code')
  const [posts, setPosts] = useState<MyBlogPost[] | null>(null)
  const [postsFailed, setPostsFailed] = useState(false)
  const { profile: p, xpPerLevel, badges, projects, questsSolved } = data
  const own = p.id === viewerId

  useEffect(() => {
    if (tab !== 'blog' || posts !== null) return
    let alive = true
    const load = own
      ? listMyBlogPosts(p.id).then((list) => list.filter((x) => x.status === 'published' && !x.staff_hidden))
      : listAuthorBlogPosts(p.id)
    load.then((list) => { if (alive) setPosts(list) }).catch(() => { if (alive) setPostsFailed(true) })
    return () => { alive = false }
  }, [tab, own, posts, p.id])

  async function write() {
    setWriteError(null)
    try {
      navigate(`/messages/${await startConversation(p.id)}`)
    } catch (err) {
      setWriteError(friendlyError(err))
    }
  }
  const level = 1 + Math.floor(p.xp / xpPerLevel)
  const inLevel = p.xp % xpPerLevel
  const since = new Date(p.created_at).toLocaleDateString(dateLocale(), { month: 'long', year: 'numeric' })
  const tabs: Tab[] = own ? ['code', 'blog', 'offers'] : ['code', 'blog']

  return (
    <>
      <section className="panel profile-card">
        <div className="profile-banner" style={p.banner_url ? { backgroundImage: `url(${p.banner_url})` } : undefined} aria-hidden="true" />
        {own && <Link className="cover-btn" to="/parametres/profil"><Icon name="pen" size={16} /> {t.customizeCover}</Link>}
        <div className="profile-head">
          <div className="profile-side">
            <div className="profile-avatar" aria-hidden="true">
              {p.avatar_url ? <img src={p.avatar_url} alt="" /> : p.display_name.slice(0, 1).toUpperCase()}
            </div>
            {p.mastery ? <span className="mastery-chip">{fr.masteries[p.mastery].name}</span> : null}
          </div>
          <div className="profile-main">
            <h1 className="page-title">{p.display_name}{p.is_verified ? <span className="tag" style={{ marginLeft: 8 }}>{t.verified}</span> : null}</h1>
            {p.headline ? <p className="profile-headline">{p.headline}</p> : null}
            <p className="mono profile-handle">@{p.username}</p>
            <p><ClanTag clan={p.clan} /></p>
            {p.bio ? <p>{p.bio}</p> : null}
            <p className="muted tiny">
              {[p.location, t.since(since)].filter(Boolean).join(' · ')}
              {p.github_username ? <> · <a href={`https://github.com/${p.github_username}`} target="_blank" rel="noreferrer">github.com/{p.github_username}</a></> : null}
            </p>
          </div>
          <div className="profile-actions">
            {own && <Link className="btn btn-cta" to="/parametres/profil">{fr.editProfile.edit}</Link>}
            {!own && <button type="button" className="btn btn-cta" onClick={() => void write()}>{fr.messages.write}</button>}
            {!own && <ReportButton type="member" id={p.id} />}
            {writeError && <span role="alert" className="alert">{writeError}</span>}
            {p.available_to_collab ? <span className="build build-passing">{t.available}</span> : null}
          </div>
        </div>
        <div className="profile-xp">
          <span className="mono">{t.level(level, inLevel, xpPerLevel)}</span>
          <div className="xp-track" role="progressbar" aria-valuemin={0} aria-valuemax={xpPerLevel} aria-valuenow={inLevel} aria-label={t.level(level, inLevel, xpPerLevel)}>
            <div className="xp-fill" style={{ width: `${Math.round((inLevel / xpPerLevel) * 100)}%` }} />
          </div>
          <span className="muted tiny">{t.toNext(xpPerLevel - inLevel, level + 1)}</span>
        </div>
      </section>

      <dl className="profile-stats">
        {questsSolved !== null ? <div className="panel panel-pad"><span className="stat-icon"><Icon name="quest" size={28} /></span><div><dd>{questsSolved}</dd><dt>{t.stats.quests}</dt></div></div> : null}
        <div className="panel panel-pad"><span className="stat-icon stat-gold"><Icon name="arena" size={28} /></span><div><dd className="stat-gold">{p.xp.toLocaleString(dateLocale())}</dd><dt>{t.stats.xp}</dt></div></div>
        <div className="panel panel-pad"><span className="stat-icon"><Icon name="repo" size={28} /></span><div><dd>{projects.length}</dd><dt>{t.stats.projects}</dt></div></div>
        <div className="panel panel-pad"><span className="stat-icon"><Icon name="star" size={28} /></span><div><dd>{data.appreciation.toLocaleString(dateLocale())}</dd><dt>{t.stats.stars}</dt></div></div>
      </dl>

      {extra}

      <div role="tablist" className="profile-tabs" aria-label={t.tabsLabel}>
        {tabs.map((k) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={`profile-tab ${tab === k ? 'profile-tab-on' : ''}`} onClick={() => setTab(k)}>{!own ? (k === 'code' ? t.projectsOther : t.blogOther) : t.tabs[k]}</button>
        ))}
      </div>

      {tab === 'code' && (
        <div className="profile-cols">
          <section aria-labelledby="pp">
            <div className="profile-colhead"><h2 id="pp">{t.projects}</h2><span className="muted tiny">{t.projectsCount(projects.length)}</span></div>
            {projects.length === 0 ? <p className="muted">{t.noProjects}</p> : projects.slice(0, 3).map((pr) => (
              <article key={pr.id} className="panel project-card">
                <h3><Link to={`/projets/${pr.id}`}>{pr.github_owner} / {pr.github_repo}</Link></h3>
                <p className="muted project-summary">{pr.summary ?? pr.title}</p>
                <div className="project-tags">
                  {pr.collaborator ? <span className="tag">{t.collaborator}</span> : null}
                  {pr.language ? <span className="tag">{pr.language}</span> : null}
                  <span className="muted tiny">★ {pr.github_stars}</span>
                  <BuildBadge status={pr.build_status} />
                </div>
              </article>
            ))}
          </section>
          <section aria-labelledby="pb">
            <div className="profile-colhead"><h2 id="pb">{t.badges}</h2><span className="muted tiny">{t.unlocked(badges.length)}</span></div>
            <BadgeGrid badges={badges.slice(0, 6)} />
          </section>
        </div>
      )}


      {tab === 'offers' && own && <MyOffers userId={p.id} />}

      {tab === 'blog' && (
        <section aria-labelledby="pbl">
          <div className="profile-colhead"><h2 id="pbl">{t.tabs.blog}</h2></div>
          {postsFailed && <p role="alert" className="alert">{t.blogError}</p>}
          {!postsFailed && posts === null && <p className="muted">{fr.common.loading}</p>}
          {posts && posts.length === 0 && <p className="muted">{t.noPosts}</p>}
          {posts && posts.map((x) => (
            <article key={x.id} className="panel panel-pad post-row">
              <h3><Link to={`/blog/${x.slug}`}>{x.title}</Link></h3>
              <span className="muted tiny">{new Date(x.updated_at).toLocaleDateString(dateLocale())}</span>
            </article>
          ))}
        </section>
      )}
    </>
  )
}

function BadgeGrid({ badges }: { badges: ProfileData['badges'] }) {
  if (badges.length === 0) return <p className="muted">{fr.profile.noBadges}</p>
  return (
    <ul className="badge-grid">
      {badges.map((b) => (
        <li key={b.slug} className={`panel badge badge-${b.tier}`}>
          <span className="badge-icon" aria-hidden="true"><Icon name="arena" size={26} /></span>
          <strong>{b.name}</strong>
          <span className="muted tiny">{b.description}</span>
        </li>
      ))}
    </ul>
  )
}
