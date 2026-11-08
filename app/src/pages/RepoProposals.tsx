import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { useAuth } from '../auth/AuthContext'
import { dateLocale } from '../i18n/lang'
import { fr } from '../i18n/fr'
import {
  EditorError, editorCloseProposal, editorMergeProposal, editorProposals, getProjectFull, GithubError,
  type Proposal, type ProjectFull,
} from '../lib/api'

type Ask = { number: number; kind: 'merge' | 'close' } | null

/** The open proposals of a project: the owner merges or declines them, a collaborator can withdraw their own. */
export function RepoProposals() {
  const t = fr.proposals
  const { id = '' } = useParams()
  const { member } = useAuth()
  const username = member?.profile.username ?? ''
  const [project, setProject] = useState<ProjectFull | null>(null)
  const [pulls, setPulls] = useState<Proposal[] | null>(null)
  const [mainBranch, setMainBranch] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [needsPermission, setNeedsPermission] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [conflict, setConflict] = useState<Proposal | null>(null)
  const [warn, setWarn] = useState<string | null>(null)
  const [ask, setAsk] = useState<Ask>(null)
  const [busy, setBusy] = useState(false)
  const [reload, setReload] = useState(0)
  const isOwner = !!project && project.owner_id === member?.profile.id

  const failure = useCallback((e: unknown) => {
    if (e instanceof EditorError && e.code === 'pulls_permission_missing') { setNeedsPermission(true); return }
    setError(e instanceof EditorError ? fr.editor.errors[e.code] ?? t.failed : e instanceof GithubError ? fr.repoViewer.errors[e.code] : t.failed)
  }, [t.failed])

  useEffect(() => {
    let alive = true
    setNeedsPermission(false)
    getProjectFull(id)
      .then(async (p) => {
        if (!p) throw new GithubError('not_found')
        if (alive) setProject(p)
        const r = await editorProposals(p.id)
        if (alive) { setError(null); setPulls(r.pulls); setMainBranch(r.default_branch) }
      })
      .catch((e) => { if (alive) failure(e) })
    return () => { alive = false }
  }, [id, reload, failure])

  async function run(p: Proposal, kind: 'merge' | 'close') {
    if (!project) return
    setBusy(true)
    setError(null)
    setNotice(null)
    setConflict(null)
    setWarn(null)
    try {
      if (kind === 'merge') await editorMergeProposal(project.id, p.number, p.sha)
      else await editorCloseProposal(project.id, p.number)
      setPulls((list) => (list ?? []).filter((x) => x.number !== p.number))
      setNotice(kind === 'merge' ? t.merged(mainBranch) : t.closed)
    } catch (e) {
      if (e instanceof EditorError && e.code === 'not_mergeable') setConflict(p)
      else if (e instanceof EditorError && (e.code === 'branch_moved' || e.code === 'pr_not_found')) { setWarn(fr.editor.errors[e.code === 'branch_moved' ? 'proposal_moved' : 'pr_not_found']); setReload((n) => n + 1) }
      else failure(e)
    } finally {
      setBusy(false)
      setAsk(null)
    }
  }

  return (
    <AppShell>
      <main className="page history-page">
        <p><Link to={project ? `/projets/${project.id}` : '/projets'}>← {t.back}</Link></p>
        <h1 className="page-title">{t.title}</h1>
        {project && <p className="muted">{project.title}</p>}
        {error && <div className="alert" role="alert">{error} <button type="button" className="btn" onClick={() => setReload((n) => n + 1)}>{t.retry}</button></div>}
        {needsPermission && (
          <section className="panel panel-pad" role="alert">
            <h2>{t.permissionTitle}</h2>
            <p>{isOwner ? t.permissionOwner : t.permissionMember}</p>
            {isOwner && <p><a className="btn btn-cta" href="https://github.com/settings/installations" target="_blank" rel="noopener noreferrer">{fr.editor.manage}</a></p>}
          </section>
        )}
        {warn && <div className="alert" role="alert">{warn}</div>}
        {notice && <div className="notice" role="status">{notice}</div>}
        {conflict && <div className="alert" role="alert">{t.conflict(mainBranch)} <a href={conflict.url} target="_blank" rel="noopener noreferrer">{t.openOnGithub}</a></div>}
        {pulls && pulls.length === 0 && !error && <p className="muted">{t.empty}</p>}
        {!pulls && !error && !needsPermission && <p className="muted">{t.loading}</p>}
        {pulls && pulls.length > 0 && (
          <ol className="panel history-list proposal-list">
            {pulls.map((p) => {
              const mine = !!username && p.author === username
              const asked = ask?.number === p.number ? ask.kind : null
              return (
                <li key={p.number}>
                  <div className="history-main">
                    <strong>{p.title}</strong>
                    <span className="muted tiny">
                      {t.by(p.author)} · {p.created_at ? new Date(p.created_at).toLocaleDateString(dateLocale(), { day: 'numeric', month: 'long', year: 'numeric' }) : ''} · <code>{p.branch}</code>
                    </span>
                    {asked && (
                      <span className="proposal-confirm" role="group" aria-label={asked === 'merge' ? t.mergeConfirm(mainBranch) : t.closeConfirm}>
                        <span>{asked === 'merge' ? t.mergeConfirm(mainBranch) : t.closeConfirm}</span>
                        <button type="button" className={`btn ${asked === 'merge' ? 'btn-cta' : 'btn-danger'}`} disabled={busy} onClick={() => void run(p, asked)}>{asked === 'merge' ? t.mergeYes : t.closeYes}</button>
                        <button type="button" className="btn" disabled={busy} onClick={() => setAsk(null)}>{t.cancel}</button>
                      </span>
                    )}
                  </div>
                  <span className="history-side">
                    <a className="tiny" href={`${p.url}/files`} target="_blank" rel="noopener noreferrer">{t.seeChanges}</a>
                    {isOwner && !asked && <button type="button" className="btn btn-cta" onClick={() => setAsk({ number: p.number, kind: 'merge' })}>{t.merge}</button>}
                    {(isOwner || mine) && !asked && <button type="button" className="btn" onClick={() => setAsk({ number: p.number, kind: 'close' })}>{isOwner && !mine ? t.decline : t.withdraw}</button>}
                  </span>
                </li>
              )
            })}
          </ol>
        )}
      </main>
    </AppShell>
  )
}
