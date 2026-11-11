import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { closeJobOffer, deleteJobOffer, listMyOffers, publishJobOffer, unpublishJobOffer, type MyOffer } from '../lib/api'
import { friendlyError } from '../lib/errors'
import { fr } from '../i18n/fr'

/**
 * The job offers of one member, as a tab on their profile.
 * On your own profile you see every offer and can manage it; on someone else's you see only what is published.
 */
export function MyOffers({ userId, own }: { userId: string; own: boolean }) {
  const t = fr.employer
  const [offers, setOffers] = useState<MyOffer[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    setFailed(false)
    listMyOffers(userId).then((list) => setOffers(list.filter((o) => own || (o.status === 'published' && !o.staff_hidden)))).catch(() => setFailed(true))
  }, [userId, own])
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
        <h2 id="pof">{own ? fr.profile.tabs.offers : fr.profile.offersOther}</h2>
        {own ? <Link className="btn btn-cta" to="/jobs/nouvelle">{t.newOffer}</Link> : null}
      </div>
      {failed && <div className="alert" role="alert">{t.loadFailed} <button type="button" className="btn" onClick={load}>{t.retry}</button></div>}
      {!failed && offers === null && <p className="muted">{fr.common.loading}</p>}
      {notice && <div className="notice" role="status">{notice}</div>}
      {error && <div className="alert" role="alert">{error}</div>}
      {offers && offers.length === 0 && <p className="muted">{own ? t.noOffers : fr.profile.noOffersOther}</p>}
      {offers && offers.map((o) => (
        <article key={o.id} className="panel panel-pad post-row">
          <h3>
            {o.status === 'published' ? <Link to={`/jobs/${o.id}`}>{o.title}</Link> : o.title}{' '}
            {own ? <span className="tag">{t.offerStatus[o.status]}</span> : null}
            {own && o.staff_hidden ? <span className="tag">{t.hiddenByStaff}</span> : null}
          </h3>
          <p className="muted tiny">{[o.location, fr.jobs.remotes[o.remote as keyof typeof fr.jobs.remotes]].filter(Boolean).join(' · ')}</p>
          {own && o.status === 'rejected' && o.review_note && <p className="muted">{t.reason(o.review_note)}</p>}
          {own && (
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
