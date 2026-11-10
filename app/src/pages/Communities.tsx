import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { Icon } from '../components/Icon'
import { useAuth } from '../auth/AuthContext'
import { fr } from '../i18n/fr'
import { friendlyError } from '../lib/errors'
import {
  communityMemberCount, createCommunity, joinCommunity, listDiscoverCommunities, listMyCommunities, requestToJoin,
  type Community, type CommunityRole,
} from '../lib/api'

type Mine = Community & { role: CommunityRole }

export function Communities() {
  const { member } = useAuth()
  const userId = member?.profile.id ?? ''
  const [mine, setMine] = useState<Mine[] | null>(null)
  const [others, setOthers] = useState<Community[] | null>(null)
  const [counts, setCounts] = useState<Record<string, number | null>>({})
  const [failed, setFailed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [askFor, setAskFor] = useState<string | null>(null)
  const [askText, setAskText] = useState('')
  const [busy, setBusy] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [query, setQuery] = useState('')

  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [description, setDescription] = useState('')
  const [isPrivate, setIsPrivate] = useState(false)
  const [isListed, setIsListed] = useState(true)

  const load = useCallback(() => {
    setFailed(false)
    Promise.all([listMyCommunities(userId), listDiscoverCommunities()])
      .then(([m, d]) => {
        const mineIds = new Set(m.map((c) => c.id))
        const rest = d.filter((c) => !mineIds.has(c.id))
        setMine(m)
        setOthers(rest)
        for (const c of [...m, ...rest]) {
          communityMemberCount(c.id).then((n) => setCounts((cur) => ({ ...cur, [c.id]: n }))).catch(() => undefined)
        }
      })
      .catch(() => setFailed(true))
  }, [userId])
  useEffect(load, [load])

  async function act(fn: () => Promise<unknown>, okMessage?: string) {
    setError(null)
    setNotice(null)
    setBusy(true)
    try {
      await fn()
      if (okMessage) setNotice(okMessage)
      load()
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault()
    await act(async () => {
      await createCommunity(slug.trim(), name.trim(), description, isPrivate, isListed)
      setName(''); setSlug(''); setDescription('')
      setShowCreate(false)
    }, fr.communities.created)
  }

  async function sendAsk(id: string) {
    await act(async () => {
      await requestToJoin(id, askText)
      setAskFor(null)
      setAskText('')
    }, fr.communities.asked)
  }

  const needle = query.trim().toLowerCase()
  const matches = (c: Community) => !needle || `${c.name} ${c.description ?? ''}`.toLowerCase().includes(needle)
  const initials = (n: string) => n.split(/\s+/).slice(0, 2).map((w) => w.slice(0, 1)).join('').toUpperCase()
  const mineShown = (mine ?? []).filter(matches)
  const othersShown = (others ?? []).filter(matches)

  return (
    <AppShell>
      <main className="page">
        <header className="page-head-row">
          <div>
            <p className="eyebrow">{fr.communities.eyebrow}</p>
            <h1 className="page-title">{fr.communities.title}</h1>
            <p className="muted">{fr.communities.subtitle}</p>
          </div>
          <button type="button" className="btn btn-cta btn-icon" aria-expanded={showCreate} onClick={() => setShowCreate((v) => !v)}><Icon name="plus" size={16} /> {fr.communities.create}</button>
        </header>

        {error && <div className="alert" role="alert">{error}</div>}
        {notice && <div className="notice" role="status">{notice}</div>}
        {failed && (
          <div className="alert" role="alert">
            {fr.communities.loadFailed} <button type="button" className="btn" onClick={load}>{fr.communities.retry}</button>
          </div>
        )}

        {showCreate && (
          <form className="panel panel-pad community-create" onSubmit={onCreate} noValidate>
            <h2>{fr.communities.create}</h2>
            <div className="field">
              <label htmlFor="c-name">{fr.communities.createName}</label>
              <input id="c-name" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="c-slug">{fr.communities.createSlug}</label>
              <input id="c-slug" maxLength={40} value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} />
            </div>
            <div className="field">
              <label htmlFor="c-desc">{fr.communities.createDescription}</label>
              <textarea id="c-desc" rows={3} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <label className="check-row">
              <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} /> {fr.communities.createPrivate}
            </label>
            {isPrivate && (
              <label className="check-row">
                <input type="checkbox" checked={isListed} onChange={(e) => setIsListed(e.target.checked)} /> {fr.communities.createListed}
              </label>
            )}
            <p><button className="btn btn-cta" type="submit" disabled={busy || !name.trim() || !slug.trim()}>{fr.communities.createSubmit}</button></p>
          </form>
        )}

        <div className="notice-search-row notices-page">
          <label className="notice-search">
            <Icon name="search" size={16} />
            <input type="search" placeholder={fr.communities.searchPlaceholder} aria-label={fr.communities.searchPlaceholder} value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
        </div>

        {!failed && (!mine || !others) && <p className="muted">{fr.common.loading}</p>}

        {mine && (
          <section className="community-section" aria-label={fr.communities.mine}>
            <h2 className="community-heading">{fr.communities.mine}</h2>
            {mine.length === 0 && <p className="muted">{fr.communities.mineEmpty}</p>}
            <div className="community-grid">
              {mineShown.map((c) => (
                <article key={c.id} className="panel community-card community-card-link">
                  <span className="community-avatar" aria-hidden="true">{initials(c.name)}</span>
                  <div className="community-body">
                    <h3 className="community-name"><Link className="community-stretch" to={`/communautes/${c.slug}`}>{c.name}</Link></h3>
                    <span className="tiny muted">
                      {fr.communities.roles[c.role]}{counts[c.id] != null ? ` · ${fr.communities.members(counts[c.id] as number)}` : ''}{c.is_private ? ` · ${fr.communities.privateTag}` : ''}
                    </span>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        {others && (
          <section className="community-section" aria-label={fr.communities.discover}>
            <h2 className="community-heading">{fr.communities.discover}</h2>
            {others.length === 0 && <p className="muted">{fr.communities.discoverEmpty}</p>}
            <div className="community-grid">
              {othersShown.map((c) => (
                <article key={c.id} className="panel community-card">
                  <span className="community-avatar" aria-hidden="true">{initials(c.name)}</span>
                  <div className="community-body">
                    <h3 className="community-name">{c.name}</h3>
                    {c.description && <p className="muted community-desc">{c.description}</p>}
                    <p className="tiny muted">
                      {counts[c.id] != null ? fr.communities.members(counts[c.id] as number) : ''}{c.is_private ? ` · ${fr.communities.privateTag}` : ''}
                    </p>
                    {!c.is_private && (
                      <button type="button" className="btn" disabled={busy} onClick={() => void act(() => joinCommunity(c.id))}>{fr.communities.join}</button>
                    )}
                    {c.is_private && askFor !== c.id && (
                      <button type="button" className="btn" onClick={() => { setAskFor(c.id); setAskText('') }}>{fr.communities.ask}</button>
                    )}
                    {c.is_private && askFor === c.id && (
                      <div className="field">
                        <label htmlFor={`ask-${c.id}`}>{fr.communities.askMessage}</label>
                        <textarea id={`ask-${c.id}`} rows={2} maxLength={300} value={askText} onChange={(e) => setAskText(e.target.value)} />
                        <button type="button" className="btn btn-cta" disabled={busy} onClick={() => void sendAsk(c.id)}>{fr.communities.askSend}</button>
                      </div>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}
      </main>
    </AppShell>
  )
}
