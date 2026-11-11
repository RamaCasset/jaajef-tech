import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { listMyApplications, withdrawApplication, type MyApplication } from '../lib/api'
import { friendlyError } from '../lib/errors'
import { dateLocale } from '../i18n/lang'
import { fr } from '../i18n/fr'

/** The jobs you applied to, with where each one stands. A tab on your own profile. */
export function MyApplications() {
  const t = fr.jobs
  const [apps, setApps] = useState<MyApplication[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    setFailed(false)
    listMyApplications().then(setApps).catch(() => setFailed(true))
  }, [])
  useEffect(load, [load])

  async function withdraw(id: string) {
    setBusyId(id)
    setError(null)
    setNotice(null)
    try {
      await withdrawApplication(id)
      setNotice(t.withdrawn)
      load()
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section aria-labelledby="pap">
      <div className="profile-colhead"><h2 id="pap">{fr.profile.tabs.applications}</h2><Link to="/jobs">{t.title}</Link></div>
      {failed && <div className="alert" role="alert">{t.error} <button type="button" className="btn" onClick={load}>{t.retry}</button></div>}
      {!failed && apps === null && <p className="muted">{fr.common.loading}</p>}
      {notice && <div className="notice" role="status">{notice}</div>}
      {error && <div className="alert" role="alert">{error}</div>}
      {apps && apps.length === 0 && <p className="muted">{t.applicationsEmpty}</p>}
      {apps && apps.map((a) => (
        <article key={a.id} className="panel panel-pad post-row">
          <h3>
            {a.offer_open ? <Link to={`/jobs/${a.offer_id}`}>{a.offer_title}</Link> : a.offer_title}{' '}
            <span className={`tag app-status app-status-${a.status}`}>{t.statuses[a.status]}</span>
          </h3>
          <p className="muted tiny">{a.employer_name} · {t.appliedOn(new Date(a.applied_at).toLocaleDateString(dateLocale()))}</p>
          <p className="tiny">{t.statusHints[a.status]}{!a.offer_open && (a.status === 'submitted' || a.status === 'seen') ? ` ${t.offerClosedHint}` : ''}</p>
          {a.status !== 'withdrawn' && a.status !== 'declined' ? (
            <p><button type="button" className="btn" disabled={busyId === a.id} onClick={() => void withdraw(a.id)}>{t.withdraw}</button></p>
          ) : null}
        </article>
      ))}
    </section>
  )
}
