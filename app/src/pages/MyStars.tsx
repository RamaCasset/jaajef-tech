import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { Icon } from '../components/Icon'
import { RepoSide } from '../components/RepoSide'
import { useAuth } from '../auth/AuthContext'
import { fr } from '../i18n/fr'
import { listMyStarred, type StarredRepo } from '../lib/api'
import { timeAgo } from '../lib/time'

export function MyStars() {
  const t = fr.myRepos
  const { member } = useAuth()
  const me = member?.profile.id ?? ''
  const username = member?.profile.username ?? ''
  const [list, setList] = useState<StarredRepo[] | null>(null)
  const [failed, setFailed] = useState(false)
  const load = useCallback(() => { setFailed(false); listMyStarred(me).then(setList).catch(() => setFailed(true)) }, [me])
  useEffect(load, [load])

  return (
    <AppShell>
      <main className="page repos-page">
        <RepoSide repoCount={null} />
        <div className="repos-main">
          <p className="mono tiny muted repo-crumb">{t.root} / {username} / <span className="crumb-on">{t.nav.stars}</span></p>
          <header className="page-head">
            <h1 className="page-title">{t.starsTitle} {list ? <span className="count-pill">{list.length}</span> : null}</h1>
            <p className="muted">{t.starsSubtitle}</p>
          </header>
          {failed && <div className="alert" role="alert">{t.error} <button type="button" className="btn" onClick={load}>{t.retry}</button></div>}
          {!failed && list === null && <p className="muted">{fr.common.loading}</p>}
          {list && list.length === 0 && <div className="panel empty"><strong>{t.starsEmpty}</strong></div>}
          {list && list.length > 0 && (
            <div className="panel repo-list">
              <ul>
                {list.map((r) => {
                  const updated = timeAgo(r.github_pushed_at)
                  return (
                    <li key={r.id} className="repo-row">
                      <div className="repo-row-main">
                        <h3 className="repo-row-title">
                          <span className="project-icon" aria-hidden="true"><Icon name="repo" size={18} /></span>
                          <Link to={`/projets/${r.id}`}>{r.github_repo}</Link>
                          <span className="muted tiny">{t.byOwner(r.owner_username)}</span>
                        </h3>
                        <p className="muted">{r.summary ?? r.title}</p>
                        <p className="repo-facts muted tiny">
                          {r.language ? <span className="repo-lang"><span className="lang-dot" aria-hidden="true" />{r.language}</span> : null}
                          <span aria-label={fr.projects.stars(r.github_stars)}><Icon name="star" size={13} /> {r.github_stars}</span>
                          <span aria-label={fr.projects.forks(r.github_forks)}><Icon name="fork" size={13} /> {r.github_forks}</span>
                          {updated ? <span>{t.updated(updated)}</span> : null}
                        </p>
                      </div>
                      <div className="repo-row-actions"><Link className="btn" to={`/projets/${r.id}`}>{t.open}</Link></div>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </div>
      </main>
    </AppShell>
  )
}
