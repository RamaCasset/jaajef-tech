import { useCallback, useRef, useEffect, useMemo, useState, type FormEvent, type MouseEvent } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { CodeEditor } from '../components/CodeEditor'
import { ChangeDiff } from '../components/ChangeDiff'
import { FileSearch } from '../components/FileSearch'
import { ImagePreview } from '../components/ImagePreview'
import { ArticleBody } from '../components/ArticleBody'
import { AddMenu } from '../components/AddMenu'
import { EditorTabs } from '../components/EditorTabs'
import { FileTree } from '../components/FileTree'
import { Icon } from '../components/Icon'
import { ProjectFiles, dirUrl, fileUrl, parentOf } from '../components/ProjectFiles'
import { useAuth } from '../auth/AuthContext'
import {
  EditorError, imageMime, editorCommitTo, editorPropose, editorStatus, editorTreeOf, getProjectFull, GithubError, isViewable, listCollaborators, loadBranches, loadRepoFile, loadRepoTree,
  pullRequestUrl, type BranchList, type EditorStatus, type ProjectFull, type RepoTree,
} from '../lib/api'
import { fr } from '../i18n/fr'
import {
  MAX_SERVER_FILES, MAX_UPLOAD_BYTES, PendingError, addText, addUpload, renameFile, changeAt, discard, editText, listChanges, markedPaths, removeFile, serverFileCount, toServerFiles, type Pending,
} from '../lib/pending'

const errorText = (e: unknown) => fr.editor.errors[e instanceof EditorError ? e.code : 'unknown'] ?? fr.editor.errors.unknown
const viewError = (e: unknown) => (e instanceof GithubError ? fr.repoViewer.errors[e.code] : e instanceof EditorError ? errorText(e) : fr.repoViewer.errors.failed)

const pendingText = (e: unknown) => (e instanceof PendingError ? fr.editor.errors[e.code === 'exists' ? 'path_exists' : 'bad_request'] : errorText(e))
type Base = { head: string; branch: string }
/** A branch name made of letters, digits, dots, dashes and underscores, from whatever the member typed. */
export const slugBranch = (text: string) => text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9._-]+/g, '-').replace(/^[-._]+|[-._]+$/g, '').slice(0, 50)

