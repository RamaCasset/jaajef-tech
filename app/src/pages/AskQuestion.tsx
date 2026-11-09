import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { PostEditor } from '../components/PostEditor'
import { fr } from '../i18n/fr'
import { friendlyError } from '../lib/errors'
import { askQuestion } from '../lib/api'

export function AskQuestion() {
  const t = fr.qa
  const navigate = useNavigate()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [tags, setTags] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const list = tags.split(',').map((x) => x.trim()).filter(Boolean)
      const id = await askQuestion(title, body, list)
      navigate(`/questions/${id}`)
    } catch (err) {
      setError(friendlyError(err))
      setBusy(false)
    }
  }

  return (
    <AppShell>
      <main className="page">
        <p><Link to="/questions">← {t.back}</Link></p>
        <header className="page-head">
          <p className="eyebrow">{t.eyebrow}</p>
          <h1 className="page-title">{t.askTitle}</h1>
          <p className="muted">{t.askHelp}</p>
        </header>
        {error && <div className="alert" role="alert">{error}</div>}
        <form className="panel panel-pad stack-gap" onSubmit={(e) => void submit(e)} noValidate>
          <div className="field">
            <label htmlFor="q-title">{t.titleLabel}</label>
            <input id="q-title" maxLength={150} value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="q-body">{t.bodyLabel}</label>
            <PostEditor id="q-body" rows={10} onChange={setBody} />
          </div>
          <div className="field">
            <label htmlFor="q-tags">{t.tagsLabel}</label>
            <input id="q-tags" placeholder={t.tagsPlaceholder} value={tags} onChange={(e) => setTags(e.target.value)} />
          </div>
          <p>
            <button type="submit" className="btn btn-cta" disabled={busy || !title.trim() || !body.trim() || body.length > 8000}>{busy ? t.publishing : t.publish}</button>{' '}
            <Link className="btn" to="/questions">{t.cancel}</Link>
          </p>
        </form>
      </main>
    </AppShell>
  )
}
