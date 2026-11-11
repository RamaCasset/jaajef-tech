import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { BackLink } from '../components/BackLink'
import { useAuth } from '../auth/AuthContext'
import { createJobOffer, getMyEmployer, getMyOffer, publishJobOffer, setMyCompanyName, updateJobOffer, type OfferInput } from '../lib/api'
import { friendlyError } from '../lib/errors'
import { fr } from '../i18n/fr'

const EMPTY: OfferInput = {
  title: '', kind: 'job', description: '', employment_type: 'full_time', location: '', remote: 'onsite',
  pay_min: '', pay_max: '', pay_unit: 'month', pay_negotiable: false, tags: '', closes_on: '',
}

export function OfferForm() {
  const t = fr.employer.offerForm
  const { id } = useParams()
  const { member } = useAuth()
  const me = member?.profile.id ?? ''
  const navigate = useNavigate()
  const [v, setV] = useState<OfferInput>(EMPTY)
  const [ready, setReady] = useState(!id)
  const [company, setCompany] = useState('')
  const [companyStart, setCompanyStart] = useState('')
  const ownName = member?.profile.display_name ?? ''
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = <K extends keyof OfferInput>(k: K, val: OfferInput[K]) => setV((x) => ({ ...x, [k]: val }))

  // A company name is shown only when the member gave one different from their own name.
  useEffect(() => {
    let alive = true
    getMyEmployer(me).then((e) => {
      if (!alive || !e || e.name === ownName) return
      setCompany(e.name)
      setCompanyStart(e.name)
    }).catch(() => { /* the field just starts empty */ })
    return () => { alive = false }
  }, [me, ownName])

  useEffect(() => {
    if (!id) return
    let alive = true
    getMyOffer(me, id)
      .then((o) => {
        if (!alive) return
        if (!o) { setError(t.notFound); return }
        setV({
          title: o.title, kind: o.kind, description: o.description, employment_type: o.employment_type ?? 'full_time',
          location: o.location ?? '', remote: o.remote, pay_min: o.pay_min_fcfa?.toString() ?? '', pay_max: o.pay_max_fcfa?.toString() ?? '',
          pay_unit: o.pay_unit ?? 'month', pay_negotiable: o.pay_negotiable, tags: o.tags.join(', '), closes_on: o.closes_on ?? '',
        })
        setReady(true)
      })
      .catch((e) => { if (alive) setError(friendlyError(e)) })
    return () => { alive = false }
  }, [id, me, t.notFound])

  async function submit(publish: boolean) {
    setError(null)
    setBusy(true)
    try {
      if (company.trim() !== companyStart) await setMyCompanyName(company)
      if (id) {
        await updateJobOffer(id, v)
        if (publish) await publishJobOffer(id)
      } else {
        await createJobOffer(v, publish)
      }
      navigate(`/profil/${member?.profile.username ?? ''}`)
    } catch (err) {
      setError(friendlyError(err))
      setBusy(false)
    }
  }

  const valid = v.title.trim().length >= 3 && v.description.trim().length > 0

  const profileLink = `/profil/${member?.profile.username ?? ''}`

  return (
    <AppShell>
      <main className="page offer-page">
        <BackLink to={profileLink}>{fr.employer.back}</BackLink>
        <p className="eyebrow">{t.crumb}</p>
        <h1 className="page-title">{id ? t.editTitle : t.newTitle}</h1>
        <p className="muted">{t.subtitle}</p>
        {error && <div className="alert" role="alert">{error}</div>}
        {ready && (
          <form onSubmit={(e: FormEvent) => { e.preventDefault(); void submit(false) }}>
            <ul className="settings-list panel form-list">
              <Row id="of-title" label={t.title} hint={t.hints.title} required>
                <input id="of-title" maxLength={120} value={v.title} onChange={(e) => set('title', e.target.value)} />
              </Row>
              <Row id="of-kind" label={t.kind} hint={t.hints.kind} required>
                <select id="of-kind" value={v.kind} onChange={(e) => set('kind', e.target.value as OfferInput['kind'])}>
                  <option value="job">{t.job}</option>
                  <option value="freelance">{t.freelance}</option>
                </select>
              </Row>
              {v.kind === 'job' && (
                <Row id="of-contract" label={t.contract} hint={t.hints.contract} required>
                  <select id="of-contract" value={v.employment_type} onChange={(e) => set('employment_type', e.target.value)}>
                    {Object.entries(t.contracts).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                </Row>
              )}
              <Row id="of-desc" label={t.description} hint={t.hints.description} required>
                <textarea id="of-desc" rows={8} maxLength={10000} value={v.description} onChange={(e) => set('description', e.target.value)} />
              </Row>
              <Row id="of-remote" label={t.remote} hint={t.hints.remote} required>
                <select id="of-remote" value={v.remote} onChange={(e) => set('remote', e.target.value)}>
                  {Object.entries(t.remotes).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </Row>
              <Row id="of-place" label={t.place} hint={t.hints.place}>
                <input id="of-place" maxLength={100} value={v.location} onChange={(e) => set('location', e.target.value)} />
              </Row>
              <Row id="of-min" label={t.payMin} hint={t.hints.pay}>
                <input id="of-min" inputMode="numeric" value={v.pay_min} onChange={(e) => set('pay_min', e.target.value.replace(/\D/g, ''))} />
              </Row>
              <Row id="of-max" label={t.payMax}>
                <input id="of-max" inputMode="numeric" value={v.pay_max} onChange={(e) => set('pay_max', e.target.value.replace(/\D/g, ''))} />
              </Row>
              <Row id="of-unit" label={t.payUnit}>
                <select id="of-unit" value={v.pay_unit} onChange={(e) => set('pay_unit', e.target.value)}>
                  {Object.entries(t.payUnits).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </Row>
              <Row id="of-neg" label={t.negotiable}>
                <input id="of-neg" type="checkbox" checked={v.pay_negotiable} onChange={(e) => set('pay_negotiable', e.target.checked)} />
              </Row>
              <Row id="of-tags" label={t.tags} hint={t.hints.tags}>
                <input id="of-tags" value={v.tags} onChange={(e) => set('tags', e.target.value)} />
              </Row>
              <Row id="of-close" label={t.closesOn} hint={t.hints.closesOn}>
                <input id="of-close" type="date" value={v.closes_on} onChange={(e) => set('closes_on', e.target.value)} />
              </Row>
              <Row id="of-company" label={t.companyName} hint={t.companyHint}>
                <input id="of-company" maxLength={100} value={company} onChange={(e) => setCompany(e.target.value)} />
              </Row>
            </ul>
            <p className="muted tiny">{t.requiredNote}</p>
            <div className="form-actions">
              <button type="submit" className="btn" disabled={busy || !valid}>{id ? t.save : t.saveDraft}</button>
              <button type="button" className="btn btn-cta" disabled={busy || !valid} onClick={() => void submit(true)}>{t.saveAndPublish}</button>
            </div>
          </form>
        )}
      </main>
    </AppShell>
  )
}

/** One entry of the form, laid out like a row of the settings screen: what it is on the left, the field on the right. */
function Row({ id, label, hint, required, children }: { id: string; label: string; hint?: string; required?: boolean; children: ReactNode }) {
  return (
    <li className="form-row">
      <div className="form-row-label">
        <strong><label htmlFor={id}>{label}</label>{required ? <span className="req" aria-hidden="true"> *</span> : null}</strong>
        {hint ? <span className="muted">{hint}</span> : null}
      </div>
      <div className="form-row-field">{children}</div>
    </li>
  )
}
