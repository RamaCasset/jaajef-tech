import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { Icon } from '../components/Icon'
import { SpaceToggle } from '../components/SpaceToggle'
import { ClanTag, ProjectCard, BuildBadge } from '../components/ProjectCard'
import { fr, type ClanKey } from '../i18n/fr'
import {
  buildStatuses, listGoodFirstIssues, projectContributors, projectCoverUrl, projectLanguages, REGION_KEYS, searchProjects, trendingCreators,
  type BuildStatus, type ProjectContributor, type RegionKey, type GoodFirstIssue, type LanguageCount, type ProjectRow, type SearchFilters, type SortKey, type TrendingCreator,
} from '../lib/api'
import { useDebounced } from '../hooks'

const CLANS = Object.keys(fr.clans) as ClanKey[]
const SORTS = Object.keys(fr.projects.sorts) as SortKey[]

export function Projects() {
  const [query, setQuery] = useState('')
  const [language, setLanguage] = useState('')
  const [clan, setClan] = useState<ClanKey | ''>('')
  const [region, setRegion] = useState<RegionKey | ''>('')
  const [sort, setSort] = useState<SortKey>('trending')
  const debouncedQuery = useDebounced(query)

  const [projects, setProjects] = useState<ProjectRow[] | null>(null)
  const [builds, setBuilds] = useState<Record<string, BuildStatus | null>>({})
  const [people, setPeople] = useState<Record<string, ProjectContributor[]>>({})
  const [error, setError] = useState(false)
  const [reloads, setReloads] = useState(0)

  const [featured, setFeatured] = useState<ProjectRow | null>(null)
  const [languages, setLanguages] = useState<LanguageCount[]>([])
  const [creators, setCreators] = useState<TrendingCreator[] | null>(null)
  const [issues, setIssues] = useState<GoodFirstIssue[] | null>(null)
  const [showIssues, setShowIssues] = useState(false)

  // Things that do not depend on the filters. A failure here only hides that block.
  useEffect(() => {
    let alive = true
    const filters: SearchFilters = { query: '', language: '', clan: '', sort: 'recent', region: '' }
    searchProjects(filters, { featuredOnly: true, limit: 1 }).then((r) => alive && setFeatured(r[0] ?? null)).catch(() => undefined)
    projectLanguages().then((r) => alive && setLanguages(r)).catch(() => undefined)
    trendingCreators(7, 5).then((r) => alive && setCreators(r)).catch(() => alive && setCreators([]))
    listGoodFirstIssues(20).then((r) => alive && setIssues(r)).catch(() => alive && setIssues([]))
    return () => { alive = false }
  }, [])

  // The list follows the filters. An older answer never replaces a newer one.
  useEffect(() => {
    let alive = true
    setError(false)
    searchProjects({ query: debouncedQuery, language, clan, sort, region })
      .then(async (rows) => {
        if (!alive) return
        setProjects(rows)
        try {
          const b = await buildStatuses(rows.map((r) => r.project_id))
          if (alive) setBuilds(b)
        } catch { /* the badge is optional */ }
        try {
          const list = await projectContributors(rows.map((r) => r.project_id))
          const grouped: Record<string, ProjectContributor[]> = {}
          for (const c of list) (grouped[c.project_id] ??= []).push(c)
          if (alive) setPeople(grouped)
        } catch { /* the little pictures are optional */ }
      })
      .catch(() => { if (alive) { setProjects(null); setError(true) } })
    return () => { alive = false }
  }, [debouncedQuery, language, clan, sort, region, reloads])

  const retry = useCallback(() => { setProjects(null); setReloads((n) => n + 1) }, [])
  const projectsWithIssues = issues ? new Set(issues.map((i) => i.project_id)).size : 0

  return (
    <AppShell>
      <main className="page">
        <div className="space-bar"><SpaceToggle active="community" /></div>
        <div className="page-head-row">
          <div>
            <p className="eyebrow">{fr.projects.eyebrow}</p>
            <h1 className="page-title">{fr.projects.title}</h1>
            <p className="muted">{fr.projects.subtitle}</p>
          </div>
          <Link className="btn btn-cta btn-icon" to="/projets/ajouter"><Icon name="plus" size={16} /> {fr.importProject.newProject}</Link>
        </div>

        <div className="filters">
          <input
            type="search"
            className="search"
            placeholder={fr.projects.search}
            aria-label={fr.projects.search}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select aria-label={fr.projects.language} value={language} onChange={(e) => setLanguage(e.target.value)}>
            <option value="">{fr.projects.allLanguages}</option>
            {languages.map((l) => <option key={l.language} value={l.language}>{l.language} ({l.project_count})</option>)}
          </select>
          <select aria-label={fr.projects.clan} value={clan} onChange={(e) => setClan(e.target.value as ClanKey | '')}>
            <option value="">{fr.projects.allClans}</option>
            {CLANS.map((c) => <option key={c} value={c}>{fr.clans[c].name}</option>)}
          </select>
          <select aria-label={fr.projects.region} value={region} onChange={(e) => setRegion(e.target.value as RegionKey | '')}>
            <option value="">{fr.projects.allRegions}</option>
            {REGION_KEYS.map((r) => <option key={r} value={r}>{fr.regions[r]}</option>)}
          </select>
        </div>

        <div className="projects-layout">
          <div className="projects-main">
            {featured && (
              <section className="panel featured" aria-label={fr.projects.featured}>
                <div className="featured-art" aria-hidden="true" style={featured.cover_path ? { backgroundImage: `url(${projectCoverUrl(featured.cover_path)})` } : undefined} />
                <div className="featured-body">
                  <span className="tag tag-accent">{fr.projects.featured.toUpperCase()}</span>
                  <h2>{featured.github_owner} / {featured.github_repo}</h2>
                  <p className="muted">{featured.summary ?? featured.title}</p>
                  <p className="tiny">
                    {featured.owner_display_name} <ClanTag clan={featured.owner_clan} />{' '}
                    <span className="muted">★ {featured.github_stars + featured.star_count}</span>{' '}
                    <BuildBadge status={builds[featured.project_id]} />
                  </p>
                  {featured.demo_url ? (
                    <p><a className="btn btn-demo" href={featured.demo_url} target="_blank" rel="noreferrer noopener"><Icon name="play" size={16} /> {fr.projects.demo}</a></p>
                  ) : null}
                </div>
              </section>
            )}

            <div className="list-head">
              <h2>{fr.projects.community}</h2>
              <span className="muted tiny">
                {projects ? fr.projects.count(projects.length) : ''}
                {' · '}
                <label>
                  {fr.projects.sort} :{' '}
                  <select aria-label={fr.projects.sort} value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
                    {SORTS.map((s) => <option key={s} value={s}>{fr.projects.sorts[s]}</option>)}
                  </select>
                </label>
              </span>
            </div>

            {error && (
              <div className="alert" role="alert">
                {fr.projects.error} <button type="button" className="btn" onClick={retry}>{fr.projects.retry}</button>
              </div>
            )}
            {!error && projects === null && <p className="muted">{fr.common.loading}</p>}
            {projects && projects.length === 0 && (
              <div className="panel empty">
                <strong>{fr.projects.empty}</strong>
                <span className="muted">{fr.projects.emptyHint}</span>
              </div>
            )}
            {projects && projects.length > 0 && (
              <div className="project-grid">
                {projects.map((p) => <ProjectCard key={p.project_id} project={p} build={builds[p.project_id]} people={people[p.project_id]} />)}
              </div>
            )}
          </div>

          <aside className="projects-side">
            <section className="panel side-card">
              <h2 className="side-title">{fr.projects.trending}</h2>
              <p className="muted tiny">{fr.projects.trendingSub}</p>
              {creators && creators.length === 0 && <p className="muted tiny">{fr.projects.trendingEmpty}</p>}
              <ol className="creators">
                {(creators ?? []).map((c, i) => (
                  <li key={c.user_id}>
                    <span className="muted rank">{String(i + 1).padStart(2, '0')}</span>
                    <span className="mini-avatar" aria-hidden="true">{c.display_name.slice(0, 1).toUpperCase()}</span>
                    <span className="creator-name">
                      <strong>{c.display_name}</strong>
                      <ClanTag clan={c.clan} />
                    </span>
                    <span className="creator-score">{c.contributions}</span>
                  </li>
                ))}
              </ol>
              <Link className="side-link" to="/arene">{fr.projects.fullRanking} →</Link>
            </section>

            <section className="panel side-card">
              <p className="eyebrow">{fr.projects.grow}</p>
              <p style={{ margin: '10px 0 14px' }}>
                {projectsWithIssues > 0 ? fr.projects.growBody(projectsWithIssues) : fr.projects.growNone}
              </p>
              <button type="button" className="btn" onClick={() => setShowIssues((v) => !v)} aria-expanded={showIssues} disabled={!issues || issues.length === 0}>
                {fr.projects.goodFirstIssues}
              </button>
            </section>
          </aside>
        </div>

        {showIssues && issues && (
          <section className="panel issues" aria-label={fr.projects.issuesTitle}>
            <div className="list-head">
              <h2>{fr.projects.issuesTitle}</h2>
              <button type="button" className="btn" onClick={() => setShowIssues(false)}>{fr.projects.closeIssues}</button>
            </div>
            {issues.length === 0 && <p className="muted">{fr.projects.issuesEmpty}</p>}
            <ul className="issue-list">
              {issues.map((i) => (
                <li key={i.issue_id}>
                  <a href={i.url} target="_blank" rel="noreferrer">{i.title}</a>
                  <span className="muted tiny">
                    {i.github_owner}/{i.github_repo} · #{i.issue_number} · {fr.projects.comments(i.comments)}
                    {i.language ? ` · ${i.language}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </AppShell>
  )
}
