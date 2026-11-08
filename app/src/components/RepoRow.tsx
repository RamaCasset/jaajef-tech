import { useState } from 'react'
import { Link } from 'react-router-dom'
import { BuildBadge } from './ProjectCard'
import { Icon } from './Icon'
import { fr } from '../i18n/fr'
import { timeAgo } from '../lib/time'
import type { MyRepo } from '../lib/api'

function RepoFacts({ r }: { r: MyRepo }) {
  const stars = r.github_stars + r.star_count
  const updated = timeAgo(r.github_pushed_at ?? r.updated_at)
  return (
    <p className="repo-facts muted tiny">
      {r.language ? <span className="repo-lang"><span className="lang-dot" aria-hidden="true" />{r.language}</span> : null}
      <span aria-label={fr.projects.stars(stars)}><Icon name="star" size={13} /> {stars}</span>
      <span aria-label={fr.projects.forks(r.github_forks)}><Icon name="fork" size={13} /> {r.github_forks}</span>
      {updated ? <span>{fr.myRepos.updated(updated)}</span> : null}
    </p>
  )
}

function Tags({ r, me }: { r: MyRepo; me: string }) {
  const t = fr.myRepos
  return (
    <>
      {r.owner_id !== me ? <span className="tag tag-collab">{t.collaborator}</span> : null}
      <span className={`tag ${r.is_public ? '' : 'tag-private'}`}>{r.is_public ? t.public : t.private}</span>
      {r.repo_missing_at ? <span className="tag tag-missing">{t.missing}</span> : !r.verified_at ? <span className="tag tag-pending">{t.pending}</span> : null}
    </>
  )
}

type Actions = { me: string; onPin: () => void; onVisibility: () => void; onRemove: () => void }

function RowMenu({ repo, me, onPin, onVisibility, onRemove }: { repo: MyRepo } & Actions) {
  const t = fr.myRepos
  const mine = repo.owner_id === me
  const [open, setOpen] = useState(false)
  const pick = (fn: () => void) => () => { setOpen(false); fn() }
  return (
    <div className="row-menu">
      <button type="button" className="icon-btn" aria-label={t.actions(repo.github_repo)} aria-expanded={open} onClick={() => setOpen((v) => !v)}><Icon name="dots" size={18} /></button>
      {open ? (
        <div className="row-menu-pop" role="menu">
          {mine ? (
            <>
              <button type="button" role="menuitem" onClick={pick(onPin)}>{repo.pinned_at ? t.unpin : t.pin}</button>
              {repo.repo_private ? null : <button type="button" role="menuitem" onClick={pick(onVisibility)}>{repo.is_public ? t.makePrivate : t.makePublic}</button>}
              <Link role="menuitem" to={`/projets/${repo.id}`} onClick={() => setOpen(false)}>{t.editShowcase}</Link>
              <button type="button" role="menuitem" className="menu-danger" onClick={pick(onRemove)}>{t.remove}</button>
            </>
          ) : (
            <button type="button" role="menuitem" className="menu-danger" onClick={pick(onRemove)}>{t.leave}</button>
          )}
        </div>
      ) : null}
    </div>
  )
}

export function PinnedCard({ repo, me, onPin, onVisibility, onRemove }: { repo: MyRepo } & Actions) {
  return (
    <article className="panel pinned-card">
      <header className="pinned-head">
        <span className="mono muted tiny">{repo.github_owner} /</span>
        <span className="pinned-pin" aria-hidden="true"><Icon name="pin" size={16} /></span>
      </header>
      <h3 className="pinned-title">
        <span className="project-icon" aria-hidden="true"><Icon name={repo.is_public ? 'repo' : 'lock'} size={18} /></span>
        <Link to={`/projets/${repo.id}`}>{repo.github_repo}</Link>
        <Tags r={repo} me={me} />
      </h3>
      <p className="muted project-summary">{repo.summary ?? repo.title}</p>
      <RepoFacts r={repo} />
      <footer className="pinned-foot">
        <BuildBadge status={repo.build_status} />
        <RowMenu repo={repo} me={me} onPin={onPin} onVisibility={onVisibility} onRemove={onRemove} />
      </footer>
    </article>
  )
}

export function RepoListRow({ repo, me, onPin, onVisibility, onRemove }: { repo: MyRepo } & Actions) {
  return (
    <li className="repo-row">
      <div className="repo-row-main">
        <h3 className="repo-row-title">
          <span className="project-icon" aria-hidden="true"><Icon name={repo.is_public ? 'repo' : 'lock'} size={18} /></span>
          <Link to={`/projets/${repo.id}`}>{repo.github_repo}</Link>
          <Tags r={repo} me={me} />
        </h3>
        <p className="muted">{repo.summary ?? repo.title}</p>
        <RepoFacts r={repo} />
      </div>
      <div className="repo-row-actions">
        <Link className="btn" to={`/projets/${repo.id}`}>{fr.myRepos.open}</Link>
        <RowMenu repo={repo} me={me} onPin={onPin} onVisibility={onVisibility} onRemove={onRemove} />
      </div>
    </li>
  )
}
