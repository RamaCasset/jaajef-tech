import { dateLocale } from '../i18n/lang'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { MemberSuggest } from '../components/MemberSuggest'
import { ProjectFiles } from '../components/ProjectFiles'
import { ProjectShowcase } from '../components/ProjectShowcase'
import { Icon } from '../components/Icon'
import { ReportButton } from '../components/ReportButton'
import { useAuth } from '../auth/AuthContext'
import { fr } from '../i18n/fr'
import { friendlyError } from '../lib/errors'
import {
  cancelCollabInvite, decideCollabRequest, inviteCollaborator, listProjectInvites, deleteProjectComment, getProjectFull, listCollabRequests, listCollaborators, listProjectComments,
  postProjectComment, removeCollaborator, requestCollaboration, starProject, unstarProject, withdrawCollabRequest,
  type CollabRequest, type Collaborator, type ProjectInvite, type ProjectComment, type ProjectFull,
} from '../lib/api'

export function ProjectPage() {
  const { id = '' } = useParams()
  const { member } = useAuth()
  const me = member?.profile.id ?? ''
  const [project, setProject] = useState<ProjectFull | null | undefined>(undefined)
  const [comments, setComments] = useState<ProjectComment[]>([])
  const [collabs, setCollabs] = useState<Collaborator[]>([])
  const [requests, setRequests] = useState<CollabRequest[]>([])
  const [text, setText] = useState('')
  const [pitch, setPitch] = useState('')
  const [newCollab, setNewCollab] = useState('')
  const [invites, setInvites] = useState<ProjectInvite[]>([])
  const [failed, setFailed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const loadSide = useCallback(() => {
    listProjectComments(id).then(setComments).catch(() => undefined)
    listCollaborators(id).then(setCollabs).catch(() => undefined)
    listCollabRequests(id).then(setRequests).catch(() => undefined)
    listProjectInvites(id).then(setInvites).catch(() => undefined)
  }, [id])

  const load = useCallback(() => {
    setFailed(false)
    setProject(undefined)
    getProjectFull(id).then((p) => { setProject(p); if (p) loadSide() }).catch(() => setFailed(true))
  }, [id, loadSide])
  useEffect(load, [load])

  async function run(fn: () => Promise<unknown>, after?: () => void) {
    setError(null)
    setNotice(null)
    setBusy(true)
    try { await fn(); after?.() } catch (err) { setError(friendlyError(err)) } finally { setBusy(false) }
  }

  async function toggleStar() {
    if (!project) return
    const was = project.starred_by_me
    await run(() => (was ? unstarProject(project.id) : starProject(project.id)),
      () => setProject({ ...project, starred_by_me: !was, star_count: project.star_count + (was ? -1 : 1) }))
  }

  async function onComment(e: FormEvent) {
    e.preventDefault()
    if (!text.trim()) return
    await run(() => postProjectComment(id, text), () => { setText(''); loadSide() })
  }

  async function onAddCollab(e: FormEvent) {
    e.preventDefault()
    if (!newCollab.trim()) return
    await run(() => inviteCollaborator(id, newCollab), () => { setNewCollab(''); setNotice(fr.projectPage.collabInvited); loadSide() })
  }

  async function onPitch(e: FormEvent) {
    e.preventDefault()
    if (!pitch.trim()) return
    await run(() => requestCollaboration(id, pitch), () => { setPitch(''); setNotice(fr.projectPage.collabSent); loadSide() })
  }

  const isOwner = project?.owner_id === me
  const iCollaborate = collabs.some((c) => c.user_id === me)
  const myPending = requests.find((r) => r.requester_id === me)
  // Stars, comments and join requests exist only for projects listed for everyone.
  const listed = project?.is_public ?? false

  return (
    <AppShell>
      <main className="page souk">
        <p><Link to="/projets">← {fr.projectPage.back}</Link></p>
        {failed && (
          <div className="alert" role="alert">
            {fr.projectPage.loadFailed} <button type="button" className="btn" onClick={load}>{fr.projectPage.retry}</button>
          </div>
        )}
        {!failed && project === undefined && <p className="muted">{fr.common.loading}</p>}
        {project === null && <p className="muted">{fr.projectPage.notFound}</p>}

        {project && (
          <>
            <header className="page-head">
              <h1 className="page-title">{project.title}{!listed ? <> <span className="tag tag-private">{fr.projectPage.private}</span></> : null}</h1>
              {!isOwner && <ReportButton type="project" id={project.id} />}
              <p className="muted tiny">
                <Link to={`/profil/${project.owner_username}`}>{fr.projectPage.by(project.owner_display_name || project.owner_username)}</Link>
              </p>
              <div className="project-actions">
                <a className="chip-link" href={`https://github.com/${project.github_owner}/${project.github_repo}`} target="_blank" rel="noreferrer">{fr.projectPage.github}</a>
                {project.demo_url && <a className="btn btn-demo" href={project.demo_url} target="_blank" rel="noreferrer noopener"><Icon name="play" size={16} /> {fr.projects.demo}</a>}
              </div>
              {project.summary && <p>{project.summary}</p>}
              <div className="project-tags">
                {project.language && <span className="tag">{project.language}</span>}
                {project.tags.map((t) => <span key={t} className="tag">{t}</span>)}
              </div>
              {listed ? (
                <p>
                  {isOwner ? (
                    <span className="muted">{fr.projectPage.ownProject}</span>
                  ) : iCollaborate ? (
                    <span className="muted">{fr.projectPage.youCollaborate}</span>
                  ) : (
                    <button type="button" className="btn" disabled={busy} aria-pressed={project.starred_by_me} onClick={() => void toggleStar()}>
                      {project.starred_by_me ? '★ ' + fr.projectPage.unstar : '☆ ' + fr.projectPage.star}
                    </button>
                  )}{' '}
                  {fr.projectPage.stars(project.star_count)}
                </p>
              ) : (
                <p className="muted">{isOwner ? fr.projectPage.privateOwner : fr.projectPage.privateMember}</p>
              )}
            </header>
            {error && <div className="alert" role="alert">{error}</div>}
            {notice && <div className="notice" role="status">{notice}</div>}

            <div className="stack-gap"><ProjectFiles project={project} dir="" canEdit={isOwner || iCollaborate} /></div>

            {isOwner && <ProjectShowcase projectId={project.id} userId={me} demoUrl={project.demo_url} coverPath={project.cover_path} onSaved={load} />}

            <section className="panel panel-pad stack-gap collab-panel">
              <h2>{fr.projectPage.collabTitle}</h2>
              <h3>{fr.projectPage.collaborators}</h3>
              {collabs.length === 0 && <p className="muted">{fr.projectPage.collabNone}</p>}
              {collabs.map((c) => (
                <div key={c.user_id} className="collab-row">
                  <Link to={`/profil/${c.username}`}>{c.display_name || c.username}</Link>
                  {(isOwner || c.user_id === me) && c.user_id !== project.owner_id && (
                    <><button type="button" className="btn btn-small" disabled={busy} aria-label={`${fr.projectPage.collabRemove} : ${c.username}`} onClick={() => void run(() => removeCollaborator(project.id, c.user_id), loadSide)}>{fr.projectPage.collabRemove}</button></>
                  )}
                </div>
              ))}

              {isOwner && (
                <form onSubmit={onAddCollab} noValidate className="collab-add">
                  <div className="field">
                    <label htmlFor="add-collab">{fr.projectPage.collabAddLabel}</label>
                    <MemberSuggest id="add-collab" value={newCollab} onChange={setNewCollab} exclude={[...collabs.map((c) => c.username), ...invites.map((i) => i.invitee_username), member?.profile.username ?? '']} placeholder={fr.projectPage.collabAddPlaceholder} />
                  </div>
                  <button className="btn btn-cta btn-small" type="submit" disabled={busy || !newCollab.trim()}>{fr.projectPage.collabInvite}</button>
                </form>
              )}

              {isOwner && invites.length > 0 && (
                <>
                  <h3>{fr.projectPage.invitesTitle}</h3>
                  {invites.map((i) => (
                    <div key={i.id} className="invite-line">
                      <Link to={`/profil/${i.invitee_username}`}>@{i.invitee_username}</Link>
                      <span className="muted tiny">{fr.projectPage.inviteExpires(new Date(i.expires_at).toLocaleDateString(dateLocale(), { day: 'numeric', month: 'long' }))}</span>
                      <button type="button" className="btn btn-small" disabled={busy} aria-label={`${fr.projectPage.inviteCancel} : ${i.invitee_username}`} onClick={() => void run(() => cancelCollabInvite(i.id), loadSide)}>{fr.projectPage.inviteCancel}</button>
                    </div>
                  ))}
                </>
              )}

              {isOwner && listed && (
                <>
                  <h3>{fr.projectPage.requestsTitle}</h3>
                  {requests.length === 0 && <p className="muted">{fr.projectPage.requestsEmpty}</p>}
                  {requests.map((r) => (
                    <div key={r.id} style={{ padding: '6px 0' }}>
                      <Link to={`/profil/${r.requester_username}`}>@{r.requester_username}</Link> — {r.message}{' '}
                      <button type="button" className="btn" disabled={busy} onClick={() => void run(() => decideCollabRequest(r.id, true), loadSide)}>{fr.projectPage.accept}</button>{' '}
                      <button type="button" className="btn" disabled={busy} onClick={() => void run(() => decideCollabRequest(r.id, false), loadSide)}>{fr.projectPage.decline}</button>
                    </div>
                  ))}
                </>
              )}

              {listed && !isOwner && !iCollaborate && myPending && (
                <p>
                  {fr.projectPage.collabWaiting}{' '}
                  <button type="button" className="btn" disabled={busy} onClick={() => void run(() => withdrawCollabRequest(myPending.id), loadSide)}>{fr.projectPage.collabWithdraw}</button>
                </p>
              )}
              {listed && !isOwner && !iCollaborate && !myPending && (
                <form onSubmit={onPitch} noValidate>
                  <div className="field">
                    <label htmlFor="pitch">{fr.projectPage.collabMessage}</label>
                    <textarea id="pitch" rows={3} maxLength={500} value={pitch} onChange={(e) => setPitch(e.target.value)} />
                  </div>
                  <button className="btn btn-cta" type="submit" disabled={busy || !pitch.trim()}>{fr.projectPage.collabSend}</button>
                </form>
              )}
            </section>

            {listed && <section className="panel panel-pad">
              <h2>{fr.projectPage.commentsTitle}</h2>
              {comments.length === 0 && <p className="muted">{fr.projectPage.commentsEmpty}</p>}
              <ul className="comment-list">
                {comments.map((c) => (
                  <li key={c.id} className="comment-item">
                    <div className="comment-head">
                      <span className="tiny muted"><Link to={`/profil/${c.author_username}`}>@{c.author_username}</Link> · {new Date(c.created_at).toLocaleDateString(dateLocale())}</span>
                      {(c.author_id === me || isOwner) && (
                      <button type="button" className="btn btn-small" disabled={busy} onClick={() => void run(() => deleteProjectComment(c.id), loadSide)}>{fr.projectPage.commentDelete}</button>
                      )}
                    </div>
                    <p className="comment-body">{c.body}</p>
                  </li>
                ))}
              </ul>
              <form onSubmit={onComment} noValidate>
                <div className="field">
                  <label htmlFor="p-comment">{fr.projectPage.commentLabel}</label>
                  <textarea id="p-comment" rows={3} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} />
                </div>
                <button className="btn btn-cta" type="submit" disabled={busy || !text.trim()}>{fr.projectPage.commentSend}</button>
              </form>
            </section>}
          </>
        )}
      </main>
    </AppShell>
  )
}
