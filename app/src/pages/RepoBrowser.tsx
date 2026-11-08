import { useCallback, useEffect, useMemo, useState, type FormEvent, type MouseEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { CodeEditor } from '../components/CodeEditor'
import { FileTree } from '../components/FileTree'
import { Icon } from '../components/Icon'
import { ProjectFiles, dirUrl, fileUrl, parentOf } from '../components/ProjectFiles'
import { useAuth } from '../auth/AuthContext'
import {
  EditorError, editorCommitTo, editorStatus, editorTreeOf, getProjectFull, GithubError, isViewable, listCollaborators, loadBranches, loadRepoFile, loadRepoTree,
  pullRequestUrl, type BranchList, type EditorStatus, type ProjectFull, type RepoTree,
} from '../lib/api'
import { fr } from '../i18n/fr'

const errorText = (e: unknown) => fr.editor.errors[e instanceof EditorError ? e.code : 'unknown'] ?? fr.editor.errors.unknown
const viewError = (e: unknown) => (e instanceof GithubError ? fr.repoViewer.errors[e.code] : e instanceof EditorError ? errorText(e) : fr.repoViewer.errors.failed)

type Draft = { text: string; head: string; branch: string; isNew: boolean }
/** A branch name made of letters, digits, dots, dashes and underscores, from whatever the member typed. */
export const slugBranch = (text: string) => text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9._-]+/g, '-').replace(/^[-._]+|[-._]+$/g, '').slice(0, 50)
type Box = 'save' | 'delete' | null

