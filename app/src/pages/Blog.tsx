import { dateLocale } from '../i18n/lang'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { useDebounced } from '../hooks'
import { fr } from '../i18n/fr'
import { friendlyError } from '../lib/errors'
import { likeBlogPost, listBlogPosts, unlikeBlogPost, type BlogCard } from '../lib/api'

export function Blog() {
  const [tag, setTag] = useState('')
  const debounced = useDebounced(tag)
  const [posts, setPosts] = useState<BlogCard[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let alive = true
    setFailed(false)
    listBlogPosts(debounced).then((p) => { if (alive) setPosts(p) }).catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [debounced, reload])

  const toggleLike = useCallback(async (p: BlogCard) => {
    setError(null)
    const was = p.liked_by_me
    setPosts((cur) => cur && cur.map((x) => (x.id === p.id ? { ...x, liked_by_me: !was, like_count: x.like_count + (was ? -1 : 1) } : x)))
    try {
      await (was ? unlikeBlogPost(p.id) : likeBlogPost(p.id))
    } catch (err) {
      setPosts((cur) => cur && cur.map((x) => (x.id === p.id ? { ...x, liked_by_me: was, like_count: p.like_count } : x)))
      setError(friendlyError(err))
    }
  }, [])

  return (
    <AppShell>
      <main className="page souk">
        <header className="page-head">
          <h1 className="page-title">{fr.blog.title}</h1>
          <p className="muted">{fr.blog.subtitle}</p>
          <p>
            <Link className="btn btn-cta" to="/blog/ecrire">{fr.blog.write}</Link>{' '}
            <Link className="btn" to="/blog/mes-articles">{fr.blog.mine}</Link>
          </p>
        </header>
        <div className="field">
          <label htmlFor="tag">{fr.blog.tagFilter}</label>
          <input id="tag" value={tag} onChange={(e) => setTag(e.target.value)} />
        </div>
        {error && <div className="alert" role="alert">{error}</div>}
        {failed && (
          <div className="alert" role="alert">
            {fr.blog.loadFailed} <button type="button" className="btn" onClick={() => setReload((n) => n + 1)}>{fr.blog.retry}</button>
          </div>
        )}
        {!failed && !posts && <p className="muted">{fr.common.loading}</p>}
        {posts && posts.length === 0 && <p className="muted">{fr.blog.empty}</p>}
        {(posts ?? []).map((p) => (
          <article key={p.id} className="panel panel-pad" style={{ marginBottom: 16 }}>
            <h2 style={{ marginTop: 0 }}><Link to={`/blog/${p.slug}`}>{p.title}</Link></h2>
            <p className="muted tiny">
              {fr.blog.by(p.author_username)} · {new Date(p.published_at).toLocaleDateString(dateLocale())}
            </p>
            {p.summary && <p>{p.summary}</p>}
            <div className="project-tags">{p.tags.map((t) => <span key={t} className="tag">{t}</span>)}</div>
            <p className="tiny">
              <button type="button" className="btn" aria-pressed={p.liked_by_me} aria-label={`${p.liked_by_me ? fr.blog.unlike : fr.blog.like} : ${p.title}`} onClick={() => void toggleLike(p)}>
                {p.liked_by_me ? '♥' : '♡'}
              </button>{' '}
              {fr.blog.likes(p.like_count)} · {fr.blog.comments(p.comment_count)}
            </p>
          </article>
        ))}
      </main>
    </AppShell>
  )
}
