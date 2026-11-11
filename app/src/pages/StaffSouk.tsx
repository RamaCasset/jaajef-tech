import { dateLocale } from '../i18n/lang'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { fr } from '../i18n/fr'
import { friendlyError } from '../lib/errors'
import { listSoukSubmissions, reviewSoukSubmission, type SoukSubmissionStaff } from '../lib/api'

type Tab = 'pending' | 'approved' | 'rejected'
const TABS: Tab[] = ['pending', 'approved', 'rejected']

function SubmissionCard({ item, mine, onDone }: { item: SoukSubmissionStaff; mine: boolean; onDone: () => void }) {
  const t = fr.staff.souk
  const [rejecting, setRejecting] = useState(false)
  const [note, setNote] = useState('')
  const [price, setPrice] = useState(String(item.proposed_price))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const look = Object.entries(item.data ?? {}).filter(([, v]) => v !== null && v !== '')

  async function decide(approve: boolean) {
    setError(null)
    setBusy(true)
    try {
      await reviewSoukSubmission(item.id, approve, note, approve ? Number(price) : null)
      onDone()
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <article className="panel panel-pad" style={{ marginBottom: 16 }}>
      <h3 style={{ marginTop: 0 }}><span className="tag">{t.kinds[item.kind]}</span> {item.name}</h3>
      <p className="tiny muted">
        <Link to={`/profil/${item.creator_username}`}>{t.by(item.creator_username)}</Link> · {t.proposedPrice(item.proposed_price)} · {new Date(item.created_at).toLocaleDateString(dateLocale())}
      </p>
      {/* Plain text only: what a member wrote is never treated as markup. */}
      {item.description && <p style={{ whiteSpace: 'pre-wrap' }}>{item.description}</p>}
      {look.length > 0 && (
        <dl className="tiny" style={{ margin: '8px 0' }} aria-label={t.lookTitle}>
          {look.map(([k, v]) => (
            <div key={k}>
              <dt className="muted" style={{ display: 'inline' }}>{k} : </dt>
              <dd style={{ display: 'inline', margin: 0 }}>{String(v)}</dd>
            </div>
          ))}
        </dl>
      )}
      {item.review_note && <p className="tiny muted">{item.review_note}</p>}
      {error && <div className="alert" role="alert">{error}</div>}
      {item.status === 'pending' && mine && <p className="tiny muted">{t.ownNote}</p>}
      {item.status === 'pending' && !mine && !rejecting && (
        <div>
          <div className="field">
            <label htmlFor={`price-${item.id}`}>{t.priceLabel}</label>
            <input id={`price-${item.id}`} type="number" min={1} max={1000000} value={price} onChange={(e) => setPrice(e.target.value)} />
            <span className="hint">{t.priceHint}</span>
          </div>
          <p>
            <button type="button" className="btn btn-cta" disabled={busy || !(Number(price) >= 1)} aria-label={`${t.approve} : ${item.name}`} onClick={() => void decide(true)}>{t.approve}</button>{' '}
            <button type="button" className="btn" disabled={busy} aria-label={`${t.reject} : ${item.name}`} onClick={() => setRejecting(true)}>{t.reject}</button>
          </p>
        </div>
      )}
      {item.status === 'pending' && !mine && rejecting && (
        <div>
          <div className="field">
            <label htmlFor={`note-${item.id}`}>{t.noteLabel}</label>
            <textarea id={`note-${item.id}`} rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
            <span className="hint">{t.noteRejectHint}</span>
          </div>
          <button type="button" className="btn btn-cta" disabled={busy || !note.trim()} onClick={() => void decide(false)}>{t.confirmReject}</button>{' '}
          <button type="button" className="btn" onClick={() => setRejecting(false)}>{t.cancel}</button>
        </div>
      )}
    </article>
  )
}

export function StaffSoukPanel() {
  const { member } = useAuth()
  const me = member?.profile.id
  const [tab, setTab] = useState<Tab>('pending')
  const [rows, setRows] = useState<SoukSubmissionStaff[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [notice, setNotice] = useState(false)

  const load = useCallback(() => {
    setFailed(false)
    setRows(null)
    listSoukSubmissions(tab).then(setRows).catch(() => setFailed(true))
  }, [tab])
  useEffect(load, [load])

  return (
    <section>
      <div role="tablist" className="souk-tabs">
        {TABS.map((k) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={`pill ${tab === k ? 'pill-on' : ''}`} onClick={() => { setTab(k); setNotice(false) }}>
            {fr.staff.souk.tabs[k]}
          </button>
        ))}
      </div>
      {notice && <div className="notice" role="status">{fr.staff.souk.done}</div>}
      {failed && (
        <div className="alert" role="alert">
          {fr.staff.loadFailed} <button type="button" className="btn" onClick={load}>{fr.staff.retry}</button>
        </div>
      )}
      {!failed && !rows && <p className="muted">{fr.common.loading}</p>}
      {rows && rows.length === 0 && <p className="muted">{fr.staff.souk.empty}</p>}
      {(rows ?? []).map((r) => <SubmissionCard key={r.id} item={r} mine={r.creator_id === me} onDone={() => { setNotice(true); load() }} />)}
    </section>
  )
}

