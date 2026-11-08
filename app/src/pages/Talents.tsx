import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { useDebounced } from '../hooks'
import {
  joinTalentDirectory, leaveTalentDirectory, myTalentListing, searchTalent,
  type MyTalentListing, type TalentCard, type TalentFilters,
} from '../lib/api'
import { friendlyError } from '../lib/errors'
import { fr } from '../i18n/fr'

const EMPTY: TalentFilters = { query: '', place: '', kind: '', availability: '' }

function MyListing() {
  const t = fr.talent.mine
  const [mine, setMine] = useState<MyTalentListing | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => { myTalentListing().then(setMine).catch(() => setMine(null)) }, [])
  useEffect(load, [load])

  async function change(join: boolean) {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await (join ? joinTalentDirectory() : leaveTalentDirectory())
      setNotice(join ? t.joined : t.left)
      load()
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  if (!mine) return null
  const status = mine.hidden_by_staff ? t.hiddenStaff : !mine.listed ? t.off : mine.visible ? t.on : t.hiddenOn
  return (
    <section className="panel panel-pad" style={{ marginBottom: 16 }} aria-label={t.title}>
      <h2>{t.title}</h2>
      <p className="muted">{t.hint}</p>
      <p>{status}</p>
      {notice && <div className="notice" role="status">{notice}</div>}
      {error && <div className="alert" role="alert">{error}</div>}
      <p>
        {mine.listed
          ? <button type="button" className="btn" disabled={busy} onClick={() => void change(false)}>{t.leave}</button>
          : <button type="button" className="btn btn-cta" disabled={busy} onClick={() => void change(true)}>{t.join}</button>}
        {' '}<Link to="/dossier">{t.editFile}</Link>
      </p>
    </section>
  )
}

export function Talents() {
  const t = fr.talent
  const [filters, setFilters] = useState<TalentFilters>(EMPTY)
  const query = useDebounced(filters.query)
  const place = useDebounced(filters.place)
  const [list, setList] = useState<TalentCard[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [reload, setReload] = useState(0)
  const set = <K extends keyof TalentFilters>(k: K, v: TalentFilters[K]) => setFilters((f) => ({ ...f, [k]: v }))

  useEffect(() => {
    let alive = true
    setFailed(false)
    setList(null)
    searchTalent({ ...filters, query, place })
      .then((r) => { if (alive) setList(r) })
      .catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
    // The two typed fields are read through their debounced copies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, place, filters.kind, filters.availability, reload])

  const filtersOn = filters.query || filters.place || filters.kind || filters.availability

  return (
    <AppShell>
      <main className="page jobs">
        <header className="page-head">
          <h1 className="page-title">{t.title}</h1>
          <p className="muted">{t.subtitle}</p>
        </header>
        <MyListing />
        <div className="jobs-filters">
          <input type="search" aria-label={t.search} placeholder={t.search} value={filters.query} onChange={(e) => set('query', e.target.value)} />
          <input type="text" aria-label={t.place} placeholder={t.place} value={filters.place} onChange={(e) => set('place', e.target.value)} />
          <label>{t.kind}
            <select value={filters.kind} onChange={(e) => set('kind', e.target.value as TalentFilters['kind'])}>
              <option value="">{t.any}</option>
              <option value="job">{t.kinds.job}</option>
              <option value="freelance">{t.kinds.freelance}</option>
            </select>
          </label>
          <label>{t.availability}
            <select value={filters.availability} onChange={(e) => set('availability', e.target.value)}>
              <option value="">{t.any}</option>
              {Object.entries(t.availabilities).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          {filtersOn ? <button type="button" className="btn" onClick={() => setFilters(EMPTY)}>{t.reset}</button> : null}
        </div>
        {failed && (
          <div role="alert" className="alert">
            {t.loadFailed} <button type="button" className="btn" onClick={() => setReload((n) => n + 1)}>{t.retry}</button>
          </div>
        )}
        {list === null && !failed && <p className="muted">{fr.common.loading}</p>}
        {list && list.length === 0 && <p className="muted">{t.empty}</p>}
        {list && list.length > 0 && (
          <>
            <p className="muted">{t.count(list.length)}</p>
            <div className="jobs-list">
              {list.map((p) => (
                <article key={p.user_id} className="panel job-card">
                  <div className="job-main">
                    <h3><Link to={`/talents/${p.user_id}`}>{p.display_name}</Link></h3>
                    <p>{p.headline}</p>
                    <p className="muted">
                      {[
                        p.location,
                        p.experience_years != null ? t.years(p.experience_years) : null,
                        p.availability ? t.availabilities[p.availability as keyof typeof t.availabilities] : null,
                        p.portfolio_count > 0 ? t.projects(p.portfolio_count) : null,
                      ].filter(Boolean).join(' · ')}
                    </p>
                    {p.skills.length > 0 && <p>{p.skills.slice(0, 6).map((k) => <span key={k} className="tag">{k}</span>)}</p>}
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
      </main>
    </AppShell>
  )
}
