import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { fr } from '../i18n/fr'
import { friendlyError } from '../lib/errors'
import {
  listMySales, listMySoukSubmissions, myCreatorSummary, submitSoukItem, withdrawSoukSubmission,
  type CreatorSummary, type MySale, type SoukKind, type SoukSubmission,
} from '../lib/api'

const KINDS: SoukKind[] = ['theme', 'avatar_frame', 'status_badge']

/** The "look" of each kind, in the shape the shop already shows. Placeholder until the design is set. */
function lookData(kind: SoukKind, value: string): Record<string, string> {
  const v = value.trim()
  if (kind === 'theme') return { accent: v }
  if (kind === 'avatar_frame') return { color: v }
  return { label: v }
}

export function SoukSell() {
  const [summary, setSummary] = useState<CreatorSummary | null>(null)
  const [subs, setSubs] = useState<SoukSubmission[] | null>(null)
  const [sales, setSales] = useState<MySale[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [kind, setKind] = useState<SoukKind>('theme')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [price, setPrice] = useState('')
  const [look, setLook] = useState('')

  const load = useCallback(() => {
    setFailed(false)
    Promise.all([myCreatorSummary(), listMySoukSubmissions(), listMySales()])
      .then(([a, b, c]) => { setSummary(a); setSubs(b); setSales(c) })
      .catch(() => setFailed(true))
  }, [])
  useEffect(load, [load])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setNotice(null)
    setBusy(true)
    try {
      await submitSoukItem(kind, name, description, lookData(kind, look), Number(price))
      setName(''); setDescription(''); setPrice(''); setLook('')
      setNotice(fr.soukSell.sent)
      load()
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  async function withdraw(id: string) {
    setError(null)
    setNotice(null)
    setBusy(true)
    try { await withdrawSoukSubmission(id); load() } catch (err) { setError(friendlyError(err)) } finally { setBusy(false) }
  }

  const lookLabel = kind === 'theme' ? fr.soukSell.lookTheme : kind === 'avatar_frame' ? fr.soukSell.lookFrame : fr.soukSell.lookBadge
  const priceNumber = Number(price)
  const ready = name.trim() !== '' && look.trim() !== '' && Number.isInteger(priceNumber) && priceNumber >= 1

  return (
    <AppShell>
      <main className="page souk">
        <p><Link to="/souk">← {fr.soukSell.back}</Link></p>
        <header className="page-head">
          <h1 className="page-title">{fr.soukSell.title}</h1>
          <p className="muted">{fr.soukSell.subtitle}</p>
        </header>
        {error && <div className="alert" role="alert">{error}</div>}
        {notice && <div className="notice" role="status">{notice}</div>}
        {failed && (
          <div className="alert" role="alert">
            {fr.soukSell.loadFailed} <button type="button" className="btn" onClick={load}>{fr.soukSell.retry}</button>
          </div>
        )}

        {summary && (
          <section className="panel" style={{ marginBottom: 24 }}>
            <h2>{fr.soukSell.summaryTitle}</h2>
            <p>{fr.soukSell.onSale(summary.items_on_sale)} · {fr.soukSell.sold(summary.sales_count)} · {fr.soukSell.earned(summary.kopeks_earned)}</p>
            <p className="muted tiny">{fr.soukSell.share(summary.share_percent)}</p>
          </section>
        )}

        <form className="panel" onSubmit={onSubmit} noValidate style={{ marginBottom: 24 }}>
          <h2>{fr.soukSell.formTitle}</h2>
          <div className="field">
            <label htmlFor="s-kind">{fr.soukSell.kind}</label>
            <select id="s-kind" value={kind} onChange={(e) => { setKind(e.target.value as SoukKind); setLook('') }}>
              {KINDS.map((k) => <option key={k} value={k}>{fr.souk.kinds[k]}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="s-name">{fr.soukSell.name}</label>
            <input id="s-name" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="s-desc">{fr.soukSell.description}</label>
            <textarea id="s-desc" rows={2} maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="s-look">{lookLabel}</label>
            <input id="s-look" value={look} onChange={(e) => setLook(e.target.value)} />
            <span className="hint">{fr.soukSell.lookHint}</span>
          </div>
          <div className="field">
            <label htmlFor="s-price">{fr.soukSell.price}</label>
            <input id="s-price" type="number" min={1} max={1000000} value={price} onChange={(e) => setPrice(e.target.value)} />
          </div>
          <button className="btn btn-cta" type="submit" disabled={busy || !ready}>{fr.soukSell.submit}</button>
        </form>

        <section className="panel" style={{ marginBottom: 24 }}>
          <h2>{fr.soukSell.listTitle}</h2>
          {subs && subs.length === 0 && <p className="muted">{fr.soukSell.listEmpty}</p>}
          {(subs ?? []).map((s) => (
            <article key={s.id} style={{ padding: '8px 0', borderTop: '1px solid var(--line)' }}>
              <strong>{s.name}</strong> · {fr.souk.kinds[s.kind]} · {fr.souk.price(s.proposed_price)}{' '}
              <span className="tag">{fr.soukSell.statuses[s.status]}</span>
              {s.review_note && <p className="muted tiny">{fr.soukSell.note(s.review_note)}</p>}
              {s.status === 'pending' && (
                <> <button type="button" className="btn" disabled={busy} aria-label={`${fr.soukSell.withdraw} : ${s.name}`} onClick={() => void withdraw(s.id)}>{fr.soukSell.withdraw}</button></>
              )}
            </article>
          ))}
        </section>

        <section className="panel">
          <h2>{fr.soukSell.salesTitle}</h2>
          {sales && sales.length === 0 && <p className="muted">{fr.soukSell.salesEmpty}</p>}
          {(sales ?? []).map((s) => (
            <p key={s.id} style={{ margin: '4px 0' }}>
              {s.item_name} · {fr.souk.price(s.price)} → {fr.souk.price(s.amount)} · {new Date(s.sold_at).toLocaleDateString('fr-FR')}
            </p>
          ))}
        </section>
      </main>
    </AppShell>
  )
}
