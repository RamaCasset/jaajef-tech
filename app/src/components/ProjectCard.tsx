import { fr, type ClanKey } from '../i18n/fr'
import type { BuildStatus, ProjectRow } from '../lib/api'

export function ClanTag({ clan }: { clan: ClanKey | null }) {
  if (!clan) return null
  return <span className="tag">{fr.clans[clan].name}</span>
}

export function BuildBadge({ status }: { status: BuildStatus | null | undefined }) {
  if (!status) return null
  return <span className={`build build-${status}`}>{fr.projects.build[status]}</span>
}

export function ProjectCard({ project, build }: { project: ProjectRow; build?: BuildStatus | null }) {
  return (
    <article className="panel project-card">
      <header className="project-head">
        <h3>
          <a href={`https://github.com/${project.github_owner}/${project.github_repo}`} target="_blank" rel="noreferrer">
            {project.github_repo}
          </a>
        </h3>
        <span className="muted tiny">{fr.projects.public}</span>
      </header>
      <p className="muted project-summary">{project.summary ?? project.title}</p>
      <div className="project-tags">
        {project.language && <span className="tag">{project.language}</span>}
        <span className="muted tiny" aria-label={fr.projects.stars(project.github_stars + project.star_count)}>★ {project.github_stars + project.star_count}</span>
        <BuildBadge status={build} />
      </div>
      <footer className="project-foot">
        <span className="muted tiny">{project.owner_display_name}</span>
        <ClanTag clan={project.owner_clan} />
      </footer>
    </article>
  )
}
