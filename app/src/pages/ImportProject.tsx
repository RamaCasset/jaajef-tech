import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { useAuth } from '../auth/AuthContext'
import {
  connectGithub, GithubError, linkGithubAccount, listMyProjects, listPublicRepos, publishProject,
  type GithubRepo, type MyProject,
} from '../lib/api'
import { friendlyError } from '../lib/errors'
import { fr } from '../i18n/fr'

type Phase = 'checking' | 'connect' | 'loading' | 'ready' | 'failed'

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

  const t = fr.importProject
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
        {phase === 'loading' ? <p className="muted">{t.loadingRepos}</p> : null}

        {phase === 'ready' ? (
          <>
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
          </>
        ) : null}
      </main>
    </AppShell>
  )
}
