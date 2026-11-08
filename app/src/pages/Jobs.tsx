import { dateLocale } from '../i18n/lang'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { JobCard } from '../components/JobCard'
import { useDebounced } from '../hooks'
import {
  listMyApplications, listSavedOffers, saveOffer, searchJobs, unsaveOffer, withdrawApplication,
  type JobFilters, type JobOffer, type MyApplication, type SavedOffer,
} from '../lib/api'
import { friendlyError } from '../lib/errors'
import { fr } from '../i18n/fr'

type Tab = 'all' | 'saved' | 'applications'
const EMPTY: JobFilters = { query: '', place: '', kind: '', contract: '', remote: '', sort: 'recent' }

export function Jobs() {
  const [tab, setTab] = useState<Tab>('all')
  const [filters, setFilters] = useState<JobFilters>(EMPTY)
  const query = useDebounced(filters.query)
  const place = useDebounced(filters.place)
  const [jobs, setJobs] = useState<JobOffer[] | null>(null)
  const [saved, setSaved] = useState<SavedOffer[] | null>(null)
  const [apps, setApps] = useState<MyApplication[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [reload, setReload] = useState(0)

  const set = <K extends keyof JobFilters>(k: K, v: JobFilters[K]) => setFilters((f) => ({ ...f, [k]: v }))

  const loadSaved = useCallback(async () => { setSaved(await listSavedOffers()) }, [])

  useEffect(() => {
    let alive = true
    setFailed(false)
    if (tab === 'all') {
      setJobs(null)
      Promise.all([searchJobs({ ...filters, query, place }), loadSaved()])
        .then(([list]) => { if (alive) setJobs(list) })
        .catch(() => { if (alive) setFailed(true) })
    } else if (tab === 'saved') {
      setSaved(null)
      loadSaved().catch(() => { if (alive) setFailed(true) })
    } else {
      setApps(null)
      listMyApplications().then((a) => { if (alive) setApps(a) }).catch(() => { if (alive) setFailed(true) })
    }
    return () => { alive = false }
    // The two typed fields are read through their debounced copies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, query, place, filters.kind, filters.contract, filters.remote, filters.sort, loadSaved, reload])

  const savedIds = new Set((saved ?? []).map((s) => s.offer_id))

  async function toggle(id: string) {
    setBusyId(id)
    setNotice(null)
    try {
      if (savedIds.has(id)) await unsaveOffer(id)
      else await saveOffer(id)
      await loadSaved()
    } catch (e) {
      setNotice(friendlyError(e))
    } finally {
      setBusyId(null)
    }
  }

  async function withdraw(id: string) {
    setBusyId(id)
    setNotice(null)
    try {
      await withdrawApplication(id)
      setApps(await listMyApplications())
      setNotice(fr.jobs.withdrawn)
    } catch (e) {
      setNotice(friendlyError(e))
    } finally {
      setBusyId(null)
    }
  }

  const retry = () => setReload((n) => n + 1)
  const filtersOn = filters.query || filters.place || filters.kind || filters.contract || filters.remote

  return (
    <AppShell>
      <main className="page jobs">
        <header className="page-head-row">
          <div>
            <h1 className="page-title">{fr.jobs.title}</h1>
            <p className="muted">{fr.jobs.subtitle}</p>
            <p className="tiny"><Link to="/dossier">{fr.jobs.myFile}</Link> · <Link to="/talents">{fr.jobs.talentLink}</Link></p>
          </div>
          <Link className="btn btn-cta" to="/employeur">{fr.jobs.employerLink}</Link>
        </header>

        <div role="tablist" className="souk-tabs">
          {(['all', 'saved', 'applications'] as Tab[]).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} className={`pill ${tab === t ? 'pill-on' : ''}`} onClick={() => setTab(t)}>{fr.jobs.tabs[t]}</button>
          ))}
        </div>

        {notice ? <p role={notice === fr.jobs.withdrawn ? 'status' : 'alert'} className={notice === fr.jobs.withdrawn ? 'notice' : 'alert'}>{notice}</p> : null}
        {failed ? (
          <div role="alert" className="alert">
            {fr.jobs.error} <button type="button" className="btn" onClick={retry}>{fr.jobs.retry}</button>
          </div>
        ) : null}

        {tab === 'all' && (
          <>
            <div className="jobs-search">
              <input type="search" role="searchbox" aria-label={fr.jobs.search} placeholder={fr.jobs.search} value={filters.query} onChange={(e) => set('query', e.target.value)} />
              <input type="text" aria-label={fr.jobs.place} placeholder={fr.jobs.place} value={filters.place} onChange={(e) => set('place', e.target.value)} />
            </div>
            <div className="jobs-layout">
              <aside className="panel jobs-aside" aria-label={fr.jobs.filters}>
                <label>{fr.jobs.kind}
                  <select value={filters.kind} onChange={(e) => set('kind', e.target.value as JobFilters['kind'])}>
                    <option value="">{fr.jobs.any}</option>
                    <option value="job">{fr.jobs.kinds.job}</option>
                    <option value="freelance">{fr.jobs.kinds.freelance}</option>
                  </select>
                </label>
                <label>{fr.jobs.contract}
                  <select value={filters.contract} onChange={(e) => set('contract', e.target.value)}>
                    <option value="">{fr.jobs.any}</option>
                    {Object.entries(fr.jobs.contracts).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </label>
                <label>{fr.jobs.remote}
                  <select value={filters.remote} onChange={(e) => set('remote', e.target.value)}>
                    <option value="">{fr.jobs.any}</option>
                    {Object.entries(fr.jobs.remotes).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </label>
                <label>{fr.jobs.sort}
                  <select value={filters.sort} onChange={(e) => set('sort', e.target.value as JobFilters['sort'])}>
                    <option value="recent">{fr.jobs.sorts.recent}</option>
                    <option value="pay">{fr.jobs.sorts.pay}</option>
                  </select>
                </label>
                {filtersOn ? <button type="button" className="btn" onClick={() => setFilters(EMPTY)}>{fr.jobs.reset}</button> : null}
              </aside>
              <div className="jobs-results">
            {jobs === null && !failed ? <p className="muted">{fr.common.loading}</p> : null}
            {jobs && jobs.length === 0 ? <p className="muted">{fr.jobs.empty}</p> : null}
            {jobs && jobs.length > 0 ? (
              <>
                <p className="muted">{fr.jobs.count(jobs.length)}</p>
                <div className="jobs-list">
                  {jobs.map((j) => (
                    <JobCard key={j.id} job={j} saved={savedIds.has(j.id)} busy={busyId === j.id} onToggleSave={() => void toggle(j.id)} />
                  ))}
                </div>
              </>
            ) : null}
              </div>
            </div>
          </>
        )}

        {tab === 'saved' && (
          saved === null ? (failed ? null : <p className="muted">{fr.common.loading}</p>)
          : saved.length === 0 ? <p className="muted">{fr.jobs.savedEmpty}</p>
          : (
            <div className="jobs-list">
              {saved.map((s) => (
                <article key={s.offer_id} className="panel job-card">
                  <div className="job-main">
                    <h3><Link to={`/jobs/${s.offer_id}`}>{s.title}</Link></h3>
                    <p className="muted">{s.employer_name} · {[s.location, fr.jobs.remotes[s.remote as keyof typeof fr.jobs.remotes]].filter(Boolean).join(' · ')}</p>
                    {!s.is_listed ? <span className="tag">{fr.jobs.notListed}</span> : null}
                  </div>
                  <button type="button" className="btn" disabled={busyId === s.offer_id} aria-pressed="true" onClick={() => void toggle(s.offer_id)}
                    aria-label={`${fr.jobs.unsave} : ${s.title}`}>★</button>
                </article>
              ))}
            </div>
          )
        )}

        {tab === 'applications' && (
          apps === null ? (failed ? null : <p className="muted">{fr.common.loading}</p>)
          : apps.length === 0 ? <p className="muted">{fr.jobs.applicationsEmpty}</p>
          : (
            <div className="jobs-list">
              {apps.map((a) => (
                <article key={a.id} className="panel job-card">
                  <div className="job-main">
                    <h3><Link to={`/jobs/${a.offer_id}`}>{a.offer_title}</Link></h3>
                    <p className="muted">{a.employer_name} · {fr.jobs.appliedOn(new Date(a.applied_at).toLocaleDateString(dateLocale()))}</p>
                  </div>
                  <span className="tag">{fr.jobs.statuses[a.status]}</span>
                  {a.status !== 'withdrawn' && a.status !== 'declined' ? (
                    <button type="button" className="btn" disabled={busyId === a.id} onClick={() => void withdraw(a.id)}>{fr.jobs.withdraw}</button>
                  ) : null}
                </article>
              ))}
            </div>
          )
        )}
      </main>
    </AppShell>
  )
}
