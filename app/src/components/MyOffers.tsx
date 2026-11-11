import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { closeJobOffer, deleteJobOffer, listMyOffers, myOfferApplicantCounts, publishJobOffer, unpublishJobOffer, type MyOffer, type OfferCounts } from '../lib/api'
import { friendlyError } from '../lib/errors'
import { fr } from '../i18n/fr'

/** Your own job offers, as a tab on your profile. Only you see it: other members find offers on the Jobs page. */
export function MyOffers({ userId }: { userId: string }) {
  const t = fr.employer
  const [offers, setOffers] = useState<MyOffer[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [counts, setCounts] = useState<Record<string, OfferCounts>>({})

  const load = useCallback(() => {
    setFailed(false)
    listMyOffers(userId).then((list) => setOffers(list)).catch(() => setFailed(true))
    myOfferApplicantCounts().then(setCounts).catch(() => { /* the counts are a bonus */ })
  }, [userId])
  useEffect(load, [load])

  async function act(fn: () => Promise<unknown>, message: string) {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await fn()
      setNotice(message)
      load()
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby="pof">
      <div className="profile-colhead">
        <h2 id="pof">{fr.profile.tabs.offers}</h2>
        <Link className="btn btn-cta" to="/jobs/nouvelle">{t.newOffer}</Link>
      </div>
      {failed && <div className="alert" role="alert">{t.loadFailed} <button type="button" className="btn" onClick={load}>{t.retry}</button></div>}
      {!failed && offers === null && <p className="muted">{fr.common.loading}</p>}
      {notice && <div className="notice" role="status">{notice}</div>}
      {error && <div className="alert" role="alert">{error}</div>}
      {offers && offers.length === 0 && <p className="muted">{t.noOffers}</p>}
      {offers && offers.map((o) => (
        <article key={o.id} className="panel panel-pad post-row">
          <h3>
            <Link to={`/jobs/${o.id}/candidatures`}>{o.title}</Link>{' '}
            <span className="tag">{t.offerStatus[o.status]}</span>
            {o.staff_hidden ? <span className="tag">{t.hiddenByStaff}</span> : null}
          </h3>
          <p className="muted tiny">{[o.location, fr.jobs.remotes[o.remote as keyof typeof fr.jobs.remotes]].filter(Boolean).join(' · ')}</p>
          {counts[o.id] ? <p className="tiny">{t.applicantsCount(counts[o.id].total, counts[o.id].unseen)}</p> : null}
          {o.status === 'rejected' && o.review_note && <p className="muted">{t.reason(o.review_note)}</p>}
          {(
            <p>
              <Link to={`/jobs/${o.id}/modifier`} aria-label={`${t.edit} : ${o.title}`}>{t.edit}</Link>{' '}
              <Link to={`/jobs/${o.id}/candidatures`} aria-label={`${t.applicants} : ${o.title}`}>{t.applicants}</Link>{' '}
              {(o.status === 'draft' || o.status === 'rejected' || o.status === 'closed') && (
                <button type="button" className="btn" disabled={busy} aria-label={`${t.publish} : ${o.title}`}
                  onClick={() => void act(() => publishJobOffer(o.id), t.published)}>{t.publish}</button>
              )}{' '}
              {o.status === 'published' && (
                <button type="button" className="btn" disabled={busy} aria-label={`${t.close} : ${o.title}`}
                  onClick={() => void act(() => closeJobOffer(o.id), t.done)}>{t.close}</button>
              )}{' '}
              {(o.status === 'published' || o.status === 'pending_review') && (
                <button type="button" className="btn" disabled={busy} aria-label={`${t.unpublish} : ${o.title}`}
                  onClick={() => void act(() => unpublishJobOffer(o.id), t.done)}>{t.unpublish}</button>
              )}{' '}
              <button type="button" className="btn" disabled={busy} aria-label={`${t.remove} : ${o.title}`}
                onClick={() => { if (window.confirm(t.confirmDelete)) void act(() => deleteJobOffer(o.id), t.done) }}>{t.remove}</button>
            </p>
          )}
        </article>
      ))}
    </section>
  )
}
