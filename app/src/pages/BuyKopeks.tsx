import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { AppShell } from '../components/AppShell'
import { Icon } from '../components/Icon'
import { startKopekPurchase } from '../lib/api'
import { fr } from '../i18n/fr'

const PACKS = [100, 500, 1000]
const CFA_PER_KOPEK = 10
type Method = 'wave' | 'orange' | 'card'
const METHODS: Method[] = ['wave', 'orange', 'card']

const nf = (n: number) => n.toLocaleString('fr-FR').replace(/[  ]/g, ' ')

/** Buying Kopeks: pick a pack and a way to pay, then go to the PayDunya payment page. */
export function BuyKopeks() {
  const t = fr.kopeks
  const { member } = useAuth()
  const balance = member?.kopeks ?? 0
  const [pack, setPack] = useState(500)
  const [method, setMethod] = useState<Method>('wave')
  const [phone, setPhone] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const price = `${nf(pack * CFA_PER_KOPEK)} F CFA`
  const methodName = t.methods[method]
  const needsPhone = method !== 'card'
  const phoneOk = !needsPhone || phone.replace(/\D/g, '').length === 9

  async function pay() {
    setError(null)
    setBusy(true)
    try {
      const { url } = await startKopekPurchase(pack, method, phone)
      window.location.assign(url)
    } catch (err) {
      const message = (err as Error).message
      setError(message.startsWith('not_configured') ? `${t.notYet}${message.includes(':') ? ` (${message.slice(message.indexOf(':') + 1)})` : ''}` : t.failed)
      setBusy(false)
    }
  }

  return (
    <AppShell>
      <main className="page buy">
        <Link to="/souk" className="buy-back muted tiny"><Icon name="back" size={14} /> {t.back}</Link>
        <header className="buy-head">
          <div>
            <h1 className="page-title">{t.title}</h1>
            <p className="muted">{t.subtitle}</p>
          </div>
          <div className="buy-balance" aria-label={t.balance}>
            <span className="mono tiny">{t.balance.toUpperCase()}</span>
            <strong>{nf(balance)} {fr.nav.kopeks}</strong>
          </div>
        </header>

        <div className="buy-grid">
          <div>
            <h2 className="buy-step">{t.chooseTitle}</h2>
            <div className="buy-packs" role="radiogroup" aria-label={t.chooseTitle}>
              {PACKS.map((n) => (
                <button key={n} type="button" role="radio" aria-checked={pack === n} className={`panel buy-pack ${pack === n ? 'buy-pack-on' : ''}`} onClick={() => setPack(n)}>
                  <span className="mono tiny">{pack === n ? t.selected.toUpperCase() : t.pack.toUpperCase()}</span>
                  <strong className="buy-amount">{nf(n)}</strong>
                  <span className="muted">{t.unit}</span>
                  <span className="buy-price">{nf(n * CFA_PER_KOPEK)} F CFA</span>
                </button>
              ))}
            </div>
            <p className="muted tiny">{t.rate}</p>

            <section className="panel panel-pad buy-pay" aria-label={t.payTitle}>
              <h2 className="buy-step">{t.payTitle}</h2>
              <div className="buy-methods" role="radiogroup" aria-label={t.payTitle}>
                {METHODS.map((m) => (
                  <button key={m} type="button" role="radio" aria-checked={method === m} className={`buy-method ${method === m ? 'buy-method-on' : ''}`} onClick={() => { setMethod(m); setError(null) }}>
                    <span className="buy-dot" aria-hidden="true" /> {t.methods[m]}
                  </button>
                ))}
              </div>
              {needsPhone ? (
                <>
                  <div className="field">
                    <label htmlFor="buy-phone">{t.phoneLabel(methodName)}</label>
                    <div className="buy-phone">
                      <span>+221</span>
                      <input id="buy-phone" type="tel" inputMode="tel" autoComplete="tel-national" placeholder={t.phonePlaceholder} value={phone} onChange={(e) => setPhone(e.target.value)} />
                    </div>
                    <span className="hint">{t.phoneHint(methodName)}</span>
                  </div>
                  <div className="buy-info"><strong>{t.validateTitle(methodName)}</strong><p className="muted">{t.validateText(methodName)}</p></div>
                </>
              ) : (
                <div className="buy-info"><strong>{t.cardTitle}</strong><p className="muted">{t.cardText}</p></div>
              )}
            </section>
          </div>

          <aside>
            <section className="panel panel-pad buy-summary" aria-label={t.summary}>
              <h2>{t.summary}</h2>
              <p className="buy-big">{nf(pack)} {fr.nav.kopeks}</p>
              <p className="muted">{t.forNext}</p>
              <dl className="buy-lines">
                <div><dt>{t.packOf(nf(pack))}</dt><dd>{price}</dd></div>
                <div><dt>{t.fees}</dt><dd>0 F CFA</dd></div>
              </dl>
              <dl className="buy-lines buy-total"><div><dt>{t.total}</dt><dd>{price}</dd></div></dl>
              <dl className="buy-lines buy-after">
                <div><dt>{t.current}</dt><dd>{nf(balance)}</dd></div>
                <div><dt>{t.bought}</dt><dd className="buy-plus">+ {nf(pack)}</dd></div>
                <div className="buy-new"><dt>{t.newBalance}</dt><dd>{nf(balance + pack)} {fr.nav.kopeks}</dd></div>
              </dl>
              {error && <div className="alert" role="alert">{error}</div>}
              <button type="button" className="btn btn-cta buy-submit" disabled={!phoneOk || busy} onClick={() => void pay()}>{t.pay(price)}</button>
              <p className="muted tiny">{t.terms}</p>
            </section>
            <p className="buy-wallet"><strong>{t.walletTitle}</strong><span className="muted">{t.walletText}</span></p>
          </aside>
        </div>
      </main>
    </AppShell>
  )
}
