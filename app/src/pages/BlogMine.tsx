import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { useAuth } from '../auth/AuthContext'
import { fr } from '../i18n/fr'
import { friendlyError } from '../lib/errors'
import { deleteBlogPost, listMyBlogPosts, publishBlogPost, unpublishBlogPost, type MyBlogPost } from '../lib/api'

export function BlogMine() {
  const { member } = useAuth()
  const me = member?.profile.id ?? ''
  const [posts, setPosts] = useState<MyBlogPost[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [asking, setAsking] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    setFailed(false)
    listMyBlogPosts(me).then(setPosts).catch(() => setFailed(true))
  }, [me])
  useEffect(load, [load])

  async function run(fn: () => Promise<unknown>) {
    setError(null)
    setBusy(true)
    try { await fn(); setAsking(null); load() } catch (err) { setError(friendlyError(err)) } finally { setBusy(false) }
  }

  return (
    <AppShell>
      <main className="page souk">
        <p><Link to="/blog">← {fr.blog.back}</Link></p>
        <header className="page-head">
          <h1 className="page-title">{fr.blog.mineTitle}</h1>
          <p><Link className="btn btn-cta" to="/blog/ecrire">{fr.blog.write}</Link></p>
        </header>
        {error && <div className="alert" role="alert">{error}</div>}
        {failed && (
          <div className="alert" role="alert">
            {fr.blog.loadFailed} <button type="button" className="btn" onClick={load}>{fr.blog.retry}</button>
          </div>
        )}
        {!failed && !posts && <p className="muted">{fr.common.loading}</p>}
        {posts && posts.length === 0 && <p className="muted">{fr.blog.mineEmpty}</p>}
        {(posts ?? []).map((p) => (
          <article key={p.id} className="panel panel-pad" style={{ marginBottom: 12 }}>
            <h3 style={{ margin: 0 }}><Link to={`/blog/${p.slug}`}>{p.title}</Link></h3>
            <p className="muted tiny">
              {p.status === 'published' ? fr.blog.statusPublished : fr.blog.statusDraft}{p.staff_hidden ? ` · ${fr.blog.hidden}` : ''}
            </p>
            <Link className="btn" to={`/blog/modifier/${p.id}`}>{fr.blog.edit}</Link>{' '}
            {p.status === 'draft' ? (
              <button type="button" className="btn" disabled={busy} aria-label={`${fr.blog.publish} : ${p.title}`} onClick={() => void run(() => publishBlogPost(p.id))}>{fr.blog.publish}</button>
            ) : (
              <button type="button" className="btn" disabled={busy} aria-label={`${fr.blog.unpublish} : ${p.title}`} onClick={() => void run(() => unpublishBlogPost(p.id))}>{fr.blog.unpublish}</button>
            )}{' '}
            {asking === p.id ? (
              <>
                <span>{fr.blog.deleteAsk}</span>{' '}
                <button type="button" className="btn btn-cta" disabled={busy} onClick={() => void run(() => deleteBlogPost(p.id))}>{fr.blog.deleteYes}</button>
              </>
            ) : (
              <button type="button" className="btn" aria-label={`${fr.blog.delete} : ${p.title}`} onClick={() => setAsking(p.id)}>{fr.blog.delete}</button>
            )}
          </article>
        ))}
      </main>
    </AppShell>
  )
}
