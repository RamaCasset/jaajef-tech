import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { Icon } from '../components/Icon'
import { PinnedCard, RepoListRow } from '../components/RepoRow'
import { RepoSide } from '../components/RepoSide'
import { SpaceToggle } from '../components/SpaceToggle'
import { useAuth } from '../auth/AuthContext'
import { fr } from '../i18n/fr'
import { friendlyError } from '../lib/errors'
import { editorPresence, listMyRepos, removeProject, setProjectPinned, setProjectVisibility, type MyRepo } from '../lib/api'

const PAGE_SIZE = 6
type Sort = 'activity' | 'stars' | 'name'
type Visibility = 'all' | 'public' | 'private'

const activityOf = (r: MyRepo) => Date.parse(r.github_pushed_at ?? r.updated_at) || 0

export function MyRepos() {
  const t = fr.myRepos
  const { member } = useAuth()
  const me = member?.profile.id ?? ''
  const username = member?.profile.username ?? ''
  const [repos, setRepos] = useState<MyRepo[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [language, setLanguage] = useState('')
  const [visibility, setVisibility] = useState<Visibility>('all')
  const [sort, setSort] = useState<Sort>('activity')
  const [page, setPage] = useState(1)

  const [removing, setRemoving] = useState<MyRepo | null>(null)
  const checkedPresence = useRef(false)

  const load = useCallback(() => {
    setFailed(false)
    listMyRepos(me).then(setRepos).catch(() => setFailed(true))
  }, [me])
  useEffect(load, [load])

  // Once per visit: ask GitHub whether the private repositories are still there (silent when it cannot).
  useEffect(() => {
    if (checkedPresence.current || !repos || !repos.some((r) => r.repo_private)) return
    checkedPresence.current = true
    editorPresence().then((r) => { if (r.checked) load() }).catch(() => { /* nothing to show */ })
  }, [repos, load])

  async function change(work: () => Promise<unknown>) {
    setActionError(null)
    try {
      await work()
      load()
    } catch (err) {
      setActionError(friendlyError(err) || t.actionError)
    }
  }

  const all = repos ?? []
  const pinned = useMemo(() => all.filter((r) => r.pinned_at).sort((a, b) => Date.parse(a.pinned_at!) - Date.parse(b.pinned_at!)), [all])
  const languages = useMemo(() => [...new Set(all.map((r) => r.language).filter((l): l is string => !!l))].sort(), [all])

  const others = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = all.filter((r) => !r.pinned_at
      && (!q || r.github_repo.toLowerCase().includes(q) || r.title.toLowerCase().includes(q) || (r.summary ?? '').toLowerCase().includes(q))
      && (!language || r.language === language)
      && (visibility === 'all' || (visibility === 'public' ? r.is_public : !r.is_public)))
    return list.sort((a, b) => {
      if (sort === 'stars') return (b.github_stars + b.star_count) - (a.github_stars + a.star_count)
      if (sort === 'name') return a.github_repo.localeCompare(b.github_repo)
      return activityOf(b) - activityOf(a)
    })
  }, [all, query, language, visibility, sort])

  useEffect(() => { setPage(1) }, [query, language, visibility, sort])
  const pages = Math.max(1, Math.ceil(others.length / PAGE_SIZE))
  const current = Math.min(page, pages)
  const shown = others.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE)

  const publicCount = all.filter((r) => r.is_public).length
  const privateCount = all.length - publicCount
  const hasPrivate = privateCount > 0

  return (
    <AppShell>
      <main className="page repos-page">
        <RepoSide repoCount={repos ? all.length : null} />
        <div className="repos-main">
          <p className="mono tiny muted repo-crumb">{t.root} / {username} / <span className="crumb-on">{t.nav.repos}</span></p>
          <div className="page-head-row">
            <div>
              <h1 className="page-title">{t.title} {repos ? <span className="count-pill">{all.length}</span> : null}</h1>
              <p className="muted">{t.subtitle}</p>
            </div>
            <div className="head-actions">
              <SpaceToggle active="personal" />
              <Link className="btn btn-cta btn-icon" to="/projets/ajouter"><Icon name="plus" size={16} /> {t.newRepo}</Link>
            </div>
          </div>
          {repos ? (
            <p className="repo-counts tiny">
              <span>{t.publicCount(publicCount)}</span><span>{t.privateCount(privateCount)}</span><span>{t.pinnedCount(pinned.length)}</span>
              <span className="muted mono">{t.owner.toUpperCase()} · {username}</span>
            </p>
          ) : null}

          <div className="repo-filters">
            <div className="field"><label htmlFor="r-q">{t.search}</label><input id="r-q" type="search" className="search" placeholder={t.searchPlaceholder} value={query} onChange={(e) => setQuery(e.target.value)} /></div>
            <div className="field"><label htmlFor="r-l">{t.language}</label>
              <select id="r-l" value={language} onChange={(e) => setLanguage(e.target.value)}>
                <option value="">{t.allLanguages}</option>
                {languages.map((l) => <option key={l} value={l}>{l}</option>)}
              </select></div>
            <div className="field"><label htmlFor="r-v">{t.visibility}</label>
              <select id="r-v" value={visibility} onChange={(e) => setVisibility(e.target.value as Visibility)}>
                <option value="all">{t.visibilityAll}</option><option value="public">{t.visibilityPublic}</option><option value="private">{t.visibilityPrivate}</option>
              </select></div>
            <div className="field"><label htmlFor="r-s">{t.sortBy}</label>
              <select id="r-s" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                {(Object.keys(t.sorts) as Sort[]).map((k) => <option key={k} value={k}>{t.sorts[k]}</option>)}
              </select></div>
          </div>

          {removing ? (
            <div className="panel remove-confirm" role="alertdialog" aria-labelledby="rm-t">
              <h2 id="rm-t">{t.removeTitle(removing.github_repo)}</h2>
              <p className="muted">{t.removeText}</p>
              <div className="remove-actions">
                <button type="button" className="btn" onClick={() => setRemoving(null)}>{t.removeCancel}</button>
                <button type="button" className="btn btn-danger" onClick={() => { const r = removing; setRemoving(null); void change(() => removeProject(r.id)) }}>{t.removeConfirm}</button>
              </div>
            </div>
          ) : null}

          {failed && <div className="alert" role="alert">{t.error} <button type="button" className="btn" onClick={load}>{t.retry}</button></div>}
          {actionError && <div className="alert" role="alert">{actionError}</div>}
          {!failed && repos === null && <p className="muted">{fr.common.loading}</p>}
          {repos && all.length === 0 && <div className="panel empty"><strong>{t.empty}</strong></div>}

          {pinned.length > 0 && (
            <section aria-labelledby="pinned-h">
              <div className="profile-colhead"><h2 id="pinned-h"><Icon name="pin" size={18} /> {t.pinnedTitle} <span className="count-pill">{pinned.length}</span></h2></div>
              <div className="pinned-grid">
                {pinned.map((r) => (
                  <PinnedCard key={r.id} repo={r}
                    onPin={() => void change(() => setProjectPinned(r.id, false))}
                    onVisibility={() => void change(() => setProjectVisibility(r.id, !r.is_public))}
                    onRemove={() => setRemoving(r)} />
                ))}
              </div>
            </section>
          )}

          {repos && all.length > 0 && (
            <section aria-labelledby="others-h">
              <div className="profile-colhead">
                <h2 id="others-h">{t.others} <span className="count-pill">{all.length - pinned.length}</span></h2>
                {pinned.length > 0 ? <span className="muted tiny">{t.othersNote(pinned.length)}</span> : null}
              </div>
              {others.length === 0 ? <p className="muted">{t.noMatch}</p> : (
                <div className="panel repo-list">
                  <ul>
                    {shown.map((r) => (
                      <RepoListRow key={r.id} repo={r}
                        onPin={() => void change(() => setProjectPinned(r.id, true))}
                        onVisibility={() => void change(() => setProjectVisibility(r.id, !r.is_public))}
                    onRemove={() => setRemoving(r)} />
                    ))}
                  </ul>
                  <div className="repo-pager">
                    <span className="muted tiny">{t.range((current - 1) * PAGE_SIZE + 1, (current - 1) * PAGE_SIZE + shown.length, others.length)}</span>
                    {pages > 1 && (
                      <nav aria-label={t.pages} className="pager">
                        <button type="button" className="btn" disabled={current === 1} onClick={() => setPage(current - 1)}>{t.prev}</button>
                        {Array.from({ length: pages }, (_, i) => i + 1).map((n) => (
                          <button key={n} type="button" className={`btn pager-n ${n === current ? 'pager-on' : ''}`} aria-label={t.page(n)} aria-current={n === current ? 'page' : undefined} onClick={() => setPage(n)}>{n}</button>
                        ))}
                        <button type="button" className="btn" disabled={current === pages} onClick={() => setPage(current + 1)}>{t.next}</button>
                      </nav>
                    )}
                  </div>
                </div>
              )}
            </section>
          )}

          <p className="repo-foot tiny muted">
            {hasPrivate ? <span>{t.privateNote}</span> : <span />}
            <Link to="/projets/ajouter">{t.importExisting} <Icon name="forward" size={13} /></Link>
          </p>
        </div>
      </main>
    </AppShell>
  )
}
