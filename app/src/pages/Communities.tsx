import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { Icon } from '../components/Icon'
import { useAuth } from '../auth/AuthContext'
import { fr } from '../i18n/fr'
import { initialsOf } from '../lib/initials'
import baobabArt from '../assets/art/baobab.svg'
import fruitArt from '../assets/art/fruit.svg'
import singeArt from '../assets/art/singe.svg'
import leavesArt from '../assets/art/feuilles.svg'
import { friendlyError } from '../lib/errors'
import {
  communityMemberCount, createCommunity, joinCommunity, listDiscoverCommunities, listMyCommunities, requestToJoin, setCommunityDetails,
  type Community, type CommunityRole, type CommunityTopic,
} from '../lib/api'

type Mine = Community & { role: CommunityRole }

const TOPICS: CommunityTopic[] = ['web', 'ia_data', 'gaming', 'design', 'mobile', 'open_source']
const TOPIC_ICON: Record<CommunityTopic, string> = { web: 'repo', ia_data: 'fork', gaming: 'arena', design: 'souk', mobile: 'repo', open_source: 'fork' }

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
  const [view, setView] = useState<'discover' | 'mine'>('discover')
  const [topic, setTopic] = useState<CommunityTopic | ''>('')
  const [newTopic, setNewTopic] = useState<CommunityTopic | ''>('')
  const [newTags, setNewTags] = useState('')
  const [newActivity, setNewActivity] = useState('')

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
      const id = await createCommunity(slug.trim(), name.trim(), description, isPrivate, isListed)
      const tags = newTags.split(',').map((t) => t.trim()).filter(Boolean)
      if (id && (newTopic || tags.length > 0 || newActivity.trim())) await setCommunityDetails(id, newTopic || null, tags.length > 0 ? tags : null, newActivity.trim() || null)
      setName(''); setSlug(''); setDescription(''); setNewTopic(''); setNewTags(''); setNewActivity('')
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
  const matches = (c: Community) => (!needle || `${c.name} ${c.description ?? ''} ${(c.tags ?? []).join(' ')}`.toLowerCase().includes(needle)) && (!topic || c.topic === topic)
  const mineCommunities = (mine ?? []).filter((c) => !c.project_id)
  const mineShown = mineCommunities.filter(matches)
  const othersShown = (others ?? []).filter(matches)

  const t = fr.communities
  const topicLabel = (c: Community) => (c.topic ? t.topicNames[c.topic] : t.topicOther)

  function Tile({ c }: { c: Community }) {
    return (
      <span className={`community-tile community-topic-${c.topic ?? 'none'}`} aria-hidden="true">
        {c.topic ? <Icon name={TOPIC_ICON[c.topic]} size={22} /> : initialsOf(c.name)}
      </span>
    )
  }

  return (
    <AppShell>
      <main className="page communities-page">
        <div className="page-deco" aria-hidden="true">
          <img src={baobabArt} alt="" />
          <img src={fruitArt} alt="" />
          <img src={singeArt} alt="" />
        </div>
        <header className="communities-hero">
          <div>
            <p className="eyebrow">{t.eyebrow}</p>
            <h1 className="page-title communities-title">{t.heroTitle[0]}<br />{t.heroTitle[1]}</h1>
            <p className="muted communities-lead">{t.heroText}</p>
            <div className="communities-tabs" role="tablist" aria-label={t.title}>
              <button type="button" role="tab" aria-selected={view === 'discover'} className={`pill ${view === 'discover' ? 'pill-on' : ''}`} onClick={() => setView('discover')}>{t.tabDiscover}</button>
              <button type="button" role="tab" aria-selected={view === 'mine'} className={`pill ${view === 'mine' ? 'pill-on' : ''}`} onClick={() => setView('mine')}>{t.tabMine}</button>
            </div>
          </div>
          <div className="communities-art" aria-hidden="true">
            <img className="art-a" src={baobabArt} alt="" />
            <img className="art-b" src={fruitArt} alt="" />
            <img className="art-c" src={singeArt} alt="" />
            <img className="art-d" src={leavesArt} alt="" />
            <span className="mono tiny muted">{t.heroCaption}</span>
          </div>
        </header>

        {error && <div className="alert" role="alert">{error}</div>}
        {notice && <div className="notice" role="status">{notice}</div>}
        {failed && (
          <div className="alert" role="alert">
            {t.loadFailed} <button type="button" className="btn" onClick={load}>{t.retry}</button>
          </div>
        )}

        <form className="communities-search" role="search" onSubmit={(e) => e.preventDefault()}>
          <label className="notice-search">
            <Icon name="search" size={16} />
            <input type="search" placeholder={t.searchLong} aria-label={t.searchPlaceholder} value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <button type="submit" className="btn">{t.searchButton}</button>
        </form>
        <div className="notice-filters" role="group" aria-label={t.filterLabel}>
          <button type="button" className="chip" aria-pressed={topic === ''} onClick={() => setTopic('')}>{t.topicAll}</button>
          {TOPICS.map((k) => (
            <button key={k} type="button" className="chip" aria-pressed={topic === k} onClick={() => setTopic(topic === k ? '' : k)}>{t.topics[k]}</button>
          ))}
        </div>

        {!failed && (!mine || !others) && <p className="muted">{fr.common.loading}</p>}

        {view === 'mine' && mine && (
          <section className="community-section" aria-label={t.mine}>
            <div className="communities-section-head">
              <h2 className="community-heading">{t.mine}</h2>
              <span className="muted tiny">{t.mineCount(mineShown.length)}</span>
            </div>
            {mineCommunities.length === 0 && <p className="muted">{t.mineEmpty}</p>}
            {mineCommunities.length > 0 && mineShown.length === 0 && <p className="muted">{t.noMatch}</p>}
            <div className="community-grid">
              {mineShown.map((c) => (
                <article key={c.id} className={`panel community-card community-card-link community-topic-${c.topic ?? 'none'}`}>
                  <Tile c={c} />
                  <div className="community-body">
                    <p className="community-kind">{topicLabel(c)}</p>
                    <h3 className="community-name"><Link className="community-stretch" to={`/communautes/${c.slug}`}>{c.name}</Link></h3>
                    <span className="tiny muted">
                      {t.roles[c.role]}{counts[c.id] != null ? ` · ${t.members(counts[c.id] as number)}` : ''}{c.is_private ? ` · ${t.privateTag}` : ''}
                    </span>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        {view === 'discover' && others && (
          <section className="community-section" aria-label={t.discover}>
            <div className="communities-section-head">
              <h2 className="community-heading">{t.discoverTitle}</h2>
              <span className="muted tiny">{t.discoverCount(othersShown.length)}</span>
            </div>
            {others.length === 0 && <p className="muted">{t.discoverEmpty}</p>}
            {others.length > 0 && othersShown.length === 0 && <p className="muted">{t.noMatch}</p>}
            <div className="community-grid community-grid-wide">
              {othersShown.map((c) => (
                <article key={c.id} className={`panel community-card community-card-big community-topic-${c.topic ?? 'none'}`}>
                  <div className="community-card-top">
                    <Tile c={c} />
                    <span className="community-kind">{topicLabel(c)}</span>
                  </div>
                  <h3 className="community-name">{c.name}</h3>
                  {c.description && <p className="muted community-desc">{c.description}</p>}
                  {(c.tags ?? []).length > 0 && (
                    <p className="community-tags">{(c.tags ?? []).map((tag) => <span key={tag} className="tag">{tag}</span>)}</p>
                  )}
                  <p className="tiny muted community-now">
                    {c.activity ? `${t.nowPrefix} · ${c.activity}` : (counts[c.id] != null ? t.members(counts[c.id] as number) : '')}{c.is_private ? ` · ${t.privateTag}` : ''}
                  </p>
                  <div className="community-card-foot">
                    {!c.is_private && <Link className="community-more" to={`/communautes/${c.slug}`}>{t.seeMore} <Icon name="forward" size={14} /></Link>}
                    {!c.is_private && (
                      <button type="button" className="btn" disabled={busy} onClick={() => void act(() => joinCommunity(c.id))}>{t.join}</button>
                    )}
                    {c.is_private && askFor !== c.id && (
                      <button type="button" className="btn" onClick={() => { setAskFor(c.id); setAskText('') }}>{t.ask}</button>
                    )}
                  </div>
                  {c.is_private && askFor === c.id && (
                    <div className="field">
                      <label htmlFor={`ask-${c.id}`}>{t.askMessage}</label>
                      <textarea id={`ask-${c.id}`} rows={2} maxLength={300} value={askText} onChange={(e) => setAskText(e.target.value)} />
                      <button type="button" className="btn btn-cta" disabled={busy} onClick={() => void sendAsk(c.id)}>{t.askSend}</button>
                    </div>
                  )}
                </article>
              ))}
            </div>
          </section>
        )}

        {showCreate && (
          <form className="panel panel-pad community-create" onSubmit={onCreate} noValidate>
            <h2>{t.create}</h2>
            <div className="field">
              <label htmlFor="c-name">{t.createName}</label>
              <input id="c-name" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="c-slug">{t.createSlug}</label>
              <input id="c-slug" maxLength={40} value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} />
            </div>
            <div className="field">
              <label htmlFor="c-desc">{t.createDescription}</label>
              <textarea id="c-desc" rows={3} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="c-topic">{t.createTopic}</label>
              <select id="c-topic" value={newTopic} onChange={(e) => setNewTopic(e.target.value as CommunityTopic | '')}>
                <option value="">{t.createTopicNone}</option>
                {TOPICS.map((k) => <option key={k} value={k}>{t.topicNames[k]}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="c-tags">{t.createTags}</label>
              <input id="c-tags" maxLength={120} value={newTags} onChange={(e) => setNewTags(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="c-now">{t.createActivity}</label>
              <input id="c-now" maxLength={80} value={newActivity} onChange={(e) => setNewActivity(e.target.value)} />
            </div>
            <label className="check-row">
              <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} /> {t.createPrivate}
            </label>
            {isPrivate && (
              <label className="check-row">
                <input type="checkbox" checked={isListed} onChange={(e) => setIsListed(e.target.checked)} /> {t.createListed}
              </label>
            )}
            <p><button className="btn btn-cta" type="submit" disabled={busy || !name.trim() || !slug.trim()}>{t.createSubmit}</button></p>
          </form>
        )}

        <section className="panel communities-niche" aria-label={t.nicheTitle}>
          <div>
            <h2>{t.nicheTitle}</h2>
            <p className="muted">{t.nicheText}</p>
          </div>
          <button type="button" className="btn btn-cta btn-icon" aria-expanded={showCreate} onClick={() => setShowCreate((v) => !v)}><Icon name="plus" size={16} /> {t.create}</button>
        </section>

        <footer className="communities-foot">
          <span className="muted tiny">{t.footerText}</span>
        </footer>
      </main>
    </AppShell>
  )
}
