import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { useAuth } from '../auth/AuthContext'
import {
  connectGithub, EditorError, editorAdopt, editorRepos, editorStatus, GithubError, linkGithubAccount, listMyProjects, listPublicRepos, publishProject,
  type EditorRepo, type EditorStatus, type GithubRepo, type MyProject,
} from '../lib/api'
import { friendlyError } from '../lib/errors'
import { fr } from '../i18n/fr'

type Phase = 'checking' | 'connect' | 'loading' | 'ready' | 'failed'
type Mode = 'import' | 'create'
type PrivateState = { status: 'loading' } | { status: 'not_installed'; installUrl: string } | { status: 'unavailable' } | { status: 'ready'; repos: EditorRepo[] }

const REPO_NAME = /^[A-Za-z0-9._-]{1,100}$/

function githubMessage(e: unknown): string {
  if (e instanceof GithubError) return fr.importProject.githubErrors[e.code]
  return friendlyError(e)
}

export function ImportProject() {
  const { member, refreshMember } = useAuth()
  const userId = member?.profile.id ?? ''
  const githubName = member?.profile.github_username ?? null
  const [phase, setPhase] = useState<Phase>(githubName ? 'loading' : 'checking')
  const [repos, setRepos] = useState<GithubRepo[]>([])
  const [mine, setMine] = useState<MyProject[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busyRepo, setBusyRepo] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [reload, setReload] = useState(0)
  const [mode, setMode] = useState<Mode>('import')
  const [priv, setPriv] = useState<PrivateState>({ status: 'loading' })
  const [newName, setNewName] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [newVisibility, setNewVisibility] = useState<'public' | 'private'>('public')
  const [created, setCreated] = useState(false)
  const triedLink = useRef(false)

  // Coming back from GitHub (or opening the page while already connected on GitHub's side), the profile may not have the
  // name yet: ask the database to copy it from the verified login. Tried once per visit.
  useEffect(() => {
    if (githubName || triedLink.current) return
    triedLink.current = true
    linkGithubAccount()
      .then(() => refreshMember())
      .catch(() => setPhase('connect'))
  }, [githubName, refreshMember])

  useEffect(() => {
    if (!githubName || !userId) return
    let alive = true
    setPhase('loading')
    setError(null)
    Promise.all([listPublicRepos(githubName), listMyProjects(userId)])
      .then(([list, own]) => { if (alive) { setRepos(list); setMine(own); setPhase('ready') } })
      .catch((e) => { if (alive) { setError(githubMessage(e)); setPhase('failed') } })
    return () => { alive = false }
  }, [githubName, userId, reload])

  // The private repositories come from the GitHub app, not from GitHub's public list.
  useEffect(() => {
    if (!githubName) return
    let alive = true
    setPriv({ status: 'loading' })
    editorStatus()
      .then(async (st: EditorStatus) => {
        if (!st.installed) { if (alive) setPriv({ status: 'not_installed', installUrl: st.install_url }); return }
        const { repos: list } = await editorRepos()
        if (alive) setPriv({ status: 'ready', repos: list.filter((r) => r.private) })
      })
      .catch(() => { if (alive) setPriv({ status: 'unavailable' }) })
    return () => { alive = false }
  }, [githubName, reload])

  async function onConnect() {
    setConnecting(true)
    setError(null)
    try {
      await connectGithub()
    } catch (e) {
      setError(friendlyError(e))
      setConnecting(false)
    }
  }

  const add = useCallback(async (repo: GithubRepo) => {
    if (!githubName || !userId) return
    setBusyRepo(repo.name)
    setError(null)
    setNotice(null)
    try {
      const summary = repo.description ? repo.description.slice(0, 300) : null
      await publishProject(`https://github.com/${githubName}/${repo.name}`, repo.name, summary)
      setMine(await listMyProjects(userId))
      setNotice(fr.importProject.justAdded)
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setBusyRepo(null)
    }
  }, [githubName, userId])

  const addPrivate = useCallback(async (repo: EditorRepo) => {
    if (!userId) return
    setBusyRepo(repo.name)
    setError(null)
    setNotice(null)
    try {
      await editorAdopt(repo.name, repo.name, null)
      setMine(await listMyProjects(userId))
      setNotice(fr.importProject.justAddedPrivate)
    } catch (e) {
      setError(e instanceof EditorError ? (fr.importProject.privateErrors[e.code] ?? fr.importProject.privateErrors.unknown) : friendlyError(e))
    } finally {
      setBusyRepo(null)
    }
  }, [userId])

  const t = fr.importProject
  const newNameOk = REPO_NAME.test(newName)
  const createUrl = `https://github.com/new?${new URLSearchParams({ name: newName, description: newDescription, visibility: newVisibility }).toString()}`
  const listed = new Map(mine.map((p) => [p.github_repo.toLowerCase(), p]))

  return (
    <AppShell>
      <main className="page import-page">
        <div>
          <Link className="btn" to="/projets">{t.back}</Link>
        </div>
        <header className="page-head">
          <h1 className="page-title">{t.title}</h1>
          <p className="muted">{t.subtitle}</p>
        </header>

        <div role="tablist" className="souk-tabs" aria-label={t.modeLabel}>
          {(['import', 'create'] as Mode[]).map((m) => (
            <button key={m} type="button" role="tab" aria-selected={mode === m} className={`pill ${mode === m ? 'pill-on' : ''}`} onClick={() => setMode(m)}>{t.modes[m]}</button>
          ))}
        </div>

        {error ? <p role="alert" className="alert">{error}{phase === 'failed' ? <> <button type="button" className="btn" onClick={() => setReload((n) => n + 1)}>{t.retry}</button></> : null}</p> : null}
        {notice ? <p role="status" className="notice">{notice}</p> : null}

        {phase === 'checking' ? <p className="muted">{t.checking}</p> : null}

        {phase === 'connect' ? (
          <section className="panel import-connect">
            <h2>{t.connectTitle}</h2>
            <p className="muted">{t.connectText}</p>
            <button type="button" className="btn btn-cta" disabled={connecting} onClick={() => void onConnect()}>{connecting ? t.connecting : t.connect}</button>
          </section>
        ) : null}

        {githubName ? <p className="muted">{t.connectedAs(githubName)}</p> : null}

        {githubName && mode === 'create' ? (
          <section className="panel import-create">
            <h2>{t.createTitle}</h2>
            <p className="muted">{t.createText}</p>
            <div className="field">
              <label htmlFor="n-name">{t.newName}</label>
              <input id="n-name" value={newName} maxLength={100} onChange={(e) => { setNewName(e.target.value); setCreated(false) }} />
              {newName && !newNameOk ? <p className="tiny muted">{t.newNameHint}</p> : null}
            </div>
            <div className="field">
              <label htmlFor="n-desc">{t.newDescription}</label>
              <input id="n-desc" value={newDescription} maxLength={300} onChange={(e) => setNewDescription(e.target.value)} />
            </div>
            <fieldset className="field">
              <legend>{t.newVisibility}</legend>
              <label><input type="radio" name="n-vis" checked={newVisibility === 'public'} onChange={() => setNewVisibility('public')} /> {t.visPublic}</label>
              <label><input type="radio" name="n-vis" checked={newVisibility === 'private'} onChange={() => setNewVisibility('private')} /> {t.visPrivate}</label>
              <p className="tiny muted">{newVisibility === 'public' ? t.visPublicHint : t.visPrivateHint}</p>
            </fieldset>
            <p>
              {newNameOk
                ? <a className="btn btn-cta" href={createUrl} target="_blank" rel="noopener noreferrer" onClick={() => setCreated(true)}>{t.createOnGithub}</a>
                : <button type="button" className="btn btn-cta" disabled>{t.createOnGithub}</button>}
            </p>
            {created ? (
              <p role="status" className="notice">
                {newVisibility === 'private' ? t.afterCreatePrivate : t.afterCreatePublic}{' '}
                <button type="button" className="btn" onClick={() => { setMode('import'); setReload((n) => n + 1) }}>{t.afterCreateDone}</button>
              </p>
            ) : null}
          </section>
        ) : null}

        {mode === 'import' && phase === 'loading' ? <p className="muted">{t.loadingRepos}</p> : null}

        {mode === 'import' && phase === 'ready' ? (
          <>
            <h2 className="import-section">{t.publicTitle}</h2>
            <p className="muted">{t.publicOnly}</p>
            {repos.length === 0 ? <p className="muted">{t.noRepos}</p> : (
              <ul className="repo-list">
                {repos.map((r) => {
                  const own = listed.get(r.name.toLowerCase())
                  return (
                    <li key={r.name} className="panel repo-row">
                      <div className="repo-main">
                        <h3>{r.name}</h3>
                        {r.description ? <p className="muted">{r.description}</p> : null}
                        <div className="project-tags">
                          {r.language ? <span className="tag">{r.language}</span> : null}
                          {r.fork ? <span className="tag">{t.fork}</span> : null}
                          {r.archived ? <span className="tag">{t.archived}</span> : null}
                          <span className="tag">{t.stars(r.stargazers_count)}</span>
                        </div>
                      </div>
                      {own ? <span className="tag">{own.verified_at ? t.confirmed : t.pending}</span> : (
                        <button type="button" className="btn" disabled={busyRepo !== null} aria-label={`${t.add} : ${r.name}`} onClick={() => void add(r)}>
                          {busyRepo === r.name ? t.adding : t.add}
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}

            <h2 className="import-section">{t.privateTitle}</h2>
            {priv.status === 'loading' ? <p className="muted">{t.loadingPrivate}</p> : null}
            {priv.status === 'unavailable' ? <p className="muted">{t.privateUnavailable}</p> : null}
            {priv.status === 'not_installed' ? (
              <section className="panel">
                <p className="muted">{t.privateInstallText}</p>
                <p>
                  <a className="btn btn-cta" href={priv.installUrl} target="_blank" rel="noopener noreferrer">{t.privateInstall}</a>{' '}
                  <button type="button" className="btn" onClick={() => setReload((n) => n + 1)}>{t.privateRefresh}</button>
                </p>
              </section>
            ) : null}
            {priv.status === 'ready' ? (
              <>
                <p className="muted">{t.privateText}</p>
                {priv.repos.length === 0 ? (
                  <p className="muted">{t.privateNone} <button type="button" className="btn" onClick={() => setReload((n) => n + 1)}>{t.privateRefresh}</button></p>
                ) : (
                  <ul className="repo-list">
                    {priv.repos.map((r) => {
                      const own = listed.get(r.name.toLowerCase())
                      return (
                        <li key={r.name} className="panel repo-row">
                          <div className="repo-main">
                            <h3>{r.name}</h3>
                            <div className="project-tags"><span className="tag">{t.private}</span></div>
                          </div>
                          {own ? <span className="tag">{t.listed}</span> : (
                            <button type="button" className="btn" disabled={busyRepo !== null} aria-label={`${t.add} : ${r.name}`} onClick={() => void addPrivate(r)}>
                              {busyRepo === r.name ? t.adding : t.add}
                            </button>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}
                <p className="tiny muted">{t.privateMore} <a href={`https://github.com/settings/installations`} target="_blank" rel="noopener noreferrer">{t.privateManage}</a></p>
              </>
            ) : null}
          </>
        ) : null}
      </main>
    </AppShell>
  )
}
