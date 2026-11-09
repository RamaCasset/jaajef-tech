import { dateLocale } from '../i18n/lang'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { ArticleBody } from '../components/ArticleBody'
import { PostEditor } from '../components/PostEditor'
import { useAuth } from '../auth/AuthContext'
import { fr } from '../i18n/fr'
import { friendlyError } from '../lib/errors'
import {
  acceptAnswer, deleteAnswer, deleteQuestion, editAnswer, editQuestion, getQuestion, listAnswers, postAnswer, unacceptAnswer, voteAnswer, voteQuestion,
  type AnswerRow, type QuestionFull,
} from '../lib/api'

export function QuestionPage() {
  const t = fr.qa
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { member } = useAuth()
  const me = member?.profile.id ?? ''
  const [question, setQuestion] = useState<QuestionFull | null | undefined>(undefined)
  const [answers, setAnswers] = useState<AnswerRow[]>([])
  const [text, setText] = useState('')
  const [answerBox, setAnswerBox] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [editingQ, setEditingQ] = useState<{ title: string; body: string; tags: string } | null>(null)
  const [editingA, setEditingA] = useState<{ id: number; body: string } | null>(null)

  const load = useCallback(() => {
    setFailed(false)
    getQuestion(id).then((q) => { setQuestion(q); if (q) listAnswers(id).then(setAnswers).catch(() => setFailed(true)) }).catch(() => { setQuestion(null); setFailed(true) })
  }, [id])
  useEffect(load, [load])

  async function run(fn: () => Promise<unknown>, after: () => void = load) {
    setError(null)
    setBusy(true)
    try { await fn(); after() } catch (err) { setError(friendlyError(err)) } finally { setBusy(false) }
  }

  async function onAnswer(e: FormEvent) {
    e.preventDefault()
    if (!text.trim()) return
    await run(() => postAnswer(id, text), () => { setText(''); setAnswerBox((n) => n + 1); load() })
  }

  async function saveQuestion(e: FormEvent) {
    e.preventDefault()
    if (!editingQ) return
    const tags = editingQ.tags.split(',').map((x) => x.trim()).filter(Boolean)
    await run(() => editQuestion(id, editingQ.title, editingQ.body, tags), () => { setEditingQ(null); load() })
  }

  async function saveAnswer(e: FormEvent) {
    e.preventDefault()
    if (!editingA) return
    await run(() => editAnswer(editingA.id, editingA.body), () => { setEditingA(null); load() })
  }

  async function onDeleteQuestion() {
    if (!window.confirm(t.confirmDelete)) return
    await run(() => deleteQuestion(id), () => navigate('/questions'))
  }

  if (question === undefined) return <AppShell><main className="page"><p className="muted">{fr.common.loading}</p></main></AppShell>
  if (question === null) {
    return (
      <AppShell>
        <main className="page">
          <p><Link to="/questions">← {t.back}</Link></p>
          <p className="alert" role="alert">{failed ? t.loadFailed : t.notFound}</p>
        </main>
      </AppShell>
    )
  }

  const asker = question.author_id === me
  const when = (d: string) => new Date(d).toLocaleDateString(dateLocale())
  const name = (u: string, d: string | null) => d || u

  return (
    <AppShell>
      <main className="page">
        <p><Link to="/questions">← {t.back}</Link></p>
        <article className="panel panel-pad stack-gap">
          {editingQ ? (
            <form className="stack-gap" onSubmit={(e) => void saveQuestion(e)} noValidate>
              <div className="field">
                <label htmlFor="e-title">{t.titleLabel}</label>
                <input id="e-title" maxLength={150} value={editingQ.title} onChange={(e) => setEditingQ({ ...editingQ, title: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="e-body">{t.bodyLabel}</label>
                <PostEditor id="e-body" rows={8} initial={editingQ.body} onChange={(body) => setEditingQ((q) => (q ? { ...q, body } : q))} />
              </div>
              <div className="field">
                <label htmlFor="e-tags">{t.tagsLabel}</label>
                <input id="e-tags" value={editingQ.tags} onChange={(e) => setEditingQ({ ...editingQ, tags: e.target.value })} />
              </div>
              <p>
                <button type="submit" className="btn btn-cta" disabled={busy || editingQ.body.length > 8000}>{t.save}</button>{' '}
                <button type="button" className="btn" onClick={() => setEditingQ(null)}>{t.cancelEdit}</button>
              </p>
            </form>
          ) : (<>
          <p className="eyebrow">{t.eyebrow}</p>
          <h1 className="page-title">{question.title}</h1>
          <p className="tiny muted">
            <Link to={`/profil/${question.author_username}`}>{t.by(name(question.author_username, question.author_display_name))}</Link> · {when(question.created_at)}
            {question.edited_at && <> · {t.edited}</>}
          </p>
          <div className="qa-body"><ArticleBody text={question.body} /></div>
          {question.tags.length > 0 && <p className="qa-tags">{question.tags.map((x) => <span key={x} className="tag">{x}</span>)}</p>}
          </>)}
          <p className="qa-actions">
            {!asker && (
              <button type="button" className="btn" aria-pressed={question.voted_by_me} disabled={busy}
                onClick={() => void run(() => voteQuestion(question.id, !question.voted_by_me))}>
                {question.voted_by_me ? t.unmarkUseful : t.markUseful} ({question.vote_count})
              </button>
            )}
            {asker && <span className="muted tiny">{t.useful(question.vote_count)}</span>}
            {asker && !editingQ && <button type="button" className="btn" disabled={busy} onClick={() => setEditingQ({ title: question.title, body: question.body, tags: question.tags.join(', ') })}>{t.edit}</button>}
            {asker && <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void onDeleteQuestion()}>{t.deleteQuestion}</button>}
          </p>
        </article>

        {error && <div className="alert" role="alert">{error}</div>}

        <section className="stack-gap qa-answers" aria-label={t.answersTitle(answers.length)}>
          <h2>{t.answersTitle(answers.length)}</h2>
          {asker && answers.length > 0 && <p className="muted tiny">{t.rewardHint}</p>}
          {answers.map((a) => (
            <article key={a.id} className={`panel panel-pad stack-gap qa-answer ${a.accepted ? 'qa-answer-solution' : ''}`}>
              {a.accepted && <p><span className="tag qa-solved">{t.solution}</span></p>}
              {editingA?.id === a.id ? (
                <form className="stack-gap" onSubmit={(e) => void saveAnswer(e)} noValidate>
                  <label htmlFor={`e-a-${a.id}`} className="sr-only">{t.editAnswerLabel}</label>
                  <PostEditor id={`e-a-${a.id}`} rows={6} initial={editingA.body} onChange={(body) => setEditingA({ id: a.id, body })} />
                  <p>
                    <button type="submit" className="btn btn-cta" disabled={busy || !editingA.body.trim() || editingA.body.length > 8000}>{t.save}</button>{' '}
                    <button type="button" className="btn" onClick={() => setEditingA(null)}>{t.cancelEdit}</button>
                  </p>
                </form>
              ) : <div className="qa-body"><ArticleBody text={a.body} /></div>}
              <p className="tiny muted">
                <Link to={`/profil/${a.author_username}`}>{t.by(name(a.author_username, a.author_display_name))}</Link> · {when(a.created_at)}
                {a.edited_at && <> · {t.edited}</>}
              </p>
              <p className="qa-actions">
                {a.author_id !== me && (
                  <button type="button" className="btn" aria-pressed={a.voted_by_me} disabled={busy}
                    onClick={() => void run(() => voteAnswer(a.id, !a.voted_by_me))}>
                    {a.voted_by_me ? t.unmarkUseful : t.markUseful} ({a.vote_count})
                  </button>
                )}
                {a.author_id === me && <span className="muted tiny">{t.useful(a.vote_count)}</span>}
                {asker && !a.accepted && <button type="button" className="btn btn-cta" disabled={busy} onClick={() => void run(() => acceptAnswer(a.id))}>{t.markSolution}</button>}
                {asker && a.accepted && <button type="button" className="btn" disabled={busy} onClick={() => void run(() => unacceptAnswer(question.id))}>{t.unmarkSolution}</button>}
                {a.author_id === me && editingA?.id !== a.id && <button type="button" className="btn" disabled={busy} onClick={() => setEditingA({ id: a.id, body: a.body })}>{t.edit}</button>}
                {a.author_id === me && <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void run(() => deleteAnswer(a.id))}>{t.deleteAnswer}</button>}
              </p>
            </article>
          ))}
        </section>

        <form className="panel panel-pad stack-gap" onSubmit={(e) => void onAnswer(e)} noValidate>
          <div className="field">
            <label htmlFor="a-text">{t.yourAnswer}</label>
            <PostEditor key={answerBox} id="a-text" rows={6} placeholder={t.answerPlaceholder} onChange={setText} />
          </div>
          <p><button type="submit" className="btn btn-cta" disabled={busy || !text.trim() || text.length > 8000}>{busy ? t.sending : t.send}</button></p>
        </form>
      </main>
    </AppShell>
  )
}
