import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { fr } from '../i18n/fr'
import { friendlyError } from '../lib/errors'
import { createBlogPost, getMyBlogPost, publishBlogPost, updateBlogPost, type BlogDraft } from '../lib/api'

export function BlogEditor() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  const [body, setBody] = useState('')
  const [cover, setCover] = useState('')
  const [tags, setTags] = useState('')
  const [loaded, setLoaded] = useState(!id)
  const [missing, setMissing] = useState(false)
  const [failed, setFailed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!id) return
    getMyBlogPost(id)
      .then((p) => {
        if (!p) { setMissing(true); return }
        setTitle(p.title); setSummary(p.summary ?? ''); setBody(p.body); setCover(p.cover_url ?? ''); setTags(p.tags.join(', '))
        setLoaded(true)
      })
      .catch(() => setFailed(true))
  }, [id])

  const draft = (): BlogDraft => ({
    title, summary, body, cover_url: cover,
    tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
  })

  async function save(publish: boolean) {
    setError(null)
    setSaved(false)
    setBusy(true)
    try {
      let postId = id
      if (id) {
        await updateBlogPost(id, draft())
        if (publish) await publishBlogPost(id)
      } else {
        postId = await createBlogPost(draft(), publish)
      }
      if (publish || !id) navigate(publish ? '/blog/mes-articles' : `/blog/modifier/${postId}`, { replace: true })
      else setSaved(true)
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  function onSubmit(e: FormEvent) { e.preventDefault(); void save(false) }

  return (
    <AppShell>
      <main className="page souk">
        <p><Link to="/blog/mes-articles">← {fr.blog.mine}</Link></p>
        <h1 className="page-title">{id ? fr.blog.editorEdit : fr.blog.editorNew}</h1>
        {missing && <p className="muted">{fr.errors.postNotFound}</p>}
        {failed && <div className="alert" role="alert">{fr.blog.loadFailed}</div>}
        {loaded && !missing && (
          <form className="panel panel-pad" onSubmit={onSubmit} noValidate>
            {error && <div className="alert" role="alert">{error}</div>}
            {saved && <div className="notice" role="status">{fr.blog.saved}</div>}
            <div className="field">
              <label htmlFor="b-title">{fr.blog.fTitle}</label>
              <input id="b-title" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="b-summary">{fr.blog.fSummary}</label>
              <textarea id="b-summary" rows={2} maxLength={300} value={summary} onChange={(e) => setSummary(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="b-body">{fr.blog.fBody}</label>
              <textarea id="b-body" rows={14} maxLength={20000} value={body} onChange={(e) => setBody(e.target.value)} />
            <span className="hint">{fr.blog.formatHint}</span>
              <span className="hint">{fr.blog.plainText}</span>
            </div>
            <div className="field">
              <label htmlFor="b-cover">{fr.blog.fCover}</label>
              <input id="b-cover" type="url" maxLength={500} value={cover} onChange={(e) => setCover(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="b-tags">{fr.blog.fTags}</label>
              <input id="b-tags" value={tags} onChange={(e) => setTags(e.target.value)} />
            </div>
            <button className="btn" type="submit" disabled={busy || !title.trim() || !body.trim()}>{fr.blog.saveDraft}</button>{' '}
            <button className="btn btn-cta" type="button" disabled={busy || !title.trim() || !body.trim()} onClick={() => void save(true)}>{fr.blog.saveAndPublish}</button>
          </form>
        )}
      </main>
    </AppShell>
  )
}
