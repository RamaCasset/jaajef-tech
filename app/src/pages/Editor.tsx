import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { CodeEditor } from '../components/CodeEditor'
import { useAuth } from '../auth/AuthContext'
import {
  EditorError, editorCommit, editorFile, editorStatus, editorTree, getProjectFull, isViewable,
  type EditorStatus, type EditorTree, type FileChange, type ProjectFull,
} from '../lib/api'
import { fr } from '../i18n/fr'

type Edit = { content: string; isNew?: boolean; deleted?: boolean }
type Phase = 'loading' | 'not_owner' | 'install' | 'not_allowed' | 'ready' | 'failed'

const errorText = (e: unknown) => fr.editor.errors[e instanceof EditorError ? e.code : 'unknown'] ?? fr.editor.errors.unknown
const validName = (p: string) => p.length > 0 && p.length <= 200 && !p.startsWith('/') && !p.endsWith('/') && !p.includes('\\')
  && p.split('/').every((x) => x !== '' && x !== '.' && x !== '..' && x.toLowerCase() !== '.git')

export function Editor() {
  const t = fr.editor
  const { id = '' } = useParams()
  const { member } = useAuth()
  const me = member?.profile.id ?? ''
  const [phase, setPhase] = useState<Phase>('loading')
  const [project, setProject] = useState<ProjectFull | null>(null)
  const [status, setStatus] = useState<EditorStatus | null>(null)
  const [tree, setTree] = useState<EditorTree | null>(null)
  const [originals, setOriginals] = useState<Record<string, string>>({})
  const [edits, setEdits] = useState<Record<string, Edit>>({})
  const [tabs, setTabs] = useState<string[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState<{ url: string } | null>(null)
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [nameError, setNameError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let alive = true
    setPhase('loading')
    setError(null)
    ;(async () => {
      try {
        const p = await getProjectFull(id)
        if (!alive) return
        if (!p || p.owner_id !== me) { setPhase('not_owner'); return }
        setProject(p)
        const s = await editorStatus()
        if (!alive) return
        setStatus(s)
        if (!s.installed) { setPhase('install'); return }
        const tr = await editorTree(p.github_repo)
        if (!alive) return
        setTree(tr)
        setPhase('ready')
      } catch (e) {
        if (!alive) return
        if (e instanceof EditorError && e.code === 'repo_not_allowed') setPhase('not_allowed')
        else { setError(errorText(e)); setPhase('failed') }
      }
    })()
    return () => { alive = false }
  }, [id, me, reload])

  const changes = useMemo<FileChange[]>(() => {
    const out: FileChange[] = []
    for (const [path, e] of Object.entries(edits)) {
      if (e.deleted) out.push({ path, delete: true })
      else if (e.isNew) out.push({ path, content: e.content })
      else if (e.content !== originals[path]) out.push({ path, content: e.content })
    }
    return out.sort((a, b) => a.path.localeCompare(b.path))
  }, [edits, originals])

  useEffect(() => {
    if (changes.length === 0) return
    const warn = (ev: BeforeUnloadEvent) => { ev.preventDefault(); ev.returnValue = t.leaveWarning }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [changes.length, t.leaveWarning])

  const entries = useMemo(() => {
    const files = new Map<string, { size: number }>()
    for (const e of tree?.entries ?? []) if (e.type === 'blob') files.set(e.path, { size: e.size })
    for (const [p, e] of Object.entries(edits)) if (e.isNew) files.set(p, { size: 0 })
    return [...files.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [tree, edits])

  const open = useCallback(async (path: string) => {
    if (!project || !tree) return
    setFileError(null)
    setTabs((x) => (x.includes(path) ? x : [...x, path]))
    setActive(path)
    if (edits[path]?.isNew || path in originals) return
    const entry = tree.entries.find((e) => e.path === path)
    if (!entry || !isViewable(entry)) { setFileError(t.cannotShow); return }
    try {
      const f = await editorFile(project.github_repo, path, tree.head ?? tree.branch)
      setOriginals((o) => ({ ...o, [path]: f.content }))
    } catch (e) {
      setFileError(errorText(e))
    }
  }, [project, tree, edits, originals, t.cannotShow])

  function closeTab(path: string) {
    setTabs((x) => x.filter((p) => p !== path))
    if (active === path) { const left = tabs.filter((p) => p !== path); setActive(left.length > 0 ? left[left.length - 1] : null) }
  }

  const current = (path: string) => (edits[path] ? edits[path].content : originals[path])

  function change(path: string, content: string) {
    setDone(null)
    setEdits((all) => ({ ...all, [path]: { ...all[path], content } }))
  }

  function addFile() {
    const name = newName.trim()
    if (!validName(name)) { setNameError(t.badName); return }
    if (entries.some(([p]) => p === name) && !edits[name]?.deleted) { setNameError(t.exists); return }
    setEdits((all) => ({ ...all, [name]: { content: '', isNew: true } }))
    setTabs((x) => (x.includes(name) ? x : [...x, name]))
    setActive(name)
    setAdding(false)
    setNewName('')
    setNameError(null)
    setDone(null)
  }

  function toggleDelete(path: string) {
    setDone(null)
    setEdits((all) => {
      const e = all[path]
      if (e?.deleted) { const { deleted, ...rest } = e; void deleted; return { ...all, [path]: rest } }
      if (e?.isNew) { const { [path]: gone, ...rest } = all; void gone; return rest }
      return { ...all, [path]: { content: e?.content ?? originals[path] ?? '', deleted: true } }
    })
    if (edits[path]?.isNew) closeTab(path)
  }

  function revert(path: string) {
    setEdits((all) => { const { [path]: gone, ...rest } = all; void gone; return rest })
  }

  async function save() {
    if (!project || !tree || !tree.head) return
    setError(null)
    setSaving(true)
    try {
      const r = await editorCommit(project.github_repo, tree.branch, tree.head, message.trim(), changes)
      setOriginals((o) => {
        const next = { ...o }
        for (const c of changes) { if (c.delete) delete next[c.path]; else next[c.path] = c.content ?? '' }
        return next
      })
      setTree((tr) => {
        if (!tr) return tr
        const gone = new Set(changes.filter((c) => c.delete).map((c) => c.path))
        const kept = tr.entries.filter((e) => !gone.has(e.path))
        const have = new Set(kept.map((e) => e.path))
        for (const c of changes) if (!c.delete && !have.has(c.path)) kept.push({ path: c.path, type: 'blob', size: (c.content ?? '').length })
        return { ...tr, head: r.commit_sha, entries: kept }
      })
      setTabs((x) => x.filter((p) => !changes.some((c) => c.delete && c.path === p)))
      if (active && changes.some((c) => c.delete && c.path === active)) setActive(null)
      setEdits({})
      setMessage('')
      setDone({ url: r.html_url })
    } catch (e) {
      setError(errorText(e))
    } finally {
      setSaving(false)
    }
  }

  const badge = (path: string) => {
    const e = edits[path]
    if (!e) return null
    if (e.deleted) return t.removed
    if (e.isNew) return t.added
    return e.content !== originals[path] ? t.modified : null
  }

  return (
    <AppShell>
      <main className="page">
        <p><Link to={`/projets/${id}`}>← {t.back}</Link></p>
        <header className="page-head">
          <h1 className="page-title">{t.title}{project ? ` : ${project.title}` : ''}</h1>
          {tree && <p className="muted">{t.branch(tree.branch)}</p>}
        </header>

        {phase === 'loading' && <p className="muted">{t.loading}</p>}
        {phase === 'not_owner' && <div className="alert" role="alert">{t.notOwner}</div>}
        {phase === 'failed' && (
          <div className="alert" role="alert">
            {error}{' '}
            {error !== t.errors.github_not_linked && <button type="button" className="btn" onClick={() => setReload((n) => n + 1)}>{t.retry}</button>}
          </div>
        )}

        {phase === 'install' && status && (
          <section className="panel">
            <h2>{t.installTitle}</h2>
            <p>{t.installText}</p>
            <p>
              <a className="btn btn-cta" href={status.install_url} target="_blank" rel="noopener noreferrer">{t.install}</a>{' '}
              <button type="button" className="btn" onClick={() => setReload((n) => n + 1)}>{t.installed}</button>
            </p>
          </section>
        )}

        {phase === 'not_allowed' && status && (
          <section className="panel">
            <h2>{t.notAllowedTitle}</h2>
            <p>{t.notAllowedText}</p>
            <p>
              <a className="btn btn-cta" href="https://github.com/settings/installations" target="_blank" rel="noopener noreferrer">{t.manage}</a>{' '}
              <button type="button" className="btn" onClick={() => setReload((n) => n + 1)}>{t.installed}</button>
            </p>
          </section>
        )}

        {phase === 'ready' && tree && (
          <>
            {tree.head === null && <p className="muted">{t.emptyRepo}</p>}
            {tree.head !== null && (
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 1fr) 3fr', gap: 16 }}>
                <nav aria-label={t.files}>
                  <h2>{t.files}</h2>
                  <p>
                    {adding ? (
                      <>
                        <input aria-label={t.newFileName} placeholder={t.newFileName} value={newName} onChange={(e) => setNewName(e.target.value)} />
                        <button type="button" className="btn btn-cta" onClick={addFile}>{t.createFile}</button>{' '}
                        <button type="button" className="btn" onClick={() => { setAdding(false); setNameError(null) }}>{t.cancel}</button>
                        {nameError && <span role="alert" className="alert">{nameError}</span>}
                      </>
                    ) : <button type="button" className="btn" onClick={() => setAdding(true)}>{t.newFile}</button>}
                  </p>
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0, maxHeight: 460, overflow: 'auto' }}>
                    {entries.map(([path]) => (
                      <li key={path}>
                        <button
                          type="button"
                          className={`btn ${active === path ? 'btn-cta' : ''}`}
                          style={{ width: '100%', textAlign: 'left', textDecoration: edits[path]?.deleted ? 'line-through' : undefined }}
                          aria-pressed={active === path}
                          onClick={() => void open(path)}
                        >{path}{badge(path) ? ` (${badge(path)})` : ''}</button>
                      </li>
                    ))}
                  </ul>
                </nav>

                <section aria-label={t.editorLabel}>
                  <div role="tablist" aria-label={t.openTabs} style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {tabs.map((p) => (
                      <span key={p} className="tag">
                        <button type="button" role="tab" aria-selected={active === p} className="btn" onClick={() => setActive(p)}>{p}</button>
                        <button type="button" className="btn" aria-label={t.closeTab(p)} onClick={() => closeTab(p)}>×</button>
                      </span>
                    ))}
                  </div>
                  {!active && <p className="muted">{t.noFile}</p>}
                  {fileError && <p role="alert" className="alert">{fileError}</p>}
                  {active && !fileError && current(active) === undefined && <p className="muted">{t.loading}</p>}
                  {active && !fileError && current(active) !== undefined && !edits[active]?.deleted && (
                    <CodeEditor path={active} value={current(active) as string} onChange={(v) => change(active, v)} />
                  )}
                  {active && (
                    <p>
                      <button type="button" className="btn" onClick={() => toggleDelete(active)}>
                        {edits[active]?.deleted ? t.restoreFile : t.deleteFile}
                      </button>{' '}
                      {edits[active] && !edits[active].isNew && !edits[active].deleted && (
                        <button type="button" className="btn" onClick={() => revert(active)}>{t.revert}</button>
                      )}
                    </p>
                  )}
                </section>
              </div>
            )}

            <section className="panel" style={{ marginTop: 16 }} aria-label={t.commit}>
              <p>{t.changes(changes.length)}</p>
              {done && <div className="notice" role="status">{t.saved} <a href={done.url} target="_blank" rel="noopener noreferrer">{t.seeCommit}</a></div>}
              {error && <div className="alert" role="alert">{error}</div>}
              <div className="field">
                <label htmlFor="commit-message">{t.commitMessage}</label>
                <input id="commit-message" maxLength={500} value={message} onChange={(e) => setMessage(e.target.value)} />
              </div>
              <button type="button" className="btn btn-cta" disabled={saving || changes.length === 0 || message.trim().length === 0 || tree.head === null} onClick={() => void save()}>
                {saving ? t.saving : t.commit}
              </button>
            </section>
          </>
        )}
      </main>
    </AppShell>
  )
}