export function RepoBrowser() {
  const t = fr.repoBrowser
  const { id = '' } = useParams()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { member } = useAuth()
  const me = member?.profile.id ?? ''
  const username = member?.profile.username ?? ''
  const path = params.get('fichier') ?? ''
  const dir = params.get('dossier') ?? ''
  const wantsNew = params.get('nouveau') === '1'
  const branchParam = params.get('branche') || null

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
  const [isCollab, setIsCollab] = useState(false)
  const [branches, setBranches] = useState<BranchList | null>(null)
  const [target, setTarget] = useState<'here' | 'new'>('here')
  const [newBranch, setNewBranch] = useState<string | null>(null)

  const isOwner = !!project && project.owner_id === me
  const isMember = isOwner || isCollab
  const branch = tree?.branch ?? branchParam ?? ''
  // With no branch asked for, the tree is the main branch.
  const mainBranch = tree?.default_branch ?? (branchParam ? branches?.default_branch ?? '' : branch)
  const shownBranch = branch && branch !== mainBranch ? branch : null
  // The owner can save anywhere; a collaborator only on a branch that starts with their own username.
  const canWriteHere = isOwner || (!!username && branch.startsWith(`${username}/`))
  const branchPrefix = isOwner ? '' : `${username}/`
  const newBranchSlug = newBranch ?? slugBranch(message)
  const newBranchName = slugBranch(newBranchSlug) ? `${branchPrefix}${slugBranch(newBranchSlug)}` : ''
  const dirty = draft !== null && (draft.isNew || draft.text !== content)

  useEffect(() => {
    let alive = true
    setError(null)
    getProjectFull(id)
      .then(async (p) => {
        if (!p) throw new GithubError('not_found')
        const tr = await loadRepoTree(p, branchParam)
        if (alive) { setProject(p); setTree(tr) }
      })
      .catch((e) => { if (alive) setError(viewError(e)) })
    return () => { alive = false }
  }, [id, reload, branchParam])

  // Who may edit (the owner, or a collaborator) and which branches exist: conveniences, so a failure just leaves them empty.
  useEffect(() => {
    if (!project) return
    let alive = true
    listCollaborators(project.id).then((c) => { if (alive) setIsCollab(c.some((x) => x.user_id === me)) }).catch(() => undefined)
    loadBranches(project).then((b) => { if (alive) setBranches(b) }).catch(() => undefined)
    return () => { alive = false }
  }, [project, me])

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
    loadRepoFile(project, tree.branch, path)
      .then((c) => { if (alive) setContent(c) })
      .catch((e) => { if (alive) setFileError(viewError(e)) })
    return () => { alive = false }
  }, [project, tree, path, wantsNew])

  /** Asks GitHub (through the editor function) for the latest state of the branch being viewed, and checks the app is installed. */
  const prepare = useCallback(async (): Promise<{ head: string; branch: string } | null> => {
    if (!project) return null
    setActionError(null)
    setBusy(true)
    try {
      if (isOwner) {
        const s = await editorStatus()
        if (!s.installed) { setInstall(s); return null }
      }
      const tr = await editorTreeOf(project.id, branchParam)
      if (tr.head === null) { setActionError(fr.editor.emptyRepo); return null }
      setInstall(null)
      setNotAllowed(false)
      return { head: tr.head, branch: tr.branch }
    } catch (e) {
      if (isOwner && e instanceof EditorError && e.code === 'repo_not_allowed') setNotAllowed(true)
      else if (!isOwner && e instanceof EditorError && (e.code === 'not_installed' || e.code === 'repo_not_allowed')) setActionError(fr.editor.ownerMustInstall)
      else setActionError(errorText(e))
      return null
    } finally {
      setBusy(false)
    }
  }, [project, isOwner, branchParam])

  // When editing starts: save on this branch if the member may, otherwise on a new branch of their own.
  useEffect(() => { if (draft) { setTarget(canWriteHere ? 'here' : 'new'); setNewBranch(null) } }, [draft === null, canWriteHere]) // eslint-disable-line react-hooks/exhaustive-deps

  async function startEdit() {
    if (!project || content === null) return
    const ctx = await prepare()
    if (!ctx) return
    setDone(null)
    setDraft({ text: content, head: ctx.head, branch: ctx.branch, isNew: false })
  }

  // A new file (from the "Nouveau fichier" button) opens straight in editing mode.
  useEffect(() => {
    if (!wantsNew || !isMember || draft || !path) return
    let alive = true
    void prepare().then((ctx) => { if (alive && ctx) setDraft({ text: '', head: ctx.head, branch: ctx.branch, isNew: true }) })
    return () => { alive = false }
  }, [wantsNew, isMember, path, draft, prepare])

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
      const toNew = target === 'new' || !canWriteHere
      if (toNew && !newBranchName) { setActionError(fr.editor.errors.bad_request); return }
      const into = toNew ? newBranchName : draft.branch
      const r = await editorCommitTo(project.id, { branch: into, createFrom: toNew ? draft.branch : undefined, baseSha: draft.head, message: message.trim(), files: [change] })
      const urlBranch = into === mainBranch ? null : into
      if (kind === 'delete') {
        navigate(dirUrl(project.id, parentOf(path), urlBranch))
        return
      }
      setTree((tr) => (tr && !tr.entries.some((x) => x.path === path) ? { ...tr, entries: [...tr.entries, { path, type: 'blob', size: draft.text.length }] } : tr))
      setContent(draft.text)
      setDraft(null)
      setBox(null)
      setMessage('')
      setDone(r.html_url)
      if (toNew) setBranches((b) => (b && !b.branches.includes(into) ? { ...b, branches: [...b.branches, into] } : b))
      if (wantsNew || toNew) navigate(fileUrl(project.id, path, urlBranch), { replace: true })
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

  const branchOptions = useMemo(() => {
    const names = new Set<string>([...(mainBranch ? [mainBranch] : []), ...(branches?.branches ?? []), ...(branch ? [branch] : [])])
    return [...names].sort((a, b) => (a === mainBranch ? -1 : b === mainBranch ? 1 : a.localeCompare(b)))
  }, [branches, branch, mainBranch])

  function switchBranch(b: string) {
    if (!project || b === branch) return
    if (dirty && !window.confirm(fr.editor.leaveWarning)) return
    const to = b === mainBranch ? null : b
    navigate(path ? fileUrl(project.id, path, to) : dirUrl(project.id, dir, to))
  }

  const crumbsEl = project && (
    <nav className="crumbs" aria-label={fr.repoBrowser.fileBar}>
      <Link to={`/projets/${project.id}`} onClick={guard}>{project.title}</Link>
      {segments.map((s, i) => {
        const upTo = segments.slice(0, i + 1).join('/')
        const last = i === segments.length - 1
        return (
          <span key={upTo}>
            <span aria-hidden="true"> / </span>
            {last && path ? <strong>{s}</strong> : <Link to={dirUrl(project.id, upTo, shownBranch)} onClick={guard}>{s}</Link>}
          </span>
        )
      })}
      {branch && (
        <select className="branch-select" aria-label={t.branchPicker} value={branch} onChange={(e) => switchBranch(e.target.value)}>
          {branchOptions.map((b) => <option key={b} value={b}>{b === mainBranch ? `${b} (${t.mainBranch})` : b}</option>)}
        </select>
      )}
      {shownBranch && <a className="crumbs-link" href={pullRequestUrl(project.github_owner, project.github_repo, mainBranch, shownBranch)} target="_blank" rel="noopener noreferrer">{t.openPullRequest}</a>}
      <a className="crumbs-link" href={githubUrl} target="_blank" rel="noopener noreferrer">{t.openGithub}</a>
    </nav>
  )

  return (
    <AppShell>
      <main className="page repo-page">
        {error && <div className="alert" role="alert">{error} <button type="button" className="btn" onClick={() => setReload((n) => n + 1)}>{fr.repoViewer.retry}</button></div>}
        {!project && !error && <p className="muted">{fr.repoViewer.loading}</p>}

        {project && (
          <>
            {!path && crumbsEl}

            {done && <div className="notice" role="status">{fr.editor.saved} <a href={done} target="_blank" rel="noopener noreferrer">{fr.editor.seeCommit}</a>
              {shownBranch && <> <a href={pullRequestUrl(project.github_owner, project.github_repo, mainBranch, shownBranch)} target="_blank" rel="noopener noreferrer">{t.openPullRequest}</a></>}</div>}
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

            {!path && <ProjectFiles project={project} dir={dir} canEdit={isMember} tree={tree} branch={shownBranch} />}

            {path && (
              <div className="workspace">
                <div className="workspace-top">
                  <button type="button" className={`icon-btn ${panelOpen ? 'icon-btn-on' : ''}`} aria-label={t.togglePanel} title={t.togglePanel} aria-pressed={panelOpen} onClick={() => setPanelOpen((v) => !v)}><Icon name="sidebar" size={18} /></button>
                  {crumbsEl}
                </div>
                <div className={`workspace-body ${panelOpen ? 'workspace-body-panel' : ''}`}>
                {panelOpen && (
                  <aside className="repo-panel" aria-label={t.panelTitle}>
                    <div className="repo-panel-head">
                      <h2>{t.panelTitle}</h2>
                      <button type="button" className="icon-btn icon-btn-small" aria-label={t.hidePanel} title={t.hidePanel} onClick={() => setPanelOpen(false)}><Icon name="chevron-left" size={16} /></button>
                    </div>
                    <FileTree projectId={project.id} paths={allFiles} current={path} branch={shownBranch} onNavigate={guard} />
                  </aside>
                )}
                <section className="editor-card" aria-label={path}>
                  <div className="file-bar">
                    <Link className="muted tiny" to={`/projets/${project.id}/historique?fichier=${encodeURIComponent(path)}`} onClick={guard}>{t.fileHistory}</Link>
                    {content !== null && <span className="muted tiny">{fr.repoViewer.lines(lineCount)}</span>}
                    <div className="file-actions">
                      {isMember && !wantsNew && (
                        <button type="button" className={`icon-btn ${draft ? 'icon-btn-on' : ''}`} aria-label={t.edit} title={t.edit} aria-pressed={draft !== null} disabled={busy || content === null || draft !== null} onClick={() => void startEdit()}><Icon name="pen" size={18} /></button>
                      )}
                      {isMember && (
                        <button type="button" className="icon-btn" aria-label={t.save} title={dirty ? t.save : t.noChanges} disabled={busy || !dirty} onClick={() => setBox('save')}><Icon name="save" size={18} /></button>
                      )}
                      {isMember && !wantsNew && (
                        <button type="button" className="icon-btn icon-btn-danger" aria-label={t.delete} title={t.delete} disabled={busy || content === null} onClick={() => void startDelete()}><Icon name="trash" size={18} /></button>
                      )}
                    </div>
                  </div>

                  {box && (
                    <form className="commit-box" onSubmit={(e) => void commit(box, e)} noValidate>
                      <h3>{box === 'delete' ? t.deleteTitle : t.commitTitle}</h3>
                      {box === 'delete' && <p className="muted">{t.deleteHelp(path)}</p>}
                      <label htmlFor="commit-message" className="sr-only">{fr.editor.commitMessage}</label>
                      <input id="commit-message" maxLength={500} placeholder={t.commitPlaceholder} aria-label={fr.editor.commitMessage} value={message} onChange={(e) => setMessage(e.target.value)} autoFocus />
                      <fieldset className="commit-target">
                        <legend className="sr-only">{t.saveWhere}</legend>
                        {canWriteHere && (
                          <label><input type="radio" name="commit-target" checked={target === 'here'} onChange={() => setTarget('here')} /> {t.saveHere(branch)}</label>
                        )}
                        <label><input type="radio" name="commit-target" checked={target === 'new' || !canWriteHere} onChange={() => setTarget('new')} /> {t.saveNew}</label>
                        {(target === 'new' || !canWriteHere) && (
                          <div className="branch-name">
                            {branchPrefix && <span className="branch-prefix">{branchPrefix}</span>}
                            <input aria-label={t.newBranchName} placeholder={t.newBranchPlaceholder} maxLength={50} value={newBranchSlug} onChange={(e) => setNewBranch(e.target.value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-'))} />
                          </div>
                        )}
                        {!isOwner && !canWriteHere && <p className="muted tiny">{t.collabHint}</p>}
                      </fieldset>
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

                </div>
              </div>
            )}
          </>
        )}
      </main>
    </AppShell>
  )
}

