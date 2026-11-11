import { dateLocale } from '../i18n/lang'
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { useAuth } from '../auth/AuthContext'
import {
  applicantCvLink, closeJobOffer, getApplicationDetail, getMyOffer, listOfferApplicants, setApplicationStatus, startConversation,
  type Applicant, type ApplicantDetail, type ApplicantStatus, type MyOffer,
} from '../lib/api'
import { friendlyError } from '../lib/errors'
import { fr } from '../i18n/fr'

export function OfferApplicants() {
  const t = fr.employer.applicantsPage
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { member } = useAuth()
  const [filter, setFilter] = useState<ApplicantStatus | ''>('')
  const [list, setList] = useState<Applicant[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const [detail, setDetail] = useState<ApplicantDetail | null>(null)
  const [offer, setOffer] = useState<MyOffer | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(() => {
    setFailed(false)
    listOfferApplicants(id, filter).then(setList).catch(() => setFailed(true))
  }, [id, filter])
  useEffect(() => { setList(null); load() }, [load])
  const myId = member?.profile.id ?? ''
  useEffect(() => { getMyOffer(myId, id).then(setOffer).catch(() => { /* the title is a bonus */ }) }, [myId, id])

  async function closeOffer() {
    setBusy(true)
    setError(null)
    try {
      await closeJobOffer(id)
      setNotice(t.closed)
      setOffer((o) => (o ? { ...o, status: 'closed' } : o))
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  async function setStatus(a: Applicant, status: 'seen' | 'shortlisted' | 'declined') {
    setBusy(true)
    setError(null)
    try {
      await setApplicationStatus(a.id, status)
      load()
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  async function toggleDetail(a: Applicant) {
    if (open === a.id) { setOpen(null); setDetail(null); return }
    setError(null)
    try {
      setDetail(await getApplicationDetail(a.id))
      setOpen(a.id)
    } catch (e) {
      setError(friendlyError(e))
    }
  }

  async function openCv(path: string) {
    try {
      window.open(await applicantCvLink(path), '_blank', 'noopener,noreferrer')
    } catch (e) {
      setError(friendlyError(e))
    }
  }

  async function write(a: Applicant) {
    try {
      navigate(`/messages/${await startConversation(a.applicant_id)}`)
    } catch (e) {
      setError(friendlyError(e))
    }
  }

  return (
    <AppShell>
      <main className="page jobs">
        <p><Link to={`/profil/${member?.profile.username ?? ''}`}>← {fr.employer.back}</Link></p>
        <header className="page-head">
          <h1 className="page-title">{t.title}{offer ? ` · ${offer.title}` : ''}</h1>
          {offer?.status === 'published' ? <p><button type="button" className="btn" disabled={busy} onClick={() => void closeOffer()}>{t.closeOffer}</button> <span className="muted tiny">{t.closeHint}</span></p> : null}
        </header>
        {notice && <div className="notice" role="status">{notice}</div>}
        <div role="tablist" className="souk-tabs">
          {(['', 'submitted', 'seen', 'shortlisted', 'declined'] as const).map((s) => (
            <button key={s || 'all'} type="button" role="tab" aria-selected={filter === s} className={`pill ${filter === s ? 'pill-on' : ''}`} onClick={() => setFilter(s)}>
              {s === '' ? t.all : t.statuses[s]}
            </button>
          ))}
        </div>
        {failed && <div className="alert" role="alert">{fr.employer.loadFailed} <button type="button" className="btn" onClick={load}>{fr.employer.retry}</button></div>}
        {error && <div className="alert" role="alert">{error}</div>}
        {list === null && !failed && <p className="muted">{fr.common.loading}</p>}
        {list && list.length === 0 && <p className="muted">{t.empty}</p>}
        <div className="jobs-list">
          {list?.map((a) => (
            <article key={a.id} className="panel job-card" aria-label={a.display_name}>
              <div className="job-main">
                <h3>{a.display_name} <span className="tag">{t.statuses[a.status]}</span></h3>
                {a.headline && <p>{a.headline}</p>}
                <p className="muted">{t.appliedOn(new Date(a.applied_at).toLocaleDateString(dateLocale()))}</p>
                {a.skills.length > 0 && <p>{a.skills.slice(0, 6).map((k) => <span key={k} className="tag">{k}</span>)}</p>}
                <p>
                  {a.status === 'submitted' && <><button type="button" className="btn" disabled={busy} aria-label={`${t.seen} : ${a.display_name}`} onClick={() => void setStatus(a, 'seen')}>{t.seen}</button>{' '}</>}
                  {a.status !== 'shortlisted' && a.status !== 'declined' && <><button type="button" className="btn" disabled={busy} aria-label={`${t.shortlist} : ${a.display_name}`} onClick={() => void setStatus(a, 'shortlisted')}>{t.shortlist}</button>{' '}</>}
                  {a.status !== 'declined' && <><button type="button" className="btn" disabled={busy} aria-label={`${t.decline} : ${a.display_name}`} onClick={() => void setStatus(a, 'declined')}>{t.decline}</button>{' '}</>}
                  <button type="button" className="btn" aria-label={`${t.write} : ${a.display_name}`} onClick={() => void write(a)}>{t.write}</button>{' '}
                  <button type="button" className="btn" aria-label={`${open === a.id ? t.hideDetails : t.details} : ${a.display_name}`} onClick={() => void toggleDetail(a)}>{open === a.id ? t.hideDetails : t.details}</button>
                </p>
                {open === a.id && detail && (
                  <div>
                    <h4>{t.message}</h4>
                    <p style={{ whiteSpace: 'pre-wrap' }}>{detail.message ?? t.noMessage}</p>
                    {detail.cv_path
                      ? <button type="button" className="btn" onClick={() => void openCv(detail.cv_path as string)}>{t.openCv}</button>
                      : <p className="muted">{t.noCv}</p>}
                  </div>
                )}
              </div>
            </article>
          ))}
        </div>
      </main>
    </AppShell>
  )
}
