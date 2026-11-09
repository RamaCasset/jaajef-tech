import { dateLocale } from '../i18n/lang'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { MentionText } from '../components/MentionText'
import { ArticleBody } from '../components/ArticleBody'
import { useAuth } from '../auth/AuthContext'
import { fr } from '../i18n/fr'
import { friendlyError } from '../lib/errors'
import {
  deleteBlogComment, getBlogPostBySlug, likeBlogPost, listBlogComments, postBlogComment, unlikeBlogPost,
  type BlogComment, type BlogPostFull,
} from '../lib/api'

export function BlogPost() {
  const { slug = '' } = useParams()
  const { member } = useAuth()
  const me = member?.profile.id ?? ''
  const [post, setPost] = useState<BlogPostFull | null | undefined>(undefined)
  const [comments, setComments] = useState<BlogComment[]>([])
  const [text, setText] = useState('')
  const [failed, setFailed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    setFailed(false)
    setPost(undefined)
    getBlogPostBySlug(slug)
      .then((p) => {
        setPost(p)
        if (p) listBlogComments(p.id).then(setComments).catch(() => undefined)
      })
      .catch(() => setFailed(true))
  }, [slug])
  useEffect(load, [load])

  async function run(fn: () => Promise<unknown>, after?: () => void) {
    setError(null)
    setBusy(true)
    try { await fn(); after?.() } catch (err) { setError(friendlyError(err)) } finally { setBusy(false) }
  }

  const reloadComments = () => { if (post) listBlogComments(post.id).then(setComments).catch(() => undefined) }

  async function onComment(e: FormEvent) {
    e.preventDefault()
    if (!post || !text.trim()) return
    await run(() => postBlogComment(post.id, text), () => { setText(''); reloadComments() })
  }

  async function toggleLike() {
    if (!post) return
    const was = post.liked_by_me
    await run(() => (was ? unlikeBlogPost(post.id) : likeBlogPost(post.id)),
      () => setPost({ ...post, liked_by_me: !was, like_count: post.like_count + (was ? -1 : 1) }))
  }

  const isDraft = post?.status === 'draft'

  return (
    <AppShell>
      <main className="page souk">
        <p><Link to="/blog">← {fr.blog.back}</Link></p>
        {failed && (
          <div className="alert" role="alert">
            {fr.blog.loadFailed} <button type="button" className="btn" onClick={load}>{fr.blog.retry}</button>
          </div>
        )}
        {!failed && post === undefined && <p className="muted">{fr.common.loading}</p>}
        {post === null && <p className="muted">{fr.blog.notFound}</p>}
        {post && (
          <>
            {isDraft && <div className="notice" role="status">{fr.blog.draftBanner}</div>}
            <header className="page-head">
              <h1 className="page-title">{post.title}</h1>
              <p className="muted tiny">
                <Link to={`/profil/${post.author_username}`}>{fr.blog.by(post.author_name || post.author_username)}</Link>
                {post.published_at ? ` · ${new Date(post.published_at).toLocaleDateString(dateLocale())}` : ''}
              </p>
              <div className="project-tags">{post.tags.map((t) => <span key={t} className="tag">{t}</span>)}</div>
              {post.author_id === me && <p><Link className="btn" to={`/blog/modifier/${post.id}`}>{fr.blog.edit}</Link></p>}
            </header>
            {post.cover_url && <img src={post.cover_url} alt="" style={{ maxWidth: '100%', borderRadius: 8 }} />}
            {/* Plain text only: nothing the author writes is ever treated as markup. */}
            <article className="panel panel-pad" style={{ marginBottom: 16 }}><ArticleBody text={post.body} /></article>
            {!isDraft && (
              <p>
                <button type="button" className="btn" disabled={busy} aria-pressed={post.liked_by_me} onClick={() => void toggleLike()}>
                  {post.liked_by_me ? '♥ ' + fr.blog.unlike : '♡ ' + fr.blog.like}
                </button>{' '}
                {fr.blog.likes(post.like_count)}
              </p>
            )}
            {error && <div className="alert" role="alert">{error}</div>}

            {!isDraft && (
              <section className="panel panel-pad">
                <h2>{fr.blog.commentsTitle}</h2>
                {comments.length === 0 && <p className="muted">{fr.blog.commentsEmpty}</p>}
                <ul className="comment-list">
                  {comments.map((c) => (
                    <li key={c.id} className="comment-item">
                      <div className="comment-head">
                        <span className="tiny muted"><Link to={`/profil/${c.author_username}`}>@{c.author_username}</Link> · {new Date(c.created_at).toLocaleDateString(dateLocale())}</span>
                        {(c.author_id === me || post.author_id === me) && (
                        <button type="button" className="btn btn-small" disabled={busy} onClick={() => void run(() => deleteBlogComment(c.id), reloadComments)}>{fr.blog.commentDelete}</button>
                      )}
                      </div>
                      <p className="comment-body"><MentionText text={c.body} /></p>
                    </li>
                  ))}
                </ul>
                <form onSubmit={onComment} noValidate>
                  <div className="field">
                    <label htmlFor="comment">{fr.blog.commentLabel}</label>
                    <textarea id="comment" rows={3} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} />
                  </div>
                  <button className="btn btn-cta" type="submit" disabled={busy || !text.trim()}>{fr.blog.commentSend}</button>
                </form>
              </section>
            )}
          </>
        )}
      </main>
    </AppShell>
  )
}
