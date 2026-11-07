import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { useDebounced } from '../hooks'
import { fr } from '../i18n/fr'
import { searchEverything, type SearchHit, type SearchKind } from '../lib/api'

const ORDER: SearchKind[] = ['project', 'member', 'community', 'quest']

function target(h: SearchHit): { to?: string; href?: string } {
  if (h.kind === 'member') return { to: `/profil/${h.slug}` }
  if (h.kind === 'quest') return { to: `/quetes/${h.slug}` }
  if (h.kind === 'community') return { to: `/communautes/${h.slug}` }
  return { href: `https://github.com/${h.slug}` }
}

export function Search() {
  const [params, setParams] = useSearchParams()
  const [text, setText] = useState(params.get('q') ?? '')
  const query = useDebounced(text).trim()
  const [hits, setHits] = useState<SearchHit[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    setParams(query ? { q: query } : {}, { replace: true })
    if (query.length < 2) { setHits(null); setFailed(false); return }
    let alive = true
    setFailed(false)
    searchEverything(query).then((h) => { if (alive) setHits(h) }).catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
    // setParams changes on every render of the router; only the typed text matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, reload])

  return (
    <AppShell>
      <main className="page souk">
        <header className="page-head">
          <h1 className="page-title">{fr.search.title}</h1>
          <p className="muted">{fr.search.subtitle}</p>
        </header>
        <div className="field">
          <label htmlFor="q">{fr.search.label}</label>
          <input id="q" type="search" value={text} onChange={(e) => setText(e.target.value)} autoFocus />
        </div>
        {text.trim().length > 0 && text.trim().length < 2 && <p className="muted">{fr.search.tooShort}</p>}
        {failed && (
          <div className="alert" role="alert">
            {fr.search.failed} <button type="button" className="btn" onClick={() => setReload((n) => n + 1)}>{fr.search.retry}</button>
          </div>
        )}
        {hits && hits.length === 0 && <p className="muted">{fr.search.none(query)}</p>}
        {hits && ORDER.map((kind) => {
          const group = hits.filter((h) => h.kind === kind)
          if (group.length === 0) return null
          return (
            <section key={kind} className="panel" style={{ marginBottom: 16 }}>
              <h2>{fr.search.groups[kind]}</h2>
              {group.map((h) => {
                const t = target(h)
                return (
                  <div key={`${h.kind}-${h.id}`} style={{ padding: '6px 0' }}>
                    {t.to ? <Link to={t.to}>{h.title}</Link> : <a href={t.href} target="_blank" rel="noreferrer">{h.title}</a>}
                    {h.subtitle && <span className="muted"> — {h.subtitle}</span>}
                    {!t.to && <span className="muted tiny"> ({fr.search.openOnGithub})</span>}
                  </div>
                )
              })}
            </section>
          )
        })}
      </main>
    </AppShell>
  )
}
