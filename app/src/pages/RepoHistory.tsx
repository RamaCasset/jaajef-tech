import { useCallback, useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { dateLocale } from '../i18n/lang'
import { fr } from '../i18n/fr'
import { EditorError, getProjectFull, GithubError, loadHistory, type CommitRow, type ProjectFull } from '../lib/api'

const reason = (e: unknown) => (e instanceof EditorError ? fr.editor.errors[e.code] ?? fr.repoHistory.failed : e instanceof GithubError ? fr.repoViewer.errors[e.code] : fr.repoHistory.failed)

/** The commit history of a repository (or of one file), 30 at a time. Open to the people who can see the project. */
export function RepoHistory() {
  const t = fr.repoHistory
  const { id = '' } = useParams()
  const [params] = useSearchParams()
  const path = params.get('fichier') ?? ''
  const [project, setProject] = useState<ProjectFull | null>(null)
  const [commits, setCommits] = useState<CommitRow[]>([])
  const [more, setMore] = useState(false)
  const [page, setPage] = useState(1)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let alive = true
    setError(null)
    setLoading(true)
    setCommits([])
    setPage(1)
    getProjectFull(id)
      .then(async (p) => {
        if (!p) throw new GithubError('not_found')
        const h = await loadHistory(p, { path: path || undefined, page: 1 })
        if (alive) { setProject(p); setCommits(h.commits); setMore(h.more); setLoading(false) }
      })
      .catch((e) => { if (alive) { setError(reason(e)); setLoading(false) } })
    return () => { alive = false }
  }, [id, path, reload])

  const loadMore = useCallback(async () => {
    if (!project) return
    setError(null)
    try {
      const h = await loadHistory(project, { path: path || undefined, page: page + 1 })
      setCommits((c) => [...c, ...h.commits])
      setMore(h.more)
      setPage(page + 1)
    } catch (e) {
      setError(reason(e))
    }
  }, [project, path, page])

  const back = project ? (path ? `/projets/${project.id}/code?fichier=${encodeURIComponent(path)}` : `/projets/${project.id}`) : '/projets'

  return (
    <AppShell>
      <main className="page history-page">
        <p><Link to={back}>← {t.back}</Link></p>
        <h1 className="page-title">{path ? t.fileTitle(path) : t.title}</h1>
        {project && <p className="muted">{project.title}</p>}
        {error && <div className="alert" role="alert">{error} <button type="button" className="btn" onClick={() => setReload((n) => n + 1)}>{t.retry}</button></div>}
        {loading && !error && <p className="muted">{t.loading}</p>}
        {!loading && !error && commits.length === 0 && <p className="muted">{t.empty}</p>}
        {commits.length > 0 && (
          <ol className="panel history-list">
            {commits.map((c) => (
              <li key={c.sha}>
                <div className="history-main">
                  <strong>{c.message || t.commit(c.sha.slice(0, 7))}</strong>
                  <span className="muted tiny">
                    {c.author ? `${t.by(c.author)} · ` : ''}{c.date ? new Date(c.date).toLocaleDateString(dateLocale(), { day: 'numeric', month: 'long', year: 'numeric' }) : ''}
                  </span>
                </div>
                <span className="history-side">
                  <code className="tiny muted">{c.sha.slice(0, 7)}</code>
                  {c.html_url.startsWith('https://github.com/') && <a className="tiny" href={c.html_url} target="_blank" rel="noopener noreferrer">{t.seeOnGithub}</a>}
                </span>
              </li>
            ))}
          </ol>
        )}
        {more && <p><button type="button" className="btn" onClick={() => void loadMore()}>{t.more}</button></p>}
      </main>
    </AppShell>
  )
}
