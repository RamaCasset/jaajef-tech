import { useCallback, useEffect, useMemo, useState, type FormEvent, type MouseEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { CodeEditor } from '../components/CodeEditor'
import { Icon } from '../components/Icon'
import { ProjectFiles, dirUrl, fileUrl, parentOf } from '../components/ProjectFiles'
import { useAuth } from '../auth/AuthContext'
import {
  EditorError, editorCommit, editorStatus, editorTree, getProjectFull, getRepoFile, getRepoTree, GithubError, isViewable,
  type EditorStatus, type ProjectFull, type RepoTree,
} from '../lib/api'
import { fr } from '../i18n/fr'

const errorText = (e: unknown) => fr.editor.errors[e instanceof EditorError ? e.code : 'unknown'] ?? fr.editor.errors.unknown
const viewError = (e: unknown) => (e instanceof GithubError ? fr.repoViewer.errors[e.code] : fr.repoViewer.errors.failed)

type Draft = { text: string; head: string; branch: string; isNew: boolean }
type Box = 'save' | 'delete' | null

export function RepoBrowser() {
  const t = fr.repoBrowser
  const { id = '' } = useParams()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { member } = useAuth()
  const me = member?.profile.id ?? ''
  const path = params.get('fichier') ?? ''
  const dir = params.get('dossier') ?? ''
  const wantsNew = params.get('nouveau') === '1'

  const [project, setProject] = useState<ProjectFull | null>(null)
  const [tree, setTree] = useState<RepoTree | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const [content, setContent] = useState<string | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [box, setBox] = useState<Box>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [install, setInstall] = useState<EditorStatus | null>(null)
  const [notAllowed, setNotAllowed] = useState(false)
  const [panelOpen, setPanelOpen] = useState(true)

  const isOwner = !!project && project.owner_id === me
  const dirty = draft !== null && (draft.isNew || draft.text !== content)

  useEffect(() => {
    let alive = true
    setError(null)
    getProjectFull(id)
      .then(async (p) => {
        if (!p) throw new GithubError('not_found')
        const tr = await getRepoTree(p.github_owner, p.github_repo)
        if (alive) { setProject(p); setTree(tr) }
      })
      .catch((e) => { if (alive) setError(viewError(e)) })
    return () => { alive = false }
  }, [id, reload])

  useEffect(() => {
    if (!dirty) return
    const warn = (ev: BeforeUnloadEvent) => { ev.preventDefault(); ev.returnValue = fr.editor.leaveWarning }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  // Opening another file starts from a clean state.
  useEffect(() => {
    setContent(null); setFileError(null); setDraft(null); setBox(null); setMessage(''); setActionError(null); setDone(null); setInstall(null); setNotAllowed(false)
  }, [path])

  useEffect(() => {
    if (!project || !tree || !path) return
    if (wantsNew) { setContent(''); return }
    const entry = tree.entries.find((e) => e.path === path && e.type === 'blob')
    if (!entry) { setFileError(fr.repoViewer.errors.not_found); return }
    if (!isViewable(entry)) { setFileError(fr.repoViewer.notViewable); return }
    let alive = true
    getRepoFile(project.github_owner, project.github_repo, tree.branch, path)
      .then((c) => { if (alive) setContent(c) })
      .catch((e) => { if (alive) setFileError(viewError(e)) })
    return () => { alive = false }
  }, [project, tree, path, wantsNew])

  /** Asks GitHub (through the editor function) for the latest state of the branch, and checks the app is installed. */
  const prepare = useCallback(async (): Promise<{ head: string; branch: string } | null> => {
    if (!project) return null
    setActionError(null)
    setBusy(true)
    try {
      const s = await editorStatus()
      if (!s.installed) { setInstall(s); return null }
      const tr = await editorTree(project.github_repo)
      if (tr.head === null) { setActionError(fr.editor.emptyRepo); return null }
      setInstall(null)
      setNotAllowed(false)
      return { head: tr.head, branch: tr.branch }
    } catch (e) {
      if (e instanceof EditorError && e.code === 'repo_not_allowed') setNotAllowed(true)
      else setActionError(errorText(e))
      return null
    } finally {
      setBusy(false)
    }
  }, [project])

  async function startEdit() {
    if (!project || content === null) return
    const ctx = await prepare()
    if (!ctx) return
    setDone(null)
    setDraft({ text: content, head: ctx.head, branch: ctx.branch, isNew: false })
  }

  // A new file (from the "Nouveau fichier" button) opens straight in editing mode.
  useEffect(() => {
    if (!wantsNew || !isOwner || draft || !path) return
    let alive = true
    void prepare().then((ctx) => { if (alive && ctx) setDraft({ text: '', head: ctx.head, branch: ctx.branch, isNew: true }) })
    return () => { alive = false }
  }, [wantsNew, isOwner, path, draft, prepare])

  async function startDelete() {
    setDone(null)
    if (draft) { setBox('delete'); return }
    const ctx = await prepare()
    if (!ctx) return
    setDraft({ text: content ?? '', head: ctx.head, branch: ctx.branch, isNew: false })
    setBox('delete')
  }

  async function commit(kind: 'save' | 'delete', e: FormEvent) {
    e.preventDefault()
    if (!project || !draft || !message.trim()) return
    setActionError(null)
    setBusy(true)
    try {
      const change = kind === 'delete' ? { path, delete: true } : { path, content: draft.text }
      const r = await editorCommit(project.github_repo, draft.branch, draft.head, message.trim(), [change])
      if (kind === 'delete') {
        navigate(dirUrl(project.id, parentOf(path)))
        return
      }
      setTree((tr) => (tr && !tr.entries.some((x) => x.path === path) ? { ...tr, entries: [...tr.entries, { path, type: 'blob', size: draft.text.length }] } : tr))
      setContent(draft.text)
      setDraft(null)
      setBox(null)
      setMessage('')
      setDone(r.html_url)
      if (wantsNew) navigate(fileUrl(project.id, path), { replace: true })
    } catch (err) {
      setActionError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  const guard = (ev: MouseEvent) => { if (dirty && !window.confirm(fr.editor.leaveWarning)) ev.preventDefault() }

  const allFiles = useMemo(() => {
    const paths = new Set((tree?.entries ?? []).filter((e) => e.type === 'blob').map((e) => e.path))
    if (wantsNew && path) paths.add(path)
    return [...paths].sort((a, b) => a.localeCompare(b))
  }, [tree, wantsNew, path])

  const segments = (path || dir).split('/').filter(Boolean)
  const shownText = draft ? draft.text : content ?? ''
  const lineCount = content === null && !draft ? 0 : shownText.split('\n').length
  const githubUrl = project ? `https://github.com/${project.github_owner}/${project.github_repo}` : '#'

  return (
    <AppShell>
      <main className="page repo-page">
        {error && <div className="alert" role="alert">{error} <button type="button" className="btn" onClick={() => setReload((n) => n + 1)}>{fr.repoViewer.retry}</button></div>}
        {!project && !error && <p className="muted">{fr.repoViewer.loading}</p>}

        {project && (
          <>
            <nav className="crumbs" aria-label={fr.repoBrowser.fileBar}>
              <Link to={`/projets/${project.id}`} onClick={guard}>{project.title}</Link>
              {segments.map((s, i) => {
                const upTo = segments.slice(0, i + 1).join('/')
                const last = i === segments.length - 1
                return (
                  <span key={upTo}>
                    <span aria-hidden="true"> / </span>
                    {last && path ? <strong>{s}</strong> : <Link to={dirUrl(project.id, upTo)} onClick={guard}>{s}</Link>}
                  </span>
                )
              })}
              <a className="crumbs-github" href={githubUrl} target="_blank" rel="noopener noreferrer">{t.openGithub}</a>
            </nav>

            {done && <div className="notice" role="status">{fr.editor.saved} <a href={done} target="_blank" rel="noopener noreferrer">{fr.editor.seeCommit}</a></div>}
            {actionError && <div className="alert" role="alert">{actionError}</div>}
            {install && (
              <section className="panel panel-pad">
                <h2>{fr.editor.installTitle}</h2>
                <p>{fr.editor.installText}</p>
                <p>
                  <a className="btn btn-cta" href={install.install_url} target="_blank" rel="noopener noreferrer">{fr.editor.install}</a>{' '}
                  <button type="button" className="btn" onClick={() => setInstall(null)}>{fr.editor.installed}</button>
                </p>
              </section>
            )}
            {notAllowed && (
              <section className="panel panel-pad">
                <h2>{fr.editor.notAllowedTitle}</h2>
                <p>{fr.editor.notAllowedText}</p>
                <p><a className="btn btn-cta" href="https://github.com/settings/installations" target="_blank" rel="noopener noreferrer">{fr.editor.manage}</a></p>
              </section>
            )}

            {!path && <ProjectFiles project={project} dir={dir} canEdit={isOwner} tree={tree} />}

            {path && (
              <div className={`repo-view ${panelOpen ? 'repo-view-panel' : ''}`}>
                <section className="editor-card" aria-label={path}>
                  <div className="file-bar">
                    <span className="file-path">{path}</span>
                    {content !== null && <span className="muted tiny">{fr.repoViewer.lines(lineCount)}</span>}
                    <div className="file-actions">
                      {isOwner && !wantsNew && (
                        <button type="button" className={`icon-btn ${draft ? 'icon-btn-on' : ''}`} aria-label={t.edit} title={t.edit} aria-pressed={draft !== null} disabled={busy || content === null || draft !== null} onClick={() => void startEdit()}><Icon name="pen" size={18} /></button>
                      )}
                      {isOwner && (
                        <button type="button" className="icon-btn" aria-label={t.save} title={dirty ? t.save : t.noChanges} disabled={busy || !dirty} onClick={() => setBox('save')}><Icon name="save" size={18} /></button>
                      )}
                      {isOwner && !wantsNew && (
                        <button type="button" className="icon-btn icon-btn-danger" aria-label={t.delete} title={t.delete} disabled={busy || content === null} onClick={() => void startDelete()}><Icon name="trash" size={18} /></button>
                      )}
                      <span className="file-sep" aria-hidden="true" />
                      <button type="button" className={`icon-btn ${panelOpen ? 'icon-btn-on' : ''}`} aria-label={t.togglePanel} title={t.togglePanel} aria-pressed={panelOpen} onClick={() => setPanelOpen((v) => !v)}><Icon name="panel" size={18} /></button>
                    </div>
                  </div>

                  {box && (
                    <form className="commit-box" onSubmit={(e) => void commit(box, e)} noValidate>
                      <h3>{box === 'delete' ? t.deleteTitle : t.commitTitle}</h3>
                      {box === 'delete' && <p className="muted">{t.deleteHelp(path)}</p>}
                      <label htmlFor="commit-message" className="sr-only">{fr.editor.commitMessage}</label>
                      <input id="commit-message" maxLength={500} placeholder={t.commitPlaceholder} aria-label={fr.editor.commitMessage} value={message} onChange={(e) => setMessage(e.target.value)} autoFocus />
                      <div className="commit-actions">
                        <button type="button" className="btn" onClick={() => { setBox(null); setMessage('') }}>{t.cancel}</button>
                        <button type="submit" className={`btn ${box === 'delete' ? 'btn-danger' : 'btn-cta'}`} disabled={busy || !message.trim()}>
                          {busy ? fr.editor.saving : box === 'delete' ? t.deleteConfirm : t.saveConfirm}
                        </button>
                      </div>
                    </form>
                  )}

                  <div className="editor-body">
                    {fileError && <p role="alert" className="alert editor-pad">{fileError}</p>}
                    {!fileError && content === null && <p className="muted editor-pad">{fr.repoViewer.loading}</p>}
                    {!fileError && content !== null && (
                      <CodeEditor path={path} value={shownText} readOnly={draft === null} onChange={(v) => setDraft((d) => (d ? { ...d, text: v } : d))} />
                    )}
                  </div>
                </section>

                {panelOpen && (
                  <aside className="panel repo-panel" aria-label={t.panelTitle}>
                    <h2>{t.panelTitle}</h2>
                    <ul className="file-tree">
                      {allFiles.map((p) => (
                        <li key={p}>
                          <Link className={`file-row ${p === path ? 'file-row-on' : ''}`} to={fileUrl(project.id, p)} onClick={guard} aria-current={p === path ? 'page' : undefined}>{p}</Link>
                        </li>
                      ))}
                    </ul>
                  </aside>
                )}
              </div>
            )}
          </>
        )}
      </main>
    </AppShell>
  )
}

