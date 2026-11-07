import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { StaffGate, isModeration } from '../staff/StaffGate'
import { fr } from '../i18n/fr'
import { friendlyError } from '../lib/errors'
import { listReviewQueue, reviewEmployer, reviewJobOffer, type ReviewItem } from '../lib/api'

function ReviewCard({ item, onDone }: { item: ReviewItem; onDone: () => void }) {
  const t = fr.staff.review
  const [rejecting, setRejecting] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function decide(approve: boolean) {
    setError(null)
    setBusy(true)
    try {
      await (item.kind === 'employer' ? reviewEmployer(item.id, approve, note) : reviewJobOffer(item.id, approve, note))
      onDone()
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <article className="panel" style={{ marginBottom: 16 }}>
      <h3 style={{ marginTop: 0 }}><span className="tag">{t.kinds[item.kind]}</span> {item.title}</h3>
      <p className="tiny muted">
        <Link to={`/profil/${item.owner_username}`}>{t.by(item.owner_username)}</Link> · {new Date(item.created_at).toLocaleDateString('fr-FR')}
      </p>
      {item.kind === 'offer' && <p className="tiny muted">{t.approveOfferHint}</p>}
      {error && <div className="alert" role="alert">{error}</div>}
      {!rejecting ? (
        <p>
          <button type="button" className="btn btn-cta" disabled={busy} aria-label={`${t.approve} : ${item.title}`} onClick={() => void decide(true)}>{t.approve}</button>{' '}
          <button type="button" className="btn" disabled={busy} aria-label={`${t.reject} : ${item.title}`} onClick={() => setRejecting(true)}>{t.reject}</button>
        </p>
      ) : (
        <div>
          <div className="field">
            <label htmlFor={`rej-${item.id}`}>{t.noteLabel}</label>
            <textarea id={`rej-${item.id}`} rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
            <span className="hint">{t.noteHint}</span>
          </div>
          <button type="button" className="btn btn-cta" disabled={busy || !note.trim()} onClick={() => void decide(false)}>{t.confirmReject}</button>{' '}
          <button type="button" className="btn" onClick={() => setRejecting(false)}>{t.cancel}</button>
        </div>
      )}
    </article>
  )
}

function StaffReviewPage() {
  const [items, setItems] = useState<ReviewItem[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [notice, setNotice] = useState(false)

  const load = useCallback(() => {
    setFailed(false)
    listReviewQueue().then(setItems).catch(() => setFailed(true))
  }, [])
  useEffect(load, [load])

  return (
    <AppShell>
        <main className="page souk">
          <p><Link to="/equipe">← {fr.staff.back}</Link></p>
          <h1 className="page-title">{fr.staff.review.title}</h1>
          {notice && <div className="notice" role="status">{fr.staff.review.done}</div>}
          {failed && (
            <div className="alert" role="alert">
              {fr.staff.loadFailed} <button type="button" className="btn" onClick={load}>{fr.staff.retry}</button>
            </div>
          )}
          {!failed && !items && <p className="muted">{fr.common.loading}</p>}
          {items && items.length === 0 && <p className="muted">{fr.staff.review.empty}</p>}
          {(items ?? []).map((i) => <ReviewCard key={`${i.kind}-${i.id}`} item={i} onDone={() => { setNotice(true); load() }} />)}
        </main>
    </AppShell>
  )
}

export function StaffReview() {
  return (
    <StaffGate allow={isModeration}>
      <StaffReviewPage />
    </StaffGate>
  )
}
