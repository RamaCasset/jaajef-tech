import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import {
  getProjectFull, getRepoFile, getRepoTree, GithubError, isViewable,
  type ProjectFull, type RepoEntry, type RepoTree,
} from '../lib/api'
import { fr } from '../i18n/fr'

function message(e: unknown): string {
  return e instanceof GithubError ? fr.repoViewer.errors[e.code] : fr.repoViewer.errors.failed
}

export function RepoViewer() {
  const t = fr.repoViewer
  const { id = '' } = useParams()
  const [project, setProject] = useState<ProjectFull | null>(null)
  const [tree, setTree] = useState<RepoTree | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<RepoEntry | null>(null)
  const [content, setContent] = useState<string | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)

  const load = useCallback(() => {
    let alive = true
    setError(null)
    setTree(null)
    getProjectFull(id)
      .then(async (p) => {
        if (!p) throw new GithubError('not_found')
        const tr = await getRepoTree(p.github_owner, p.github_repo)
        if (alive) { setProject(p); setTree(tr) }
      })
      .catch((e) => { if (alive) setError(message(e)) })
    return () => { alive = false }
  }, [id])
  useEffect(() => { const stop = load(); return stop }, [load, reload])

  async function open(entry: RepoEntry) {
    if (!project || !tree) return
    setSelected(entry)
    setContent(null)
    setFileError(null)
    if (!isViewable(entry)) { setFileError(t.notViewable); return }
    try {
      setContent(await getRepoFile(project.github_owner, project.github_repo, tree.branch, entry.path))
    } catch (e) {
      setFileError(message(e))
    }
  }

  const files = useMemo(() => (tree?.entries ?? []).filter((e) => e.type === 'blob').sort((a, b) => a.path.localeCompare(b.path)), [tree])
  const lineCount = content === null ? 0 : content.split('\n').length

  return (
    <AppShell>
      <main className="page">
        <p><Link to={`/projets/${id}`}>← {t.back}</Link></p>
        <header className="page-head">
          <h1 className="page-title">{t.title}{project ? ` : ${project.title}` : ''}</h1>
          {tree && <p className="muted">{t.branch(tree.branch)}</p>}
          {project && <p><a href={`https://github.com/${project.github_owner}/${project.github_repo}`} target="_blank" rel="noopener noreferrer">{t.openOnGithub}</a></p>}
        </header>
        {error && <div className="alert" role="alert">{error} <button type="button" className="btn" onClick={() => setReload((n) => n + 1)}>{t.retry}</button></div>}
        {!tree && !error && <p className="muted">{t.loading}</p>}
        {tree && tree.truncated && <p className="muted">{t.truncated}</p>}
        {tree && files.length === 0 && <p className="muted">{t.empty}</p>}
        {tree && files.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 1fr) 3fr', gap: 16 }}>
            <nav aria-label={t.files}>
              <h2>{t.files}</h2>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, maxHeight: 520, overflow: 'auto' }}>
                {files.map((f) => (
                  <li key={f.path}>
                    <button
                      type="button"
                      className={`btn ${selected?.path === f.path ? 'btn-cta' : ''}`}
                      style={{ width: '100%', textAlign: 'left' }}
                      aria-pressed={selected?.path === f.path}
                      onClick={() => void open(f)}
                    >{f.path}</button>
                  </li>
                ))}
              </ul>
            </nav>
            <section aria-label={selected?.path ?? t.chooseFile}>
              {!selected && <p className="muted">{t.chooseFile}</p>}
              {selected && <h2 className="mono">{selected.path}</h2>}
              {selected && content === null && !fileError && <p className="muted">{t.loading}</p>}
              {fileError && <p role="alert" className="alert">{fileError}</p>}
              {content !== null && (
                <>
                  <p className="tiny muted">{t.lines(lineCount)}</p>
                  <pre className="mono" style={{ overflow: 'auto', maxHeight: 520, margin: 0, padding: 12, tabSize: 2 }}><code>{content}</code></pre>
                </>
              )}
            </section>
          </div>
        )}
      </main>
    </AppShell>
  )
}
