import { dateLocale } from '../i18n/lang'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { fr } from '../i18n/fr'
import { friendlyError } from '../lib/errors'
import { applyToOffer, getJobOffer, type JobOfferDetail } from '../lib/api'

export function JobDetail() {
  const { id = '' } = useParams()
  const [offer, setOffer] = useState<JobOfferDetail | null | undefined>(undefined)
  const [failed, setFailed] = useState(false)
  const [message, setMessage] = useState('')
  const [includeCv, setIncludeCv] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  const load = useCallback(() => {
    setFailed(false)
    setOffer(undefined)
    getJobOffer(id).then(setOffer).catch(() => setFailed(true))
  }, [id])
  useEffect(load, [load])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await applyToOffer(id, message, includeCv)
      setSent(true)
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  const needFile = error === fr.errors.needFile

  return (
    <AppShell>
      <main className="page jobs">
        <p><Link to="/jobs">← {fr.jobDetail.back}</Link></p>
        {failed && (
          <div className="alert" role="alert">
            {fr.jobDetail.loadFailed} <button type="button" className="btn" onClick={load}>{fr.jobDetail.retry}</button>
          </div>
        )}
        {!failed && offer === undefined && <p className="muted">{fr.common.loading}</p>}
        {offer === null && <p className="muted">{fr.jobDetail.notFound}</p>}

        {offer && (
          <>
            <header className="page-head">
              <h1 className="page-title">{offer.title}</h1>
              <p className="muted">
                {offer.employer_name} · {[offer.location, fr.jobs.remotes[offer.remote]].filter(Boolean).join(' · ')}
              </p>
              <div className="project-tags">
                <span className="tag">{offer.employment_type ? fr.jobs.contracts[offer.employment_type as keyof typeof fr.jobs.contracts] : fr.jobs.kinds.freelance}</span>
                {offer.tags.map((t) => <span key={t} className="tag">{t}</span>)}
              </div>
              <p className="mono tiny">
                {(offer.pay_min_fcfa !== null || offer.pay_max_fcfa !== null) ? fr.jobs.payRange(offer.pay_min_fcfa, offer.pay_max_fcfa, offer.pay_unit) : ''}
                {offer.pay_negotiable ? ` ${fr.jobs.negotiable}` : ''}
                {offer.closes_on ? ` · ${fr.jobs.closes(new Date(offer.closes_on).toLocaleDateString(dateLocale()))}` : ''}
              </p>
            </header>

            <section className="panel" style={{ marginBottom: 24 }}>
              <h2>{fr.jobDetail.about}</h2>
              {/* Plain text only: line breaks are kept, nothing from the offer is ever treated as markup. */}
              <p style={{ whiteSpace: 'pre-wrap' }}>{offer.description}</p>
            </section>

            <section className="panel">
              <h2>{fr.jobDetail.applyTitle}</h2>
              {sent ? (
                <>
                  <div className="notice" role="status">{fr.jobDetail.sent}</div>
                  <Link className="btn" to="/jobs">{fr.jobDetail.seeApplications}</Link>
                </>
              ) : (
                <form onSubmit={onSubmit} noValidate>
                  {error && <div className="alert" role="alert">{error}</div>}
                  {needFile && <p><Link className="btn" to="/dossier">{fr.jobDetail.fillFile}</Link></p>}
                  <div className="field">
                    <label htmlFor="message">{fr.jobDetail.messageLabel}</label>
                    <textarea id="message" rows={5} maxLength={2000} value={message} onChange={(e) => setMessage(e.target.value)} />
                    <span className="hint">{fr.jobDetail.messageHint}</span>
                  </div>
                  <label style={{ display: 'block', marginBottom: 16 }}>
                    <input type="checkbox" checked={includeCv} onChange={(e) => setIncludeCv(e.target.checked)} /> {fr.jobDetail.includeCv}
                  </label>
                  <button className="btn btn-cta" type="submit" disabled={busy}>{busy ? fr.jobDetail.sending : fr.jobDetail.send}</button>
                </form>
              )}
            </section>
          </>
        )}
      </main>
    </AppShell>
  )
}