export function RepoBrowser() {
  const t = fr.repoBrowser
  const { id = '' } = useParams()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
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
  const [texts, setTexts] = useState<Record<string, string>>({})
  const [fileError, setFileError] = useState<string | null>(null)
  const [pending, setPending] = useState<Pending>({})
  const [base, setBase] = useState<Base | null>(null)
  const [tabs, setTabs] = useState<string[]>([])
  const [box, setBox] = useState(false)
  const [showDiff, setShowDiff] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [folderName, setFolderName] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const pendingRef = useRef<Pending>({})
  const searchBox = useRef<HTMLInputElement>(null)
  const [previewOn, setPreviewOn] = useState(false)
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
  const [proposing, setProposing] = useState(false)
  const [proposalTitle, setProposalTitle] = useState('')
  const [proposalText, setProposalText] = useState('')
  const [proposed, setProposed] = useState<{ existed: boolean } | null>(null)

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
  pendingRef.current = pending
  const changes = useMemo(() => listChanges(pending), [pending])
  const changeCount = changes.length
  const dirty = changeCount > 0
  const treePaths = useMemo(() => new Set((tree?.entries ?? []).filter((e) => e.type === 'blob').map((e) => e.path)), [tree])
  const active = path ? changeAt(pending, path) : undefined
  const removedHere = !!path && Object.values(pending).some((c) => c.kind === 'delete' && c.path === path)
  const sourcePath = active?.from ?? path
  const original = texts[sourcePath]
  const isImg = !!path && imageMime(sourcePath) !== null
  const isMarkdown = /\.(md|markdown)$/i.test(path)
  const shownContent: string | null = active && active.kind === 'add' ? active.text ?? '' : active?.text ?? original ?? null
  const canAct = shownContent !== null || !!active || (isImg && treePaths.has(sourcePath))

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

  // A new branch or project starts from a clean state: the changes belong to the branch they were made on.
  useEffect(() => { setTexts({}); setPending({}); setBase(null); setBox(false) }, [id, branchParam])

  // Opening another file clears the old messages and adds a tab.
  useEffect(() => {
    setFileError(null); setActionError(null); setInstall(null); setNotAllowed(false); setPreviewOn(false)
    if (path) setTabs((t) => (t.includes(path) ? t : [...t, path]))
  }, [path])

  // Read the file from GitHub the first time it is opened (a new file has nothing to read).
  useEffect(() => {
    if (!project || !tree || !path || removedHere) return
    const c = changeAt(pending, path)
    if (c?.kind === 'add' || (wantsNew && !treePaths.has(path)) || imageMime(c?.from ?? path)) return
    const src = c?.from ?? path
    if (texts[src] !== undefined) return
    const entry = tree.entries.find((e) => e.path === src && e.type === 'blob')
    if (!entry) { setFileError(fr.repoViewer.errors.not_found); return }
    if (!isViewable(entry)) { setFileError(fr.repoViewer.notViewable); return }
    let alive = true
    loadRepoFile(project, tree.branch, src)
      .then((text) => { if (alive) setTexts((x) => ({ ...x, [src]: text })) })
      .catch((e) => { if (alive) setFileError(viewError(e)) })
    return () => { alive = false }
    // `pending` is read only to know where the file came from; a text edit must not read it again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, tree, path, removedHere, texts, wantsNew])

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

  // Editing starts for the whole workspace: the latest state of the branch is read once, and every change is measured against it.
  async function ensureBase(): Promise<Base | null> {
    if (base) return base
    const ctx = await prepare()
    if (!ctx) return null
    setBase(ctx)
    setDone(null)
    setTarget(canWriteHere ? 'here' : 'new')
    setNewBranch(null)
    return ctx
  }

  // A new file (from the "Nouveau fichier" button) opens straight in editing mode.
  useEffect(() => {
    if (!wantsNew || !isMember || !path || !tree || changeAt(pending, path) || treePaths.has(path)) return
    let alive = true
    void ensureBase().then((ctx) => {
      if (!alive || !ctx) return
      try { setPending((p) => (changeAt(p, path) ? p : addText(p, treePaths, path))) } catch (e) { setActionError(pendingText(e)) }
    })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantsNew, isMember, path, tree])

  // A file chosen on the project page is added here, in the folder of the file that was opened.
  useEffect(() => {
    const file = (location.state as { upload?: File } | null)?.upload
    if (!file || !isMember || !path || !tree) return
    navigate(`${location.pathname}${location.search}`, { replace: true, state: null })
    void onUpload(file)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state, isMember, path, tree])

  async function startEdit() {
    await ensureBase()
  }

  async function startDelete() {
    if (!path) return
    const ctx = await ensureBase()
    if (!ctx) return
    setPending((p) => removeFile(p, path))
  }

  async function startRename() {
    if (!path) return
    const ctx = await ensureBase()
    if (ctx) setRenaming(path)
  }

  function doRename(e: FormEvent) {
    e.preventDefault()
    if (!project || renaming === null) return
    const to = renaming.trim()
    try {
      setPending(renameFile(pending, treePaths, path, to))
      setRenaming(null)
      setActionError(null)
      if (to !== path) setTabs((tt) => tt.filter((x) => x !== path))
      if (to !== path) navigate(fileUrl(project.id, to, shownBranch), { replace: true })
    } catch (err) {
      setActionError(pendingText(err))
    }
  }

  const folderOf = (name: string) => `${dir || parentOf(path) ? `${dir || parentOf(path)}/` : ''}${name}`

  async function startFolder() {
    const ctx = await ensureBase()
    if (ctx) setFolderName(dir || parentOf(path) ? `${dir || parentOf(path)}/` : '')
  }

  function doFolder(e: FormEvent) {
    e.preventDefault()
    if (folderName === null) return
    const name = folderName.trim().replace(/\/+$/, '')
    try {
      setPending(addText(pending, treePaths, `${name}/.gitkeep`))
      setFolderName(null)
      setActionError(null)
    } catch (err) {
      setActionError(pendingText(err))
    }
  }

  async function onUpload(file: File | undefined) {
    if (!file || !project) return
    if (file.size > MAX_UPLOAD_BYTES) { setActionError(fr.editor.uploadTooBig); return }
    const ctx = await ensureBase()
    if (!ctx) return
    try {
      const data = await new Promise<string>((ok, no) => {
        const r = new FileReader()
        r.onload = () => ok(String(r.result).split(',')[1] ?? '')
        r.onerror = () => no(new Error('read'))
        r.readAsDataURL(file)
      })
      const folder = dir || parentOf(path)
      const to = `${folder ? `${folder}/` : ''}${file.name}`
      // The latest changes, read from the ref: the screen may have moved on while the file was being read.
      const next = addUpload(pendingRef.current, treePaths, to, data, file.size)
      pendingRef.current = next
      setPending(next)
      setActionError(null)
    } catch (err) {
      setActionError(err instanceof PendingError ? pendingText(err) : fr.editor.uploadFailed)
    }
  }

  function restore() {
    const c = Object.values(pending).find((x) => x.kind === 'delete' && x.path === path)
    if (c) setPending((p) => discard(p, c.key))
  }

  function onType(v: string) {
    if (!path) return
    setPending((p) => editText(p, path, v, original ?? ''))
  }

  function closeTab(closing: string) {
    if (!project) return
    const rest = tabs.filter((x) => x !== closing)
    setTabs(rest)
    if (closing !== path) return
    const next = rest[rest.length - 1]
    navigate(next ? fileUrl(project.id, next, shownBranch) : dirUrl(project.id, parentOf(closing), shownBranch))
  }

  async function commit(e: FormEvent) {
    e.preventDefault()
    if (!project || !base || !message.trim() || !dirty) return
    if (serverFileCount(pending) > MAX_SERVER_FILES) { setActionError(fr.editor.tooMany(MAX_SERVER_FILES)); return }
    setActionError(null)
    setBusy(true)
    try {
      const toNew = target === 'new' || !canWriteHere
      if (toNew && !newBranchName) { setActionError(fr.editor.errors.bad_request); return }
      const into = toNew ? newBranchName : base.branch
      const r = await editorCommitTo(project.id, { branch: into, createFrom: toNew ? base.branch : undefined, baseSha: base.head, message: message.trim(), files: toServerFiles(pending) })
      const urlBranch = into === mainBranch ? null : into
      const stillThere = path && !Object.values(pending).some((c) => c.kind === 'delete' && c.path === path) ? path : null
      const gone = new Set(Object.values(pending).filter((c) => c.kind === 'delete').map((c) => c.path))
      setPending({})
      setBase(null)
      setBox(false)
      setShowDiff(false)
      setMessage('')
      setTexts({})
      setTabs((tt) => tt.filter((x) => !gone.has(x)))
      setDone(r.html_url)
      if (toNew) setBranches((b) => (b && !b.branches.includes(into) ? { ...b, branches: [...b.branches, into] } : b))
      if (!toNew) setReload((n) => n + 1)
      if (stillThere) { if (wantsNew || toNew) navigate(fileUrl(project.id, stillThere, urlBranch), { replace: true }) }
      else navigate(dirUrl(project.id, parentOf(path), urlBranch))
    } catch (err) {
      setActionError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  // Ctrl+P (or Cmd+P) jumps to the file search, like in a code editor.
  useEffect(() => {
    if (!path) return
    const onKey = (ev: KeyboardEvent) => {
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'p') {
        ev.preventDefault()
        setPanelOpen(true)
        setTimeout(() => searchBox.current?.focus(), 0)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [path])

  // Ctrl+S (or Cmd+S) opens the save box instead of the browser's own "save page".
  useEffect(() => {
    if (!isMember || !path) return
    const onKey = (ev: KeyboardEvent) => {
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 's') {
        ev.preventDefault()
        if (dirty && !busy) setBox(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isMember, path, dirty, busy])

  async function sendProposal(e: FormEvent) {
    e.preventDefault()
    if (!project || !shownBranch || !proposalTitle.trim()) return
    setActionError(null)
    setBusy(true)
    try {
      const r = await editorPropose(project.id, { branch: shownBranch, title: proposalTitle.trim(), body: proposalText.trim() || undefined })
      setProposed({ existed: r.existed })
      setProposing(false)
      setProposalTitle('')
      setProposalText('')
    } catch (err) {
      setActionError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  const guard = (ev: MouseEvent) => { if (dirty && !window.confirm(fr.editor.leaveWarning)) ev.preventDefault() }

  const marked = useMemo(() => markedPaths([...treePaths], pending), [treePaths, pending])
  const changedPaths = useMemo(() => new Set(changes.filter((c) => c.kind !== 'delete').map((c) => c.path)), [changes])
  const removedPaths = useMemo(() => new Set(changes.filter((c) => c.kind === 'delete').map((c) => c.path)), [changes])

  const segments = (path || dir).split('/').filter(Boolean)
  const shownText = shownContent ?? ''
  const lineCount = shownContent === null ? 0 : shownText.split('\n').length
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
      {shownBranch && isMember && <button type="button" className="btn crumbs-btn" onClick={() => { setProposed(null); setProposing(true) }}>{t.propose}</button>}
      {shownBranch && !isMember && <a className="crumbs-link" href={pullRequestUrl(project.github_owner, project.github_repo, mainBranch, shownBranch)} target="_blank" rel="noopener noreferrer">{t.openPullRequest}</a>}
      {isMember && <Link className="crumbs-link" to={`/projets/${project.id}/propositions`}>{t.proposals}</Link>}
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
              {shownBranch && isMember && <> <button type="button" className="btn" onClick={() => { setProposed(null); setProposing(true) }}>{t.propose}</button></>}</div>}
            {proposed && <div className="notice" role="status">{proposed.existed ? t.proposalExists : t.proposalSent} <Link to={`/projets/${project.id}/propositions`}>{t.seeProposals}</Link></div>}
            {proposing && shownBranch && (
              <form className="panel panel-pad proposal-form" onSubmit={(e) => void sendProposal(e)} noValidate>
                <h2>{t.proposeTitle(mainBranch)}</h2>
                <p className="muted">{t.proposeHelp(shownBranch)}</p>
                <label htmlFor="proposal-title">{t.proposalTitleLabel}</label>
                <input id="proposal-title" maxLength={200} value={proposalTitle} onChange={(e) => setProposalTitle(e.target.value)} autoFocus />
                <label htmlFor="proposal-text">{t.proposalTextLabel}</label>
                <textarea id="proposal-text" rows={3} maxLength={2000} value={proposalText} onChange={(e) => setProposalText(e.target.value)} />
                <div className="commit-actions">
                  <button type="button" className="btn" onClick={() => setProposing(false)}>{t.cancel}</button>
                  <button type="submit" className="btn btn-cta" disabled={busy || !proposalTitle.trim()}>{t.proposeSend}</button>
                </div>
              </form>
            )}
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
                    <FileSearch ref={searchBox} projectId={project.id} paths={marked.paths} branch={shownBranch} canSearchText={isMember} />
                    {isMember && <input ref={fileInput} type="file" hidden aria-label={fr.editor.upload} onChange={(e) => { void onUpload(e.target.files?.[0]); e.target.value = '' }} />}
                    {folderName !== null && (
                      <form className="panel-form" onSubmit={doFolder} noValidate>
                        <label htmlFor="folder-name" className="sr-only">{fr.editor.folderLabel}</label>
                        <input id="folder-name" placeholder={fr.editor.folderLabel} value={folderName} onChange={(e) => setFolderName(e.target.value)} autoFocus />
                        <div className="panel-form-actions">
                          <button type="button" className="btn" onClick={() => setFolderName(null)}>{fr.editor.cancelShort}</button>
                          <button type="submit" className="btn btn-cta" disabled={!folderName.trim()}>{fr.editor.folderCreate}</button>
                        </div>
                      </form>
                    )}
                    <FileTree projectId={project.id} paths={marked.paths} current={path} branch={shownBranch} marks={marked.marks} />
                  </aside>
                )}
                <section className="editor-card" aria-label={path}>
                  <EditorTabs trailing={isMember ? <AddMenu busy={busy} exists={(n) => treePaths.has(folderOf(n))} onNewFile={(n) => navigate(`${fileUrl(project.id, folderOf(n), shownBranch)}&nouveau=1`)} onNewFolder={() => { setPanelOpen(true); void startFolder() }} onUpload={() => { if (!panelOpen) setPanelOpen(true); setTimeout(() => fileInput.current?.click(), 0) }} /> : undefined} tabs={tabs} active={path} changed={changedPaths} removed={removedPaths} hrefFor={(p) => fileUrl(project.id, p, shownBranch)} onClose={closeTab} />
                  <div className="file-bar">
                    <Link className="muted tiny" to={`/projets/${project.id}/historique?fichier=${encodeURIComponent(path)}`} onClick={guard}>{t.fileHistory}</Link>
                    {shownContent !== null && <span className="muted tiny">{fr.repoViewer.lines(lineCount)}</span>}
                    {isMarkdown && shownContent !== null && !removedHere && (
                      <button type="button" className="btn" aria-pressed={previewOn} onClick={() => setPreviewOn((v) => !v)}>{previewOn ? fr.editor.codeView : fr.editor.preview}</button>
                    )}
                    {dirty && <span className="muted tiny">{fr.editor.changesTitle(changeCount)}</span>}
                    <div className="file-actions">
                      {isMember && (
                        <button type="button" className={`icon-btn ${base ? 'icon-btn-on' : ''}`} aria-label={t.edit} title={t.edit} aria-pressed={base !== null} disabled={busy || base !== null || (!canAct && !removedHere)} onClick={() => void startEdit()}><Icon name="pen" size={18} /></button>
                      )}
                      {isMember && (
                        <button type="button" className="icon-btn" aria-label={t.save} title={dirty ? t.save : t.noChanges} disabled={busy || !dirty} onClick={() => setBox(true)}><Icon name="save" size={18} /></button>
                      )}
                      {isMember && (
                        <button type="button" className="btn" disabled={busy || removedHere || renaming !== null || !canAct} onClick={() => void startRename()}>{fr.editor.renameTitle}</button>
                      )}
                      {isMember && (
                        <button type="button" className="icon-btn icon-btn-danger" aria-label={t.delete} title={t.delete} disabled={busy || removedHere || !canAct} onClick={() => void startDelete()}><Icon name="trash" size={18} /></button>
                      )}
                    </div>
                  </div>

                  {renaming !== null && (
                    <form className="rename-form" onSubmit={doRename} noValidate>
                      <label htmlFor="rename-path" className="sr-only">{fr.editor.renameLabel}</label>
                      <input id="rename-path" aria-label={fr.editor.renameLabel} value={renaming} onChange={(e) => setRenaming(e.target.value)} autoFocus />
                      <button type="button" className="btn" onClick={() => setRenaming(null)}>{fr.editor.cancelShort}</button>
                      <button type="submit" className="btn btn-cta" disabled={!renaming.trim()}>{fr.editor.renameDo}</button>
                    </form>
                  )}

                  {box && (
                    <form className="commit-box" onSubmit={(e) => void commit(e)} noValidate>
                      <h3>{t.commitTitle}</h3>
                      <ul className="change-list">
                        {changes.map((c) => (
                          <li key={c.key}>
                            <code>{c.path}</code> <span className="muted tiny">{c.kind === 'add' ? fr.editor.changeNew : c.kind === 'delete' ? fr.editor.changeDeleted : c.path !== c.from ? fr.editor.changeRenamed(c.from ?? '') : fr.editor.changeEdited}</span>{' '}
                            <button type="button" className="linklike" onClick={() => setPending((p) => discard(p, c.key))}>{fr.editor.discard}</button>
                          </li>
                        ))}
                      </ul>
                      <button type="button" className="btn" aria-expanded={showDiff} onClick={() => setShowDiff((v) => !v)}>{showDiff ? fr.editor.hideChanges : fr.editor.seeChanges}</button>
                      {showDiff && <div className="change-diffs">{changes.map((c) => <ChangeDiff key={c.key} change={c} />)}</div>}
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
                        <button type="button" className="btn" onClick={() => { setBox(false); setMessage('') }}>{t.cancel}</button>
                        <button type="submit" className="btn btn-cta" disabled={busy || !message.trim() || !dirty}>
                          {busy ? fr.editor.saving : t.saveConfirm}
                        </button>
                      </div>
                    </form>
                  )}

                  <div className="editor-body">
                    {fileError && <p role="alert" className="alert editor-pad">{fileError}</p>}
                    {removedHere && (
                      <p className="editor-pad">{fr.editor.willBeDeleted} <button type="button" className="btn" onClick={restore}>{fr.editor.restoreFile}</button></p>
                    )}
                    {isImg && !removedHere && (
                      <ImagePreview projectId={project.id} owner={project.github_owner} repo={project.github_repo} isPrivate={!!project.repo_private} branch={branch} path={sourcePath} base64={active?.base64} />
                    )}
                    {!isImg && !fileError && !removedHere && shownContent === null && <p className="muted editor-pad">{fr.repoViewer.loading}</p>}
                    {!isImg && !fileError && !removedHere && shownContent !== null && previewOn && <div className="preview-body"><ArticleBody text={shownText} /></div>}
                    {!isImg && !fileError && !removedHere && shownContent !== null && !previewOn && (
                      <CodeEditor path={path} value={shownText} readOnly={base === null} onChange={onType} />
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

