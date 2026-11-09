import { Link } from 'react-router-dom'
import { Icon } from './Icon'
import { fr, type ClanKey } from '../i18n/fr'
import { timeAgo } from '../lib/time'
import type { BuildStatus, ProjectContributor, ProjectRow } from '../lib/api'

export function ClanTag({ clan }: { clan: ClanKey | null }) {
  if (!clan) return null
  return <span className="tag">{fr.clans[clan].name}</span>
}

export function BuildBadge({ status }: { status: BuildStatus | null | undefined }) {
  if (!status) return null
  return <span className={`build build-${status}`}>{fr.projects.build[status]}</span>
}

/** The small round pictures of the people who work on a project. */
export function PeopleStack({ people }: { people: ProjectContributor[] }) {
  if (people.length === 0) return <span />
  const names = people.map((p) => p.display_name).join(', ')
  return (
    <span className="people-stack" role="img" aria-label={fr.projects.people(names)} title={names}>
      {people.map((p) => (
        <span key={p.user_id} className="mini-avatar mini-avatar-sm">
          {p.avatar_url ? <img src={p.avatar_url} alt="" /> : p.display_name.slice(0, 1).toUpperCase()}
        </span>
      ))}
    </span>
  )
}

export function ProjectCard({ project, build, people = [] }: { project: ProjectRow; build?: BuildStatus | null; people?: ProjectContributor[] }) {
  const stars = project.github_stars + project.star_count
  const updated = timeAgo(project.github_pushed_at)
  return (
    <article className="panel project-card">
      <header className="project-head">
        <h3>
          <span className="project-icon" aria-hidden="true"><Icon name="repo" size={18} /></span>
          <Link to={`/projets/${project.project_id}`}>{project.github_repo}</Link>
        </h3>
        <span className="muted tiny">{fr.projects.public}</span>
      </header>
      <p className="muted project-summary">{project.summary ?? project.title}</p>
      <div className="project-tags">
        {project.language && <span className="tag">{project.language}</span>}
        <span className="muted tiny" aria-label={fr.projects.stars(stars)}>★ {stars}</span>
        <span className="muted tiny project-forks" aria-label={fr.projects.forks(project.github_forks)}><Icon name="fork" size={13} /> {project.github_forks}</span>
        <BuildBadge status={build} />
      </div>
      <footer className="project-foot">
        <PeopleStack people={people} />
        {project.demo_url ? (
          <a className="btn btn-demo btn-small" href={project.demo_url} target="_blank" rel="noreferrer noopener"><Icon name="play" size={14} /> {fr.projects.demo}</a>
        ) : updated ? <span className="muted tiny">{fr.projects.updated(updated)}</span> : null}
      </footer>
    </article>
  )
}
