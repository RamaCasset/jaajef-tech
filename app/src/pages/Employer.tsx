import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { useAuth } from '../auth/AuthContext'
import {
  closeJobOffer, createEmployer, deleteJobOffer, getMyEmployer, listMyOffers, publishJobOffer, unpublishJobOffer, updateEmployer,
  type EmployerInput, type MyEmployer, type MyOffer,
} from '../lib/api'
import { friendlyError } from '../lib/errors'
import { fr } from '../i18n/fr'

function ProfileForm({ current, onDone }: { current: MyEmployer | null; onDone: (message: string) => void }) {
  const t = fr.employer
  const [v, setV] = useState<EmployerInput>({
    kind: current?.kind ?? 'company', name: current?.name ?? '', description: current?.description ?? '',
    website: current?.website ?? '', location: current?.location ?? '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = <K extends keyof EmployerInput>(k: K, val: EmployerInput[K]) => setV((x) => ({ ...x, [k]: val }))

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      if (current) await updateEmployer({ ...v, name: v.name.trim() }, current.logo_url)
      else await createEmployer({ ...v, name: v.name.trim() })
      onDone(current ? t.saved : t.created)
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)}>
      {error && <div className="alert" role="alert">{error}</div>}
      {!current && (
        <div className="field">
          <label htmlFor="emp-kind">{t.kind}</label>
          <select id="emp-kind" value={v.kind} onChange={(e) => set('kind', e.target.value as EmployerInput['kind'])}>
            <option value="company">{t.kinds.company}</option>
            <option value="individual">{t.kinds.individual}</option>
          </select>
        </div>
      )}
      <div className="field"><label htmlFor="emp-name">{t.name}</label><input id="emp-name" value={v.name} maxLength={100} onChange={(e) => set('name', e.target.value)} /></div>
      <div className="field"><label htmlFor="emp-desc">{t.description}</label><textarea id="emp-desc" rows={3} maxLength={1000} value={v.description} onChange={(e) => set('description', e.target.value)} /></div>
      <div className="field"><label htmlFor="emp-web">{t.website}</label><input id="emp-web" type="url" placeholder="https://" maxLength={300} value={v.website} onChange={(e) => set('website', e.target.value)} /></div>
      <div className="field"><label htmlFor="emp-place">{t.place}</label><input id="emp-place" maxLength={100} value={v.location} onChange={(e) => set('location', e.target.value)} /></div>
      <button type="submit" className="btn btn-cta" disabled={busy || v.name.trim().length < 2}>{current ? t.save : t.create}</button>
    </form>
  )
}

export function Employer() {
  const t = fr.employer
  const { member } = useAuth()
  const me = member?.profile.id ?? ''
  const [loaded, setLoaded] = useState(false)
  const [employer, setEmployer] = useState<MyEmployer | null>(null)
  const [offers, setOffers] = useState<MyOffer[]>([])
  const [failed, setFailed] = useState(false)
  const [editing, setEditing] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    setFailed(false)
    getMyEmployer(me)
      .then(async (e) => { setEmployer(e); setOffers(e ? await listMyOffers(me) : []); setLoaded(true) })
      .catch(() => setFailed(true))
  }, [me])
  useEffect(load, [load])

  async function act(fn: () => Promise<unknown>, message: (r: unknown) => string) {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const r = await fn()
      setNotice(message(r))
      load()
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AppShell>
      <main className="page jobs">
        <p><Link to="/jobs">← {fr.jobs.title}</Link></p>
        <header className="page-head">
          <h1 className="page-title">{t.title}</h1>
          <p className="muted">{t.subtitle}</p>
        </header>
        {failed && <div className="alert" role="alert">{t.loadFailed} <button type="button" className="btn" onClick={load}>{t.retry}</button></div>}
        {!loaded && !failed && <p className="muted">{fr.common.loading}</p>}
        {notice && <div className="notice" role="status">{notice}</div>}
        {error && <div className="alert" role="alert">{error}</div>}

        {loaded && !employer && (
          <section className="panel">
            <h2>{t.createTitle}</h2>
            <p className="muted">{t.createHint}</p>
            <ProfileForm current={null} onDone={(m) => { setNotice(m); load() }} />
          </section>
        )}

        {loaded && employer && (
          <>
            <section className="panel" style={{ marginBottom: 16 }}>
              <h2>{employer.name}</h2>
              <p>{t.profileStatus[employer.status]}</p>
              {employer.status === 'rejected' && employer.review_note && <p className="muted">{t.reason(employer.review_note)}</p>}
              {editing
                ? <ProfileForm current={employer} onDone={(m) => { setEditing(false); setNotice(m); load() }} />
                : <button type="button" className="btn" onClick={() => setEditing(true)}>{t.editProfile}</button>}
            </section>

            <section className="panel">
              <h2>{t.offers}</h2>
              <p><Link className="btn btn-cta" to="/employeur/offres/nouvelle">{t.newOffer}</Link></p>
              {offers.length === 0 && <p className="muted">{t.noOffers}</p>}
              <ul style={{ listStyle: 'none', padding: 0 }}>
                {offers.map((o) => (
                  <li key={o.id} style={{ padding: '8px 0', borderTop: '1px solid var(--line)' }}>
                    <strong>{o.title}</strong>{' '}
                    <span className="tag">{t.offerStatus[o.status]}</span>
                    {o.staff_hidden && <span className="tag">{t.hiddenByStaff}</span>}
                    {o.status === 'rejected' && o.review_note && <p className="muted" style={{ margin: 0 }}>{t.reason(o.review_note)}</p>}
                    <p style={{ margin: '4px 0 0' }}>
                      <Link to={`/employeur/offres/${o.id}`} aria-label={`${t.edit} : ${o.title}`}>{t.edit}</Link>{' '}
                      <Link to={`/employeur/offres/${o.id}/candidatures`} aria-label={`${t.applicants} : ${o.title}`}>{t.applicants}</Link>{' '}
                      {(o.status === 'draft' || o.status === 'rejected' || o.status === 'closed') && (
                        <button type="button" className="btn" disabled={busy} aria-label={`${t.publish} : ${o.title}`}
                          onClick={() => void act(() => publishJobOffer(o.id), (r) => (r === 'pending_review' ? t.sentForReview : t.published))}>{t.publish}</button>
                      )}{' '}
                      {o.status === 'published' && (
                        <button type="button" className="btn" disabled={busy} aria-label={`${t.close} : ${o.title}`}
                          onClick={() => void act(() => closeJobOffer(o.id), () => t.done)}>{t.close}</button>
                      )}{' '}
                      {(o.status === 'published' || o.status === 'pending_review') && (
                        <button type="button" className="btn" disabled={busy} aria-label={`${t.unpublish} : ${o.title}`}
                          onClick={() => void act(() => unpublishJobOffer(o.id), () => t.done)}>{t.unpublish}</button>
                      )}{' '}
                      <button type="button" className="btn" disabled={busy} aria-label={`${t.remove} : ${o.title}`}
                        onClick={() => { if (window.confirm(t.confirmDelete)) void act(() => deleteJobOffer(o.id), () => t.done) }}>{t.remove}</button>
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </main>
    </AppShell>
  )
}
