import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { AppShell } from '../components/AppShell'
import { confirmKopekPurchase, type KopekPaymentOutcome } from '../lib/api'
import { fr } from '../i18n/fr'

/** Where PayDunya sends the member back to. It asks the server what really happened, then says so. */
export function KopeksReturn() {
  const t = fr.kopeks
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const { refreshMember } = useAuth()
  // Kept in a ref: refreshing the member changes this function, which must not trigger another check.
  const refresh = useRef(refreshMember)
  refresh.current = refreshMember
  const [state, setState] = useState<{ outcome: KopekPaymentOutcome | 'error'; kopeks: number } | null>(null)

  const check = useCallback(() => {
    setState(null)
    if (!token) { setState({ outcome: 'error', kopeks: 0 }); return }
    confirmKopekPurchase(token)
      .then((r) => { setState({ outcome: r.outcome, kopeks: r.kopeks }); if (r.outcome === 'credited' || r.outcome === 'already') void refresh.current() })
      .catch(() => setState({ outcome: 'error', kopeks: 0 }))
  }, [token])
  useEffect(check, [check])

  const done = state?.outcome === 'credited' || state?.outcome === 'already'
  const waiting = state?.outcome === 'pending'
  return (
    <AppShell>
      <main className="page buy">
        <h1 className="page-title">{t.returnTitle}</h1>
        <section className="panel panel-pad buy-return" aria-live="polite">
          {!state && <p className="muted">{t.checking}</p>}
          {done && <div className="notice" role="status">{t.credited(String(state?.kopeks ?? 0))}</div>}
          {waiting && (
            <>
              <p className="muted">{t.pendingText}</p>
              <button type="button" className="btn" onClick={check}>{t.recheck}</button>
            </>
          )}
          {state && !done && !waiting && state.outcome !== 'error' && state.outcome !== 'unavailable' && <div className="alert" role="alert">{t.notDone}</div>}
          {(state?.outcome === 'error' || state?.outcome === 'unavailable') && (
            <>
              <div className="alert" role="alert">{t.problem}</div>
              <button type="button" className="btn" onClick={check}>{t.recheck}</button>
            </>
          )}
          <p style={{ marginTop: 20 }}>
            <Link className="btn btn-cta" to="/souk">{t.toSouk}</Link>{' '}
            <Link className="btn" to="/kopeks">{t.back2}</Link>
          </p>
        </section>
      </main>
    </AppShell>
  )
}
