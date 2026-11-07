import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { useAuth } from '../auth/AuthContext'
import { createJobOffer, getMyOffer, publishJobOffer, updateJobOffer, type OfferInput } from '../lib/api'
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
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = <K extends keyof OfferInput>(k: K, val: OfferInput[K]) => setV((x) => ({ ...x, [k]: val }))

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
      if (id) {
        await updateJobOffer(id, v)
        if (publish) await publishJobOffer(id)
      } else {
        await createJobOffer(v, publish)
      }
      navigate('/employeur')
    } catch (err) {
      setError(friendlyError(err))
      setBusy(false)
    }
  }

  const valid = v.title.trim().length >= 3 && v.description.trim().length > 0

  return (
    <AppShell>
      <main className="page jobs">
        <p><Link to="/employeur">← {fr.employer.back}</Link></p>
        <header className="page-head"><h1 className="page-title">{id ? t.editTitle : t.newTitle}</h1></header>
        {error && <div className="alert" role="alert">{error}</div>}
        {ready && (
          <form onSubmit={(e: FormEvent) => { e.preventDefault(); void submit(false) }}>
            <div className="field"><label htmlFor="of-title">{t.title}</label><input id="of-title" maxLength={120} value={v.title} onChange={(e) => set('title', e.target.value)} /></div>
            <div className="field">
              <label htmlFor="of-kind">{t.kind}</label>
              <select id="of-kind" value={v.kind} onChange={(e) => set('kind', e.target.value as OfferInput['kind'])}>
                <option value="job">{t.job}</option>
                <option value="freelance">{t.freelance}</option>
              </select>
            </div>
            {v.kind === 'job' && (
              <div className="field">
                <label htmlFor="of-contract">{t.contract}</label>
                <select id="of-contract" value={v.employment_type} onChange={(e) => set('employment_type', e.target.value)}>
                  {Object.entries(t.contracts).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </div>
            )}
            <div className="field">
              <label htmlFor="of-remote">{t.remote}</label>
              <select id="of-remote" value={v.remote} onChange={(e) => set('remote', e.target.value)}>
                {Object.entries(t.remotes).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </div>
            <div className="field"><label htmlFor="of-place">{t.place}</label><input id="of-place" maxLength={100} value={v.location} onChange={(e) => set('location', e.target.value)} /></div>
            <div className="field"><label htmlFor="of-desc">{t.description}</label><textarea id="of-desc" rows={8} maxLength={10000} value={v.description} onChange={(e) => set('description', e.target.value)} /></div>
            <div className="field"><label htmlFor="of-min">{t.payMin}</label><input id="of-min" inputMode="numeric" value={v.pay_min} onChange={(e) => set('pay_min', e.target.value.replace(/\D/g, ''))} /></div>
            <div className="field"><label htmlFor="of-max">{t.payMax}</label><input id="of-max" inputMode="numeric" value={v.pay_max} onChange={(e) => set('pay_max', e.target.value.replace(/\D/g, ''))} /></div>
            <div className="field">
              <label htmlFor="of-unit">{t.payUnit}</label>
              <select id="of-unit" value={v.pay_unit} onChange={(e) => set('pay_unit', e.target.value)}>
                {Object.entries(t.payUnits).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </div>
            <div className="field"><label><input type="checkbox" checked={v.pay_negotiable} onChange={(e) => set('pay_negotiable', e.target.checked)} /> {t.negotiable}</label></div>
            <div className="field"><label htmlFor="of-tags">{t.tags}</label><input id="of-tags" value={v.tags} onChange={(e) => set('tags', e.target.value)} /></div>
            <div className="field"><label htmlFor="of-close">{t.closesOn}</label><input id="of-close" type="date" value={v.closes_on} onChange={(e) => set('closes_on', e.target.value)} /></div>
            <button type="submit" className="btn" disabled={busy || !valid}>{id ? t.save : t.saveDraft}</button>{' '}
            <button type="button" className="btn btn-cta" disabled={busy || !valid} onClick={() => void submit(true)}>{t.saveAndPublish}</button>
          </form>
        )}
      </main>
    </AppShell>
  )
}
