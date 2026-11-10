import { dateLocale } from '../i18n/lang'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { Icon } from '../components/Icon'
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

  // The themes of the posts on screen, most used first: one click filters by it.
  const themes = Object.entries((posts ?? []).flatMap((p) => p.tags).reduce<Record<string, number>>((m, t) => ({ ...m, [t]: (m[t] ?? 0) + 1 }), {}))
    .sort((x, y) => y[1] - x[1]).slice(0, 8).map(([t]) => t)

  return (
    <AppShell>
      <main className="page notices-page">
        <header className="page-head-row">
          <div>
            <p className="eyebrow">{fr.blog.eyebrow}</p>
            <h1 className="page-title">{fr.blog.title}</h1>
            <p className="muted">{fr.blog.subtitle}</p>
          </div>
          <div className="notice-head-actions">
            <Link className="btn" to="/blog/mes-articles">{fr.blog.mine}</Link>
            <Link className="btn btn-cta" to="/blog/ecrire">{fr.blog.write}</Link>
          </div>
        </header>
        <div className="notice-search-row">
          <label className="notice-search">
            <Icon name="search" size={16} />
            <input id="tag" type="search" placeholder={fr.blog.tagPlaceholder} aria-label={fr.blog.tagFilter} value={tag} onChange={(e) => setTag(e.target.value)} />
          </label>
        </div>
        {themes.length > 0 && (
          <div className="notice-filters" role="group" aria-label={fr.blog.themes}>
            <button type="button" className="chip" aria-pressed={tag === ''} onClick={() => setTag('')}>{fr.blog.allThemes}</button>
            {themes.map((t) => <button key={t} type="button" className="chip" aria-pressed={tag.trim().toLowerCase() === t.toLowerCase()} onClick={() => setTag(t)}>{t}</button>)}
          </div>
        )}
        {error && <div className="alert" role="alert">{error}</div>}
        {failed && (
          <div className="alert" role="alert">
            {fr.blog.loadFailed} <button type="button" className="btn" onClick={() => setReload((n) => n + 1)}>{fr.blog.retry}</button>
          </div>
        )}
        {!failed && !posts && <p className="muted">{fr.common.loading}</p>}
        {posts && posts.length === 0 && <p className="muted">{fr.blog.empty}</p>}
        <div className="blog-grid">
          {(posts ?? []).map((p, i) => (
            <article key={p.id} className={`panel blog-card ${i === 0 && !debounced ? 'blog-card-featured' : ''}`}>
              <div className="blog-cover" style={p.cover_url ? { backgroundImage: `url(${p.cover_url})` } : undefined} aria-hidden="true">
                {!p.cover_url && <span>{(p.author_username || '?').slice(0, 1).toUpperCase()}</span>}
              </div>
              <div className="blog-body">
                <div className="project-tags">{p.tags.slice(0, 3).map((t) => <span key={t} className="tag">{t}</span>)}</div>
                <h2 className="blog-title"><Link className="blog-stretch" to={`/blog/${p.slug}`}>{p.title}</Link></h2>
                {p.summary && <p className="muted blog-summary">{p.summary}</p>}
                <div className="blog-meta">
                  <span className="blog-author">
                    <span className="blog-avatar" aria-hidden="true">{(p.author_username || '?').slice(0, 1).toUpperCase()}</span>
                    <span className="tiny muted">{fr.blog.by(p.author_username)} · {new Date(p.published_at).toLocaleDateString(dateLocale())}</span>
                  </span>
                  <span className="blog-stats tiny muted">
                    <button type="button" className="blog-like" aria-pressed={p.liked_by_me} aria-label={`${p.liked_by_me ? fr.blog.unlike : fr.blog.like} : ${p.title}`} onClick={() => void toggleLike(p)}>
                      {p.liked_by_me ? '♥' : '♡'}
                    </button>
                    {fr.blog.likes(p.like_count)} · {fr.blog.comments(p.comment_count)}
                  </span>
                </div>
              </div>
            </article>
          ))}
        </div>
      </main>
    </AppShell>
  )
}
